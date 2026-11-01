// Camera attendance. Nothing is marked until the teacher starts a session for their
// class + subject; camera matches and manual marks only count once the teacher submits.
// A manual mark always wins over a camera match.
const express = require('express');
const { one, all, run, tx, audit, getSetting } = require('../db');
const { HttpError, int, oneOf, today } = require('../http');
const { requireRole } = require('../auth');
const { assertTeaches } = require('../access');
const { parseDescriptor, classGallery, matchFaces } = require('../face');

const router = express.Router();
router.use(requireRole('teacher'));

const MAX_FACES = 300;

function sessionState(id) {
  const s = one(`SELECT a.*, c.name AS class_name, (c.camera_url IS NOT NULL AND c.camera_url <> '') AS has_camera,
    sub.code AS subject_code, sub.name AS subject_name
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects sub ON sub.id = a.subject_id WHERE a.id = ?`, id);
  if (!s) throw new HttpError(404, 'Attendance session not found');

  const students = s.status === 'open'
    ? all(`SELECT u.id, u.name, st.roll_no, m.status, m.source, m.distance,
        (SELECT COUNT(*) FROM face_samples f WHERE f.student_id = u.id) AS face_samples,
        EXISTS (SELECT 1 FROM leave_requests l WHERE l.student_id = u.id AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date) AS on_leave
        FROM students st JOIN users u ON u.id = st.user_id
        LEFT JOIN attendance_marks m ON m.session_id = ? AND m.student_id = u.id
        WHERE st.class_id = ? AND u.active = 1 ORDER BY st.roll_no`, s.date, id, s.class_id)
    : all(`SELECT u.id, u.name, st.roll_no, m.status, m.source, m.distance, 0 AS face_samples
        FROM attendance_marks m JOIN users u ON u.id = m.student_id JOIN students st ON st.user_id = m.student_id
        WHERE m.session_id = ? ORDER BY st.roll_no`, id);

  const count = (fn) => students.filter(fn).length;
  return {
    session: s,
    students,
    counts: {
      registered: students.length,
      enrolled: count((x) => x.face_samples > 0),
      faces_last: s.last_faces,
      faces_max: s.max_faces,
      captures: s.captures,
      recognised: count((x) => x.status === 'present' && x.source === 'camera'),
      manual_present: count((x) => x.status === 'present' && x.source === 'manual'),
      present: count((x) => x.status === 'present'),
      absent: count((x) => x.status === 'absent'),
      unmarked: count((x) => !x.status),
    },
  };
}

function ownOpenSession(user, id) {
  const s = one('SELECT * FROM attendance_sessions WHERE id = ?', id);
  if (!s || s.teacher_id !== user.id) throw new HttpError(404, 'Attendance session not found');
  if (s.status !== 'open') throw new HttpError(409, `This attendance is already ${s.status}`);
  return s;
}

// Start (or resume today's) attendance for a class + subject.
router.post('/sessions', (req, res) => {
  const classId = int(req.body?.class_id, 'Class', { required: true });
  const subjectId = int(req.body?.subject_id, 'Subject', { required: true });
  assertTeaches(req.user, classId, subjectId);
  const day = today();
  const id = tx(() => {
    // An open session left over from an earlier day was never submitted: drop it.
    run(`UPDATE attendance_sessions SET status = 'cancelled' WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND status = 'open' AND date <> ?`,
      req.user.id, classId, subjectId, day);
    const open = one(`SELECT id FROM attendance_sessions WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND status = 'open'`,
      req.user.id, classId, subjectId);
    if (open) return open.id;
    const registered = one(`SELECT COUNT(*) AS n FROM students s JOIN users u ON u.id = s.user_id WHERE s.class_id = ? AND u.active = 1`, classId).n;
    if (!registered) throw new HttpError(400, 'No students are registered in this class');
    const r = run('INSERT INTO attendance_sessions(class_id, subject_id, teacher_id, date, registered_count) VALUES (?, ?, ?, ?, ?)',
      classId, subjectId, req.user.id, day, registered);
    audit(req.user.id, 'attendance_started', { session: Number(r.lastInsertRowid), classId, subjectId });
    return Number(r.lastInsertRowid);
  });
  const submittedToday = one(`SELECT COUNT(*) AS n FROM attendance_sessions WHERE class_id = ? AND subject_id = ? AND date = ? AND status = 'submitted'`,
    classId, subjectId, day).n;
  res.status(201).json({ ...sessionState(id), submitted_today: submittedToday });
});

router.get('/sessions/:id', (req, res) => {
  const state = sessionState(int(req.params.id, 'Id', { required: true }));
  if (state.session.teacher_id !== req.user.id) throw new HttpError(404, 'Attendance session not found');
  res.json(state);
});

