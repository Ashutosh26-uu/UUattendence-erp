// Teacher feedback (anonymous to teachers) and grievance tickets.
const express = require('express');
const { one, all, run, audit, getSetting } = require('../db');
const { HttpError, str, int, oneOf } = require('../http');
const { requireRole } = require('../auth');

const router = express.Router();
const req_ = { required: true };

const QUESTIONS = [
  'Explains concepts clearly',
  'Comes prepared and completes the syllabus',
  'Is punctual and regular',
  'Encourages questions and doubts',
  'Overall teaching quality',
];

// ---- Feedback ----
router.get('/feedback/form', requireRole('student'), (req, res) => {
  const cycle = getSetting('feedback_cycle');
  res.json({
    open: getSetting('feedback_open') === '1',
    cycle,
    questions: QUESTIONS,
    subjects: all(`SELECT a.subject_id, s.code, s.name, u.name AS teacher_name,
      EXISTS (SELECT 1 FROM feedback f WHERE f.student_id = st.user_id AND f.subject_id = a.subject_id AND f.cycle = ?) AS done
      FROM students st JOIN assignments a ON a.class_id = st.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id
      WHERE st.user_id = ? ORDER BY s.code`, cycle, req.user.id),
  });
});

router.post('/feedback', requireRole('student'), (req, res) => {
  if (getSetting('feedback_open') !== '1') throw new HttpError(409, 'Feedback is closed right now');
  const subjectId = int(req.body?.subject_id, 'Subject', req_);
  const a = one('SELECT a.teacher_id FROM assignments a JOIN students st ON st.class_id = a.class_id WHERE st.user_id = ? AND a.subject_id = ?', req.user.id, subjectId);
  if (!a) throw new HttpError(404, 'This subject is not in your class');
  const q = [1, 2, 3, 4, 5].map((i) => int(req.body?.[`q${i}`], `Question ${i}`, { required: true, min: 1, max: 5 }));
  const cycle = getSetting('feedback_cycle');
  if (one('SELECT 1 FROM feedback WHERE student_id = ? AND subject_id = ? AND cycle = ?', req.user.id, subjectId, cycle)) {
    throw new HttpError(409, 'You already gave feedback for this subject');
  }
  run('INSERT INTO feedback(student_id, teacher_id, subject_id, cycle, q1, q2, q3, q4, q5, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    req.user.id, a.teacher_id, subjectId, cycle, ...q, str(req.body?.comment, 'Comment', { max: 1000 }));
  res.status(201).json({ ok: true });
});

// Averages per teacher + subject. Teachers see only their own, never who wrote what.
router.get('/feedback/summary', requireRole('admin', 'teacher'), (req, res) => {
  const cycle = str(req.query.cycle, 'Cycle', { max: 60 }) || getSetting('feedback_cycle');
  const own = req.user.role === 'teacher';
  const rows = all(`SELECT f.teacher_id, u.name AS teacher_name, f.subject_id, s.code, s.name AS subject_name, COUNT(*) AS responses,
    ROUND(AVG(f.q1), 2) AS q1, ROUND(AVG(f.q2), 2) AS q2, ROUND(AVG(f.q3), 2) AS q3, ROUND(AVG(f.q4), 2) AS q4, ROUND(AVG(f.q5), 2) AS q5,
    ROUND(AVG((f.q1 + f.q2 + f.q3 + f.q4 + f.q5) / 5.0), 2) AS overall
    FROM feedback f JOIN users u ON u.id = f.teacher_id JOIN subjects s ON s.id = f.subject_id
    WHERE f.cycle = ? ${own ? 'AND f.teacher_id = ?' : ''} GROUP BY f.teacher_id, f.subject_id ORDER BY overall DESC`, ...(own ? [cycle, req.user.id] : [cycle]));
  const comments = all(`SELECT f.comment, s.code, u.name AS teacher_name FROM feedback f JOIN subjects s ON s.id = f.subject_id JOIN users u ON u.id = f.teacher_id
    WHERE f.cycle = ? AND f.comment IS NOT NULL ${own ? 'AND f.teacher_id = ?' : ''} ORDER BY f.id DESC LIMIT 200`, ...(own ? [cycle, req.user.id] : [cycle]));
  res.json({ cycle, questions: QUESTIONS, rows, comments });
});

// ---- Grievances ----
const CATEGORIES = ['academic', 'examination', 'fees', 'hostel', 'transport', 'library', 'ragging / harassment', 'infrastructure', 'other'];

router.get('/grievances/categories', requireRole(), (req, res) => res.json(CATEGORIES));

router.post('/grievances', requireRole('student', 'teacher'), (req, res) => {
  const r = run('INSERT INTO grievances(user_id, category, subject, description) VALUES (?, ?, ?, ?)', req.user.id,
    oneOf(req.body?.category, 'Category', CATEGORIES, req_), str(req.body?.subject, 'Subject', req_), str(req.body?.description, 'Description', { required: true, max: 5000 }));
  res.status(201).json({ id: Number(r.lastInsertRowid), ticket: `GRV-${String(r.lastInsertRowid).padStart(5, '0')}` });
});

router.get('/grievances/mine', requireRole('student', 'teacher'), (req, res) => {
  res.json(all('SELECT * FROM grievances WHERE user_id = ? ORDER BY id DESC', req.user.id));
});

router.get('/grievances', requireRole('admin'), (req, res) => {
  res.json(all(`SELECT g.*, u.name AS user_name, u.role, s.roll_no FROM grievances g JOIN users u ON u.id = g.user_id
    LEFT JOIN students s ON s.user_id = g.user_id ORDER BY g.status = 'resolved', g.id DESC LIMIT 500`));
});

router.put('/grievances/:id', requireRole('admin'), (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const r = run("UPDATE grievances SET status = ?, response = ?, updated_at = datetime('now') WHERE id = ?",
    oneOf(req.body?.status, 'Status', ['open', 'in_progress', 'resolved'], req_), str(req.body?.response, 'Response', { max: 5000 }), id);
  if (!r.changes) throw new HttpError(404, 'Grievance not found');
  audit(req.user.id, 'grievance_updated', { id, status: req.body?.status });
  res.json({ ok: true });
});

module.exports = router;
