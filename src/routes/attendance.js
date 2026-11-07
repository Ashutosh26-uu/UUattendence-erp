// Teacher side: allotted lectures and the camera attendance flow.
//
//   start  -> a session for (lecture, today), status 'scanning', scan_ends_at = now + scan minutes
//   frame  -> every few seconds the browser sends the face descriptors it sees; the server
//             matches them against the class and keeps the result in memory (scans.js)
//   finish -> scan time over (or teacher stops early): status 'review', result checkpointed
//   submit -> teacher's manual corrections applied, final attendance saved (queue.js)
const express = require('express');
const { query, one, audit, getSettings } = require('../db');
const { HttpError, int, oneOf, today, isoDay } = require('../http');
const auth = require('../auth');
const { parseDescriptor, classGallery, matchFaces, confidence } = require('../face');
const scans = require('../scans');
const queue = require('../queue');

const router = express.Router();
router.use(auth.requireRole('teacher'));
const req_ = { required: true };
const MAX_FACES = 300;

// All lectures allotted to this teacher, with today's attendance status for each.
router.get('/lectures', async (req, res) => {
  res.json({
    today: isoDay(),
    date: today(),
    lectures: await query(`SELECT l.id, l.day, to_char(l.start_time, 'HH24:MI') AS start_time, to_char(l.end_time, 'HH24:MI') AS end_time,
      c.id AS class_id, c.name AS class_name, s.code AS subject_code, s.name AS subject_name, r.name AS room_name, r.building,
      (r.camera_url IS NOT NULL) AS has_camera,
      (SELECT count(*) FROM students st WHERE st.class_id = l.class_id AND st.active)::int AS registered,
      (SELECT count(DISTINCT f.student_id) FROM face_samples f JOIN students st ON st.id = f.student_id WHERE st.class_id = l.class_id AND st.active)::int AS enrolled,
      a.id AS session_id, a.status AS session_status, a.present_count
      FROM lectures l JOIN classes c ON c.id = l.class_id JOIN subjects s ON s.id = l.subject_id LEFT JOIN rooms r ON r.id = l.room_id
      LEFT JOIN attendance_sessions a ON a.lecture_id = l.id AND a.date = $2 AND a.status <> 'cancelled'
      WHERE l.teacher_id = $1 ORDER BY l.day, l.start_time`, [req.user.id, today()]),
  });
});

router.get('/history', async (req, res) => {
  res.json(await query(`SELECT a.id, a.date::text AS date, a.status, a.registered_count, a.max_faces, a.recognised_count, a.present_count,
    c.name AS class_name, s.code AS subject_code, s.name AS subject_name, r.name AS room_name
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id LEFT JOIN rooms r ON r.id = a.room_id
    WHERE a.teacher_id = $1 AND a.status <> 'cancelled' ORDER BY a.date DESC, a.started_at DESC LIMIT 100`, [req.user.id]));
});

async function ownSession(user, id) {
  const s = await one(`SELECT a.*, a.date::text AS date, c.name AS class_name, sub.code AS subject_code, sub.name AS subject_name,
    r.name AS room_name, (r.camera_url IS NOT NULL) AS has_camera, to_char(l.start_time, 'HH24:MI') AS start_time, to_char(l.end_time, 'HH24:MI') AS end_time
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects sub ON sub.id = a.subject_id
    JOIN lectures l ON l.id = a.lecture_id LEFT JOIN rooms r ON r.id = a.room_id WHERE a.id = $1`, [id]);
  if (!s || s.teacher_id !== user.id) throw new HttpError(404, 'Attendance not found');
  return s;
}

