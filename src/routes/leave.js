// Student leave applications. Teachers of the student's class (or the admin) approve them;
// approved leave shows up on the attendance screen so the teacher knows why someone is away.
const express = require('express');
const { one, all, run, audit } = require('../db');
const { HttpError, str, int, date, oneOf } = require('../http');
const { requireRole } = require('../auth');

const router = express.Router();
const TYPES = ['personal', 'medical', 'family', 'event', 'other'];

const LIST_SQL = `SELECT l.*, u.name AS student_name, s.roll_no, c.name AS class_name, r.name AS reviewed_by_name
  FROM leave_requests l JOIN students s ON s.user_id = l.student_id JOIN users u ON u.id = l.student_id
  JOIN classes c ON c.id = s.class_id LEFT JOIN users r ON r.id = l.reviewed_by`;

router.get('/mine', requireRole('student'), (req, res) => {
  res.json(all(`${LIST_SQL} WHERE l.student_id = ? ORDER BY l.created_at DESC, l.id DESC`, req.user.id));
});

router.post('/', requireRole('student'), (req, res) => {
  const b = req.body || {};
  const from = date(b.from_date, 'From date', { required: true });
  const to = date(b.to_date, 'To date', { required: true });
  if (to < from) throw new HttpError(400, 'To date cannot be before From date');
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 30) throw new HttpError(400, 'A single leave can be at most 31 days');
  const r = run('INSERT INTO leave_requests(student_id, from_date, to_date, leave_type, reason) VALUES (?, ?, ?, ?, ?)',
    req.user.id, from, to, oneOf(b.leave_type || 'personal', 'Leave type', TYPES), str(b.reason, 'Reason', { required: true, max: 1000 }));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/:id', requireRole('student'), (req, res) => {
  const r = run("DELETE FROM leave_requests WHERE id = ? AND student_id = ? AND status = 'pending'", int(req.params.id, 'Id', { required: true }), req.user.id);
  if (!r.changes) throw new HttpError(400, 'Only a pending leave can be withdrawn');
  res.json({ ok: true });
});

router.get('/', requireRole('admin', 'teacher'), (req, res) => {
  const status = oneOf(req.query.status || null, 'Status', ['pending', 'approved', 'rejected']);
  const where = [];
  const params = [];
  if (req.user.role === 'teacher') { where.push('s.class_id IN (SELECT class_id FROM assignments WHERE teacher_id = ?)'); params.push(req.user.id); }
  if (status) { where.push('l.status = ?'); params.push(status); }
  res.json(all(`${LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.status = 'pending' DESC, l.created_at DESC LIMIT 300`, ...params));
});

router.put('/:id', requireRole('admin', 'teacher'), (req, res) => {
  const id = int(req.params.id, 'Id', { required: true });
  const leave = one('SELECT l.*, s.class_id FROM leave_requests l JOIN students s ON s.user_id = l.student_id WHERE l.id = ?', id);
  if (!leave) throw new HttpError(404, 'Leave not found');
  if (req.user.role === 'teacher' && !one('SELECT 1 FROM assignments WHERE teacher_id = ? AND class_id = ?', req.user.id, leave.class_id)) {
    throw new HttpError(403, 'You do not teach this student');
  }
  const status = oneOf(req.body?.status, 'Status', ['approved', 'rejected'], { required: true });
  run("UPDATE leave_requests SET status = ?, remark = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
    status, str(req.body?.remark, 'Remark', { max: 500 }), req.user.id, id);
  audit(req.user.id, `leave_${status}`, { id });
  res.json({ ok: true });
});

module.exports = router;
