// Assignments: the teacher posts work for a class + subject, students submit a written
// answer and/or a file (max 2 MB), the teacher grades with marks and feedback.
const express = require('express');
const { one, all, run, audit } = require('../db');
const { HttpError, str, int, num, date } = require('../http');
const { requireRole } = require('../auth');
const { assertTeaches } = require('../access');

const router = express.Router();
const req_ = { required: true };
const MAX_FILE = 2 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];

function ownHomework(user, id) {
  const hw = one('SELECT * FROM homework WHERE id = ?', id);
  if (!hw || hw.teacher_id !== user.id) throw new HttpError(404, 'Assignment not found');
  return hw;
}

// ---- Teacher ----
router.get('/teacher', requireRole('teacher'), (req, res) => {
  res.json(all(`SELECT h.*, c.name AS class_name, s.code AS subject_code, s.name AS subject_name,
    (SELECT COUNT(*) FROM homework_submissions x WHERE x.homework_id = h.id) AS submitted,
    (SELECT COUNT(*) FROM homework_submissions x WHERE x.homework_id = h.id AND x.marks IS NULL) AS to_grade,
    (SELECT COUNT(*) FROM students st JOIN users u ON u.id = st.user_id WHERE st.class_id = h.class_id AND u.active = 1) AS class_size
    FROM homework h JOIN classes c ON c.id = h.class_id JOIN subjects s ON s.id = h.subject_id
    WHERE h.teacher_id = ? ORDER BY h.due_date DESC, h.id DESC`, req.user.id));
});

router.post('/', requireRole('teacher'), (req, res) => {
  const b = req.body || {};
  const classId = int(b.class_id, 'Class', req_);
  const subjectId = int(b.subject_id, 'Subject', req_);
  assertTeaches(req.user, classId, subjectId);
  const r = run('INSERT INTO homework(class_id, subject_id, teacher_id, title, description, due_date, max_marks) VALUES (?, ?, ?, ?, ?, ?, ?)',
    classId, subjectId, req.user.id, str(b.title, 'Title', req_), str(b.description, 'Description', { max: 5000 }),
    date(b.due_date, 'Due date', req_), num(b.max_marks ?? 10, 'Max marks', { required: true, min: 1, max: 1000 }));
  audit(req.user.id, 'homework_created', { id: Number(r.lastInsertRowid) });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/:id', requireRole('teacher'), (req, res) => {
  const hw = ownHomework(req.user, int(req.params.id, 'Id', req_));
  run('DELETE FROM homework WHERE id = ?', hw.id);
  res.json({ ok: true });
});

router.get('/:id/submissions', requireRole('teacher'), (req, res) => {
  const hw = ownHomework(req.user, int(req.params.id, 'Id', req_));
  res.json({
    homework: hw,
    students: all(`SELECT u.id, u.name, st.roll_no, x.answer, x.file_name, x.submitted_at, x.marks, x.feedback,
      (x.submitted_at > ? || ' 23:59:59') AS late
      FROM students st JOIN users u ON u.id = st.user_id LEFT JOIN homework_submissions x ON x.homework_id = ? AND x.student_id = u.id
      WHERE st.class_id = ? AND u.active = 1 ORDER BY st.roll_no`, hw.due_date, hw.id, hw.class_id),
  });
});

router.put('/:id/submissions/:studentId', requireRole('teacher'), (req, res) => {
  const hw = ownHomework(req.user, int(req.params.id, 'Id', req_));
  const r = run('UPDATE homework_submissions SET marks = ?, feedback = ? WHERE homework_id = ? AND student_id = ?',
    num(req.body?.marks, 'Marks', { min: 0, max: hw.max_marks }), str(req.body?.feedback, 'Feedback', { max: 1000 }), hw.id, int(req.params.studentId, 'Student', req_));
  if (!r.changes) throw new HttpError(404, 'No submission from this student');
  res.json({ ok: true });
});

// ---- Student ----
router.get('/student', requireRole('student'), (req, res) => {
  res.json(all(`SELECT h.id, h.title, h.description, h.due_date, h.max_marks, h.created_at, s.code AS subject_code, s.name AS subject_name,
    t.name AS teacher_name, x.submitted_at, x.file_name, x.answer, x.marks, x.feedback
    FROM homework h JOIN subjects s ON s.id = h.subject_id JOIN users t ON t.id = h.teacher_id
    JOIN students st ON st.class_id = h.class_id AND st.user_id = ?
    LEFT JOIN homework_submissions x ON x.homework_id = h.id AND x.student_id = st.user_id
    ORDER BY (x.submitted_at IS NOT NULL), h.due_date, h.id DESC`, req.user.id));
});

router.post('/:id/submit', requireRole('student'), (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const hw = one('SELECT h.* FROM homework h JOIN students st ON st.class_id = h.class_id AND st.user_id = ? WHERE h.id = ?', req.user.id, id);
  if (!hw) throw new HttpError(404, 'Assignment not found');
  const prev = one('SELECT marks FROM homework_submissions WHERE homework_id = ? AND student_id = ?', id, req.user.id);
  if (prev?.marks != null) throw new HttpError(409, 'Already graded; it cannot be changed now');
  const answer = str(req.body?.answer, 'Answer', { max: 20000 });
  let file = null;
  const f = req.body?.file;
  if (f) {
    const type = String(f.type || '');
    if (!FILE_TYPES.includes(type)) throw new HttpError(400, 'File must be PDF, Word, PowerPoint, JPG, PNG or text');
    const data = Buffer.from(String(f.data || ''), 'base64');
    if (!data.length || data.length > MAX_FILE) throw new HttpError(400, 'File must be under 2 MB');
    file = { name: str(f.name, 'File name', { required: true, max: 150 }).replace(/[^\w.\- ]+/g, '_'), type, data };
  }
  if (!answer && !file) throw new HttpError(400, 'Write an answer or attach a file');
  run(`INSERT INTO homework_submissions(homework_id, student_id, answer, file_name, file_type, file_data) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(homework_id, student_id) DO UPDATE SET answer = excluded.answer, file_name = excluded.file_name, file_type = excluded.file_type,
    file_data = excluded.file_data, submitted_at = datetime('now')`, id, req.user.id, answer, file?.name ?? null, file?.type ?? null, file?.data ?? null);
  res.json({ ok: true });
});

// File download: the student who submitted it, or the teacher who set the work.
router.get('/:id/file/:studentId', requireRole('teacher', 'student'), (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const studentId = int(req.params.studentId, 'Student', req_);
  if (req.user.role === 'student' && req.user.id !== studentId) throw new HttpError(403, 'Not your submission');
  if (req.user.role === 'teacher') ownHomework(req.user, id);
  const x = one('SELECT file_name, file_type, file_data FROM homework_submissions WHERE homework_id = ? AND student_id = ?', id, studentId);
  if (!x?.file_data) throw new HttpError(404, 'No file');
  res.set({ 'Content-Type': x.file_type, 'Content-Disposition': `attachment; filename="${x.file_name}"`, 'Cache-Control': 'no-store' });
  res.send(Buffer.from(x.file_data));
});

module.exports = router;