// Everything the screen needs: session, live/saved scan result, and the class roster.
async function sessionView(s) {
  const live = scans.get(s.id);
  const scan = live ? scans.snapshot(live) : (s.scan_result || { recognised: [], maxFaces: s.max_faces, frames: s.frames });
  const roster = await query('SELECT id, roll_no, name, EXISTS (SELECT 1 FROM face_samples f WHERE f.student_id = st.id) AS enrolled FROM students st WHERE class_id = $1 AND active ORDER BY roll_no', [s.class_id]);
  const records = ['saved'].includes(s.status)
    ? await query('SELECT student_id, status, source, confidence FROM attendance_records WHERE session_id = $1', [s.id]) : null;
  const { scan_result: _omit, ...session } = s;
  return {
    session: { ...session, seconds_left: Math.max(0, Math.round((new Date(s.scan_ends_at).getTime() - Date.now()) / 1000)) },
    scan,
    roster,
    records,
    counts: { registered: roster.length, enrolled: roster.filter((r) => r.enrolled).length, in_class: scan.maxFaces, recognised: scan.recognised.length },
  };
}

router.post('/start', async (req, res) => {
  const lectureId = int(req.body?.lecture_id, 'Lecture', req_);
  const l = await one('SELECT * FROM lectures WHERE id = $1 AND teacher_id = $2', [lectureId, req.user.id]);
  if (!l) throw new HttpError(404, 'This lecture is not allotted to you');
  const existing = await one("SELECT id FROM attendance_sessions WHERE lecture_id = $1 AND date = $2 AND status <> 'cancelled'", [lectureId, today()]);
  if (existing) return res.json(await sessionView(await ownSession(req.user, existing.id)));
  const registered = (await one('SELECT count(*)::int AS n FROM students WHERE class_id = $1 AND active', [l.class_id])).n;
  if (!registered) throw new HttpError(400, 'No students are registered in this class');
  const s = await getSettings();
  const created = await one(`INSERT INTO attendance_sessions (lecture_id, class_id, subject_id, teacher_id, room_id, date, status, registered_count, scan_ends_at)
    VALUES ($1, $2, $3, $4, $5, $8, 'scanning', $6, now() + make_interval(mins => $7::int)) RETURNING *`,
  [l.id, l.class_id, l.subject_id, req.user.id, l.room_id, registered, Number(s.scan_minutes) || 5, today()]);
  scans.create(created);
  await classGallery(l.class_id); // warm the cache before the first frame
  audit(req.user.id, 'attendance_started', { session: created.id, lecture: l.id, off_schedule: l.day !== isoDay() });
  res.status(201).json(await sessionView(await ownSession(req.user, created.id)));
});

router.get('/:id', async (req, res) => {
  res.json(await sessionView(await ownSession(req.user, int(req.params.id, 'Id', req_))));
});

// One camera frame. Small response on purpose: it is called every few seconds by every class.
router.post('/:id/frame', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  let state = scans.get(id);
  if (!state || state.teacher_id !== req.user.id) {
    const s = await ownSession(req.user, id);
    if (s.status !== 'scanning') throw new HttpError(409, 'The scan is over');
    state = scans.create(s); // server restarted mid-scan: continue from the checkpoint
  }
  if (Date.now() > state.endsAt + 15e3) throw new HttpError(409, 'Scan time is over');
  if (Date.now() - state.lastFrameAt < 800) throw new HttpError(429, 'Too many frames');
  const raw = Array.isArray(req.body?.faces) ? req.body.faces : [];
  if (raw.length > MAX_FACES) throw new HttpError(400, `At most ${MAX_FACES} faces per frame`);
  const descriptors = raw.map(parseDescriptor);
  const settings = await getSettings();
  const threshold = Number(settings.match_threshold) || 0.5;
  const matches = matchFaces(descriptors, await classGallery(state.class_id), threshold);
  const { fresh, needCheckpoint } = scans.recordFrame(state, descriptors.length, matches, threshold, confidence);
  if (needCheckpoint) scans.checkpoint(state).catch(() => {});
  res.json({
    matches: matches.map((m) => ({ faceIndex: m.faceIndex, student_id: m.student_id, roll_no: m.roll_no, name: m.name })),
    fresh,
    faces: descriptors.length,
    max_faces: state.maxFaces,
    recognised: state.recognised.size,
    frames: state.frames,
    seconds_left: Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)),
  });
});

