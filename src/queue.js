// Saving final attendance, with a write-behind queue for peak load.
//
// Normal load: a submitted attendance is written at once (one transaction, one bulk INSERT).
// Peak load (more than `queue_threshold` submissions in the last minute, default 500): it is
// stored as ONE queue row instead, and the teacher gets an answer immediately. A background
// worker saves queued attendance when traffic drops (the gap between lectures), and anything
// older than `queue_deadline_minutes` is saved even if traffic is still high, so nothing waits
// past the next lecture. The queue lives in PostgreSQL, so it survives restarts and works
// with several app servers (FOR UPDATE SKIP LOCKED).
const { query, one, tx, getSettings } = require('./db');

const WINDOW_MS = 60e3;
const recent = []; // timestamps of submissions in the last minute
let inflight = 0;
let pending = 0; // queued, not yet saved
const stats = { direct: 0, queued: 0, drained: 0, failed: 0, lastDrainAt: null };

function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  while (recent.length && recent[0] < cutoff) recent.shift();
}
function traffic() { prune(); return recent.length + inflight; }

// payload: { session_id, teacher_id, records: [{ student_id, status, source, confidence }], label }
async function writeAttendance(t, payload) {
  const recs = payload.records;
  await t.query('DELETE FROM attendance_records WHERE session_id = $1', [payload.session_id]);
  if (recs.length) {
    await t.query(`INSERT INTO attendance_records (session_id, student_id, status, source, confidence)
      SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::real[])`,
    [payload.session_id, recs.map((r) => r.student_id), recs.map((r) => r.status), recs.map((r) => r.source), recs.map((r) => r.confidence ?? null)]);
  }
  const present = recs.filter((r) => r.status === 'P').length;
  await t.query(`UPDATE attendance_sessions SET status = 'saved', saved_at = now(), present_count = $2,
    submitted_at = COALESCE(submitted_at, now()) WHERE id = $1`, [payload.session_id, present]);
  await t.query('INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, $4)', [
    payload.teacher_id, `Attendance saved: ${present} of ${recs.length} present`,
    `${payload.label}. Saved to the university records.`, `#attendance/${payload.session_id}`]);
  return present;
}

// Returns { mode: 'direct', present } or { mode: 'queued', position }.
async function submitAttendance(payload) {
  const s = await getSettings();
  const threshold = Number(s.queue_threshold) || 500;
  recent.push(Date.now());
  if (pending === 0 && traffic() <= threshold) {
    inflight++;
    try {
      const present = await tx((t) => writeAttendance(t, payload));
      stats.direct++;
      return { mode: 'direct', present };
    } finally { inflight--; }
  }
  await tx(async (t) => {
    await t.query('INSERT INTO attendance_queue (session_id, payload) VALUES ($1, $2)', [payload.session_id, JSON.stringify(payload)]);
    await t.query("UPDATE attendance_sessions SET status = 'queued', submitted_at = now() WHERE id = $1", [payload.session_id]);
  });
  pending++;
  stats.queued++;
  return { mode: 'queued', position: pending };
}

// Saves one queued job; returns false when there is nothing (eligible) to do.
async function drainOne(olderThanMinutes) {
  return tx(async (t) => {
    const job = await t.one(`SELECT id, payload, attempts FROM attendance_queue
      WHERE done_at IS NULL AND attempts < 5 ${olderThanMinutes != null ? `AND enqueued_at < now() - make_interval(mins => ${Number(olderThanMinutes)})` : ''}
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!job) return false;
    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      await writeAttendance(t, payload);
      await t.query('UPDATE attendance_queue SET done_at = now(), attempts = attempts + 1 WHERE id = $1', [job.id]);
      stats.drained++;
    } catch (err) {
      // Record the failure outside the job's work so the retry counter survives.
      stats.failed++;
      setImmediate(() => query('UPDATE attendance_queue SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [job.id, String(err.message).slice(0, 500)]).catch(() => {}));
    }
    return true;
  });
}

let running = false;
async function tick() {
  if (running || pending <= 0) return;
  running = true;
  try {
    const s = await getSettings();
    const peak = traffic() > (Number(s.queue_threshold) || 500);
    // During peak only overdue jobs are saved, a few at a time; otherwise drain fast.
    const batch = peak ? 5 : 100;
    const olderThan = peak ? Number(s.queue_deadline_minutes) || 45 : null;
    for (let i = 0; i < batch; i++) {
      if (!(await drainOne(olderThan))) break;
      pending = Math.max(0, pending - 1);
    }
    stats.lastDrainAt = new Date().toISOString();
    if (!peak) pending = Number((await one('SELECT count(*)::int AS n FROM attendance_queue WHERE done_at IS NULL AND attempts < 5')).n);
  } catch (err) {
    console.error('queue worker:', err.message);
  } finally { running = false; }
}

async function startWorker() {
  pending = Number((await one('SELECT count(*)::int AS n FROM attendance_queue WHERE done_at IS NULL AND attempts < 5')).n);
  setInterval(tick, 2000).unref();
}

async function metrics() {
  const q = await one(`SELECT count(*) FILTER (WHERE done_at IS NULL AND attempts < 5)::int AS pending,
    count(*) FILTER (WHERE done_at IS NULL AND attempts >= 5)::int AS failed,
    EXTRACT(EPOCH FROM now() - min(enqueued_at) FILTER (WHERE done_at IS NULL))::int AS oldest_seconds
    FROM attendance_queue`);
  const s = await getSettings();
  return { traffic_per_minute: traffic(), threshold: Number(s.queue_threshold), inflight, ...q, ...stats };
}

module.exports = { submitAttendance, startWorker, metrics, traffic, tick };
