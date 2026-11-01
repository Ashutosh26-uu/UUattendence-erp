const express = require('express');
const { one, all } = require('../db');
const { requireRole } = require('../auth');
const { studentAttendance } = require('../reports');

const router = express.Router();
router.use(requireRole('student'));

function fees(studentId) {
  const classId = one('SELECT class_id FROM students WHERE user_id = ?', studentId).class_id;
  const items = all(`SELECT f.id, f.title, f.amount, f.due_date,
    COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.fee_id = f.id AND p.student_id = ?), 0) AS paid
    FROM fee_structures f WHERE f.class_id = ? ORDER BY f.due_date`, studentId, classId)
    .map((f) => ({ ...f, due: Math.max(0, f.amount - f.paid) }));
  const payments = all(`SELECT p.receipt_no, p.amount, p.paid_on, p.mode, f.title FROM fee_payments p JOIN fee_structures f ON f.id = p.fee_id
    WHERE p.student_id = ? ORDER BY p.paid_on DESC, p.id DESC`, studentId);
  const sum = (k) => items.reduce((a, f) => a + f[k], 0);
  return { items, payments, total: sum('amount'), paid: sum('paid'), due: sum('due') };
}

function marks(studentId) {
  return all(`SELECT e.id, e.name, e.max_marks, e.exam_date, sub.code AS subject_code, sub.name AS subject_name, m.marks
    FROM exams e JOIN subjects sub ON sub.id = e.subject_id JOIN students s ON s.class_id = e.class_id AND s.user_id = ?
    LEFT JOIN marks m ON m.exam_id = e.id AND m.student_id = s.user_id ORDER BY e.exam_date DESC, e.id DESC`, studentId);
}

router.get('/attendance', (req, res) => {
  res.json({
    ...studentAttendance(req.user.id),
    recent: all(`SELECT a.date, sub.code AS subject_code, sub.name AS subject_name, m.status, m.source
      FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN subjects sub ON sub.id = a.subject_id
      WHERE m.student_id = ? AND a.status = 'submitted' ORDER BY a.date DESC, a.id DESC LIMIT 100`, req.user.id),
  });
});

router.get('/marks', (req, res) => res.json(marks(req.user.id)));
router.get('/fees', (req, res) => res.json(fees(req.user.id)));

router.get('/dashboard', (req, res) => {
  const f = fees(req.user.id);
  res.json({
    attendance: studentAttendance(req.user.id),
    fees: { total: f.total, paid: f.paid, due: f.due },
    recent_marks: marks(req.user.id).filter((m) => m.marks != null).slice(0, 5),
    homework_due: all(`SELECT h.id, h.title, h.due_date, s.code AS subject_code FROM homework h JOIN subjects s ON s.id = h.subject_id
      JOIN students st ON st.class_id = h.class_id AND st.user_id = ?
      WHERE NOT EXISTS (SELECT 1 FROM homework_submissions x WHERE x.homework_id = h.id AND x.student_id = st.user_id)
      ORDER BY h.due_date LIMIT 5`, req.user.id),
    books_out: one('SELECT COUNT(*) AS n FROM book_issues WHERE user_id = ? AND returned_on IS NULL', req.user.id).n,
    last_leave: one('SELECT from_date, to_date, status FROM leave_requests WHERE student_id = ? ORDER BY id DESC LIMIT 1', req.user.id) || null,
  });
});

module.exports = router;
