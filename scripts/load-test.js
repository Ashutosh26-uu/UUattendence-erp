// Load test for the attendance write path and face matching, in a throw-away database.
//   npm run loadtest            (1000 classes x 60 students submitting at the same moment)
//   CLASSES=2000 npm run loadtest
// Uses DATABASE_URL if set (test against the real PostgreSQL server), otherwise embedded PGlite.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

if (!process.env.DATABASE_URL) process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-loadtest-'));
const db = require('../src/db');

const CLASSES = Number(process.env.CLASSES) || 1000;
const STUDENTS = 60;
const ms = (t) => `${Math.round(performance.now() - t)} ms`;

async function main() {
  await db.connect();
  const queue = require('../src/queue');
  const { matchFaces, distance } = require('../src/face');
  console.log(`Database: ${db.mode()}`);

  // Setup: one class of 60 students, CLASSES attendance sessions waiting for submit.
  const t0 = performance.now();
  const dept = (await db.one("INSERT INTO departments (code, name) VALUES ('LT', 'Load test') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id")).id;
  const cls = (await db.one("INSERT INTO classes (name, department_id) VALUES ('LT class', $1) ON CONFLICT (name) DO UPDATE SET department_id = EXCLUDED.department_id RETURNING id", [dept])).id;
  const subj = (await db.one("INSERT INTO subjects (code, name) VALUES ('LT101', 'Load') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id")).id;
  const teacher = (await db.one("INSERT INTO users (username, password_hash, role, name) VALUES ('lt_teacher', 'x', 'teacher', 'Load Teacher') ON CONFLICT DO NOTHING RETURNING id")
    || await db.one("SELECT id FROM users WHERE username = 'lt_teacher'")).id;
  await db.query(`INSERT INTO students (roll_no, name, class_id) SELECT 'LT' || g, 'Student ' || g, $1 FROM generate_series(1, ${STUDENTS}) g ON CONFLICT DO NOTHING`, [cls]);
  const students = (await db.query('SELECT id FROM students WHERE class_id = $1 ORDER BY id LIMIT $2', [cls, STUDENTS])).map((r) => r.id);
  // One lecture per session keeps the "one attendance per lecture per day" rule satisfied.
  await db.query(`INSERT INTO lectures (teacher_id, class_id, subject_id, day, start_time, end_time)
    SELECT $1, $2, $3, 1, '09:00', '10:00' FROM generate_series(1, ${CLASSES})`, [teacher, cls, subj]);
  const lectureIds = (await db.query('SELECT id FROM lectures WHERE class_id = $1 ORDER BY id DESC LIMIT $2', [cls, CLASSES])).map((r) => r.id);
  const sessions = (await db.query(`INSERT INTO attendance_sessions (lecture_id, class_id, subject_id, teacher_id, date, status, registered_count, scan_ends_at)
    SELECT l, $1, $2, $3, CURRENT_DATE + (random() * 1000)::int, 'review', ${STUDENTS}, now() FROM unnest($4::int[]) l RETURNING id`, [cls, subj, teacher, lectureIds])).map((r) => Number(r.id));
  console.log(`Setup: ${CLASSES} classes waiting to submit (${ms(t0)})`);

  // Burst: every class submits at once.
  const payload = (sid, k) => ({
    session_id: sid, teacher_id: teacher, label: 'load test',
    records: students.map((id, i) => ({ student_id: id, status: (i + k) % 10 < 8 ? 'P' : 'A', source: i % 7 ? 'camera' : 'auto', confidence: 0.7 })),
  });
  const t1 = performance.now();
  const results = await Promise.all(sessions.map((sid, k) => queue.submitAttendance(payload(sid, k))));
  const direct = results.filter((r) => r.mode === 'direct').length;
  const queued = results.length - direct;
  console.log(`Burst: ${CLASSES} submissions answered in ${ms(t1)} -> ${direct} saved directly, ${queued} queued (threshold ${(await db.getSettings()).queue_threshold}/min)`);

  // Traffic drops (the gap after the lecture): the worker saves the queue.
  await db.setSettings({ queue_threshold: 1e9 });
  const t2 = performance.now();
  for (;;) {
    await queue.tick();
    const m = await queue.metrics();
    if (!m.pending) break;
  }
  console.log(`Queue drained: ${queued} attendance sheets saved in ${ms(t2)}`);

  const check = await db.one(`SELECT count(*)::int AS sessions, sum(present_count)::int AS present FROM attendance_sessions WHERE id = ANY($1::bigint[]) AND status = 'saved'`, [sessions]);
  const rows = await db.one('SELECT count(*)::int AS n FROM attendance_records WHERE session_id = ANY($1::bigint[])', [sessions]);
  console.log(`Check: ${check.sessions}/${CLASSES} sessions saved, ${rows.n} attendance rows (expected ${CLASSES * STUDENTS})`);

  // Face matching: a frame with 60 faces against a class of 60 students x 3 photos.
  const rnd = () => Array.from({ length: 128 }, () => Math.random() * 0.2 - 0.1);
  const gallery = students.map((id, i) => ({ student_id: id, name: `S${i}`, roll_no: `LT${i}`, descriptors: [0, 1, 2].map(() => Float32Array.from(rnd())) }));
  const frame = gallery.map((g) => Float32Array.from(g.descriptors[0].map((x) => x + (Math.random() - 0.5) * 0.01)));
  const t3 = performance.now();
  const N = 200;
  let matched = 0;
  for (let i = 0; i < N; i++) matched = matchFaces(frame, gallery, 0.5).length;
  const per = (performance.now() - t3) / N;
  console.log(`Matching: ${per.toFixed(2)} ms per 60-face frame (${matched}/60 matched). One CPU core can serve ~${Math.round(1000 / per)} frames/s, i.e. ~${Math.round((1000 / per) * 3)} classes scanning at once (1 frame every 3 s).`);
  void distance;
  await db.query('SELECT 1');
  process.exit(check.sessions === CLASSES && rows.n === CLASSES * STUDENTS ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