// One camera capture: the browser sends a descriptor for every face it found.
router.post('/sessions/:id/recognize', (req, res) => {
  const s = ownOpenSession(req.user, int(req.params.id, 'Id', { required: true }));
  assertTeaches(req.user, s.class_id, s.subject_id);
  const raw = Array.isArray(req.body?.faces) ? req.body.faces : [];
  if (raw.length > MAX_FACES) throw new HttpError(400, `At most ${MAX_FACES} faces per capture`);
  const descriptors = raw.map(parseDescriptor);
  const threshold = Number(getSetting('match_threshold')) || 0.5;
  const matches = matchFaces(descriptors, classGallery(s.class_id), threshold);

  tx(() => {
    for (const m of matches) {
      const existing = one('SELECT source, distance FROM attendance_marks WHERE session_id = ? AND student_id = ?', s.id, m.student_id);
      if (existing?.source === 'manual') { m.kept_manual = true; continue; }
      if (existing) {
        run(`UPDATE attendance_marks SET status = 'present', source = 'camera', distance = MIN(COALESCE(distance, 9), ?), marked_at = datetime('now')
          WHERE session_id = ? AND student_id = ?`, m.distance, s.id, m.student_id);
      } else {
        run(`INSERT INTO attendance_marks(session_id, student_id, status, source, distance) VALUES (?, ?, 'present', 'camera', ?)`, s.id, m.student_id, m.distance);
      }
    }
    run(`UPDATE attendance_sessions SET last_faces = ?, max_faces = MAX(COALESCE(max_faces, 0), ?), captures = captures + 1 WHERE id = ?`,
      descriptors.length, descriptors.length, s.id);
  });
  res.json({ matches, unknown: descriptors.length - matches.length, threshold, ...sessionState(s.id) });
});

// Teacher's manual mark. status null clears the mark (back to "not marked").
router.put('/sessions/:id/marks', (req, res) => {
  const s = ownOpenSession(req.user, int(req.params.id, 'Id', { required: true }));
  const studentId = int(req.body?.student_id, 'Student', { required: true });
  const status = oneOf(req.body?.status ?? null, 'Status', ['present', 'absent']);
  const inClass = one('SELECT 1 FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.class_id = ? AND u.active = 1', studentId, s.class_id);
  if (!inClass) throw new HttpError(400, 'Student is not in this class');
  if (status == null) {
    run('DELETE FROM attendance_marks WHERE session_id = ? AND student_id = ?', s.id, studentId);
  } else {
    run(`INSERT INTO attendance_marks(session_id, student_id, status, source) VALUES (?, ?, ?, 'manual')
      ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, source = 'manual', distance = NULL, marked_at = datetime('now')`,
    s.id, studentId, status);
  }
  res.json(sessionState(s.id));
});

// Mark every student who has no mark yet.
router.post('/sessions/:id/mark-rest', (req, res) => {
  const s = ownOpenSession(req.user, int(req.params.id, 'Id', { required: true }));
  const status = oneOf(req.body?.status, 'Status', ['present', 'absent'], { required: true });
  run(`INSERT INTO attendance_marks(session_id, student_id, status, source)
    SELECT ?, s.user_id, ?, 'manual' FROM students s JOIN users u ON u.id = s.user_id
    WHERE s.class_id = ? AND u.active = 1 AND s.user_id NOT IN (SELECT student_id FROM attendance_marks WHERE session_id = ?)`,
  s.id, status, s.class_id, s.id);
  res.json(sessionState(s.id));
});

router.post('/sessions/:id/submit', (req, res) => {
  const s = ownOpenSession(req.user, int(req.params.id, 'Id', { required: true }));
  tx(() => {
    run(`INSERT INTO attendance_marks(session_id, student_id, status, source)
      SELECT ?, s.user_id, 'absent', 'auto' FROM students s JOIN users u ON u.id = s.user_id
      WHERE s.class_id = ? AND u.active = 1 AND s.user_id NOT IN (SELECT student_id FROM attendance_marks WHERE session_id = ?)`, s.id, s.class_id, s.id);
    const registered = one('SELECT COUNT(*) AS n FROM attendance_marks WHERE session_id = ?', s.id).n;
    run(`UPDATE attendance_sessions SET status = 'submitted', submitted_at = datetime('now'), registered_count = ? WHERE id = ?`, registered, s.id);
  });
  const state = sessionState(s.id);
  audit(req.user.id, 'attendance_submitted', { session: s.id, ...state.counts });
  res.json(state);
});

router.post('/sessions/:id/cancel', (req, res) => {
  const s = ownOpenSession(req.user, int(req.params.id, 'Id', { required: true }));
  tx(() => {
    run('DELETE FROM attendance_marks WHERE session_id = ?', s.id);
    run("UPDATE attendance_sessions SET status = 'cancelled' WHERE id = ?", s.id);
  });
  audit(req.user.id, 'attendance_cancelled', { session: s.id });
  res.json({ ok: true });
});

module.exports = router;