router.post('/:id/finish', async (req, res) => {
  const s = await ownSession(req.user, int(req.params.id, 'Id', req_));
  if (s.status === 'scanning') {
    const state = scans.get(s.id) || scans.create(s);
    await scans.checkpoint(state, 'review');
    scans.drop(s.id);
  }
  res.json(await sessionView(await ownSession(req.user, s.id)));
});

// Final attendance: camera matches are present, the teacher's manual marks override,
// everyone else is absent.
router.post('/:id/submit', async (req, res) => {
  const s = await ownSession(req.user, int(req.params.id, 'Id', req_));
  if (s.status === 'scanning') {
    const state = scans.get(s.id) || scans.create(s);
    await scans.checkpoint(state, 'review');
    scans.drop(s.id);
    s.scan_result = scans.snapshot(state);
  } else if (s.status !== 'review') {
    throw new HttpError(409, s.status === 'saved' || s.status === 'queued' ? 'This attendance is already submitted' : 'This attendance was cancelled');
  }
  const fresh = await one('SELECT scan_result FROM attendance_sessions WHERE id = $1', [s.id]);
  const camera = new Map((fresh.scan_result?.recognised || []).map((r) => [Number(r.student_id), r]));
  const manual = req.body?.manual && typeof req.body.manual === 'object' ? req.body.manual : {};
  const roster = await query('SELECT id FROM students WHERE class_id = $1 AND active ORDER BY roll_no', [s.class_id]);
  const records = roster.map(({ id }) => {
    const m = manual[id] != null ? oneOf(manual[id], 'Mark', ['P', 'A']) : null;
    const cam = camera.get(id);
    if (m) return { student_id: id, status: m, source: 'manual', confidence: null };
    if (cam) return { student_id: id, status: 'P', source: 'camera', confidence: cam.confidence };
    return { student_id: id, status: 'A', source: 'auto', confidence: null };
  });
  const label = `${s.class_name} · ${s.subject_code} ${s.subject_name} · ${s.date}`;
  const out = await queue.submitAttendance({ session_id: Number(s.id), teacher_id: req.user.id, records, label });
  const present = records.filter((r) => r.status === 'P').length;
  audit(req.user.id, 'attendance_submitted', { session: s.id, present, total: records.length, mode: out.mode });
  res.json({ ...out, present, total: records.length });
});

router.post('/:id/cancel', async (req, res) => {
  const s = await ownSession(req.user, int(req.params.id, 'Id', req_));
  if (!['scanning', 'review'].includes(s.status)) throw new HttpError(409, 'Only an attendance that is not submitted can be cancelled');
  await query("UPDATE attendance_sessions SET status = 'cancelled' WHERE id = $1", [s.id]);
  scans.drop(s.id);
  audit(req.user.id, 'attendance_cancelled', { session: s.id });
  res.json({ ok: true });
});

// Classroom IP camera snapshot, fetched by the server (the camera password never reaches
// the browser). Only for the teacher whose scan is running in that room.
router.get('/:id/camera', async (req, res) => {
  const s = await ownSession(req.user, int(req.params.id, 'Id', req_));
  if (!['scanning', 'review'].includes(s.status)) throw new HttpError(409, 'The scan is over');
  const room = await one('SELECT camera_url FROM rooms WHERE id = $1', [s.room_id]);
  if (!room?.camera_url) throw new HttpError(404, 'No camera is set up in this room');
  const url = new URL(room.camera_url);
  const headers = {};
  if (url.username || url.password) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(8000), redirect: 'error' }); } catch { throw new HttpError(502, 'Could not reach the classroom camera'); }
  if (!r.ok) throw new HttpError(502, `Camera answered with error ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new HttpError(502, "The camera URL did not return an image. Use the camera's JPEG snapshot URL.");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new HttpError(502, 'Camera image is too large');
  res.set({ 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.send(buf);
});

module.exports = router;
