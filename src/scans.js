// Live 5-minute scans, kept in memory. A scan receives a frame every few seconds, so
// writing each recognition to the database would multiply database load by ~100 per
// class. Instead the result is checkpointed to the session row now and then, and written
// for real once, when the teacher submits.
const { query } = require('./db');

const scans = new Map(); // sessionId -> state
const CHECKPOINT_EVERY = 10; // frames

function create(session) {
  const state = {
    id: Number(session.id),
    teacher_id: session.teacher_id,
    class_id: session.class_id,
    endsAt: new Date(session.scan_ends_at).getTime(),
    recognised: new Map(), // student_id -> { name, roll_no, confidence, first_seen, hits }
    maxFaces: 0,
    lastFaces: 0,
    frames: 0,
    lastFrameAt: 0,
  };
  // Restore a checkpoint if the server restarted mid-scan.
  const saved = session.scan_result;
  if (saved?.recognised) {
    for (const r of saved.recognised) state.recognised.set(r.student_id, r);
    state.maxFaces = saved.maxFaces || 0;
    state.frames = saved.frames || 0;
  }
  scans.set(state.id, state);
  return state;
}

const get = (id) => scans.get(Number(id));

function snapshot(state) {
  return {
    recognised: [...state.recognised.entries()].map(([student_id, r]) => ({ student_id, ...r }))
      .sort((a, b) => String(a.roll_no).localeCompare(String(b.roll_no))),
    maxFaces: state.maxFaces,
    lastFaces: state.lastFaces,
    frames: state.frames,
  };
}

async function checkpoint(state, status) {
  const snap = snapshot(state);
  await query(`UPDATE attendance_sessions SET scan_result = $2, max_faces = $3, recognised_count = $4, frames = $5
    ${status ? ', status = $6' : ''} WHERE id = $1`,
  [state.id, JSON.stringify(snap), snap.maxFaces, snap.recognised.length, snap.frames, ...(status ? [status] : [])]);
}

function recordFrame(state, faceCount, matches, threshold, confidenceOf) {
  state.frames++;
  state.lastFaces = faceCount;
  state.maxFaces = Math.max(state.maxFaces, faceCount);
  state.lastFrameAt = Date.now();
  const fresh = [];
  const now = new Date().toISOString();
  for (const m of matches) {
    const c = Math.round(confidenceOf(m.distance, threshold) * 100) / 100;
    const prev = state.recognised.get(m.student_id);
    if (prev) {
      prev.hits++;
      prev.confidence = Math.max(prev.confidence, c);
    } else {
      state.recognised.set(m.student_id, { name: m.name, roll_no: m.roll_no, confidence: c, first_seen: now, hits: 1 });
      fresh.push({ student_id: m.student_id, name: m.name, roll_no: m.roll_no, confidence: c });
    }
  }
  return { fresh, needCheckpoint: state.frames % CHECKPOINT_EVERY === 0 };
}

const drop = (id) => scans.delete(Number(id));
const activeCount = () => scans.size;

// Scans whose time is up but whose teacher closed the tab: move them to review.
async function sweep() {
  for (const state of scans.values()) {
    if (Date.now() > state.endsAt + 60e3) {
      await checkpoint(state, 'review').catch(() => {});
      drop(state.id);
    }
  }
}
setInterval(() => sweep().catch(() => {}), 30e3).unref();

module.exports = { create, get, snapshot, checkpoint, recordFrame, drop, activeCount };
