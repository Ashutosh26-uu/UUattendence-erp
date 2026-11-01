const express = require('express');
const { one, all, run, tx, audit } = require('../db');
const { HttpError, str, int, num, date, csv } = require('../http');
const { requireRole } = require('../auth');
const { assertClassAccess, assertTeaches } = require('../access');
const { classAttendanceReport } = require('../reports');

const router = express.Router();
router.use(requireRole('teacher'));

const req_ = { required: true };

// The teacher's class+subject pairs with the numbers the attendance screen needs.
router.get('/assignments', (req, res) => {
  res.json(all(`SELECT a.id, a.class_id, a.subject_id, c.name AS class_name, s.code AS subject_code, s.name AS subject_name,
    (c.camera_url IS NOT NULL AND c.camera_url <> '') AS has_camera,
    (SELECT COUNT(*) FROM students st JOIN users u ON u.id = st.user_id WHERE st.class_id = a.class_id AND u.active = 1) AS registered,
    (SELECT COUNT(DISTINCT f.student_id) FROM face_samples f JOIN students st ON st.user_id = f.student_id JOIN users u ON u.id = st.user_id
      WHERE st.class_id = a.class_id AND u.active = 1) AS enrolled,
    (SELECT x.id FROM attendance_sessions x WHERE x.class_id = a.class_id AND x.subject_id = a.subject_id AND x.teacher_id = a.teacher_id
      AND x.status = 'open' ORDER BY x.id DESC LIMIT 1) AS open_session_id
    FROM assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
    WHERE a.teacher_id = ? ORDER BY c.name, s.code`, req.user.id));
});

router.get('/classes', (req, res) => {
  res.json(all(`SELECT DISTINCT c.id, c.name, (c.camera_url IS NOT NULL AND c.camera_url <> '') AS has_camera
    FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.teacher_id = ? ORDER BY c.name`, req.user.id));
});

router.get('/classes/:classId/students', (req, res) => {
  const classId = int(req.params.classId, 'Class', req_);
  assertClassAccess(req.user, classId);
  res.json(all(`SELECT u.id, u.name, s.roll_no, u.phone, s.guardian_name, s.guardian_phone,
    (SELECT COUNT(*) FROM face_samples f WHERE f.student_id = u.id) AS face_samples
    FROM students s JOIN users u ON u.id = s.user_id WHERE s.class_id = ? AND u.active = 1 ORDER BY s.roll_no`, classId));
});

router.get('/sessions', (req, res) => {
  res.json(all(`SELECT a.*, c.name AS class_name, s.code AS subject_code, s.name AS subject_name,
    (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id = a.id AND m.status = 'present') AS present
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
    WHERE a.teacher_id = ? AND a.status <> 'cancelled' ORDER BY a.date DESC, a.id DESC LIMIT 200`, req.user.id));
});

// ---- Exams and marks ----
function ownExam(user, examId) {
  const exam = one('SELECT * FROM exams WHERE id = ?', examId);
  if (!exam) throw new HttpError(404, 'Exam not found');
  assertTeaches(user, exam.class_id, exam.subject_id);
  return exam;
}

router.get('/exams', (req, res) => {
  res.json(all(`SELECT e.*, c.name AS class_name, s.code AS subject_code, s.name AS subject_name,
    (SELECT COUNT(*) FROM marks m WHERE m.exam_id = e.id) AS marked
    FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects s ON s.id = e.subject_id
    JOIN assignments a ON a.class_id = e.class_id AND a.subject_id = e.subject_id
    WHERE a.teacher_id = ? ORDER BY e.exam_date DESC, e.id DESC`, req.user.id));
});

router.post('/exams', (req, res) => {
  const b = req.body || {};
  const classId = int(b.class_id, 'Class', req_);
  const subjectId = int(b.subject_id, 'Subject', req_);
  assertTeaches(req.user, classId, subjectId);
  const r = run('INSERT INTO exams(class_id, subject_id, name, max_marks, exam_date, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    classId, subjectId, str(b.name, 'Exam name', req_), num(b.max_marks, 'Max marks', { required: true, min: 1, max: 1000 }), date(b.exam_date, 'Exam date'), req.user.id);
  audit(req.user.id, 'exam_created', { id: Number(r.lastInsertRowid) });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/exams/:id', (req, res) => {
  const exam = ownExam(req.user, int(req.params.id, 'Id', req_));
  run('DELETE FROM exams WHERE id = ?', exam.id);
  audit(req.user.id, 'exam_deleted', { id: exam.id });
  res.json({ ok: true });
});

router.get('/exams/:id/marks', (req, res) => {
  const exam = ownExam(req.user, int(req.params.id, 'Id', req_));
  res.json({
    exam,
    students: all(`SELECT u.id, u.name, s.roll_no, m.marks FROM students s JOIN users u ON u.id = s.user_id
      LEFT JOIN marks m ON m.exam_id = ? AND m.student_id = u.id WHERE s.class_id = ? AND u.active = 1 ORDER BY s.roll_no`, exam.id, exam.class_id),
  });
});

router.put('/exams/:id/marks', (req, res) => {
  const exam = ownExam(req.user, int(req.params.id, 'Id', req_));
  const list = Array.isArray(req.body?.marks) ? req.body.marks : [];
  tx(() => {
    for (const item of list) {
      const studentId = int(item.student_id, 'Student', req_);
      if (!one('SELECT 1 FROM students WHERE user_id = ? AND class_id = ?', studentId, exam.class_id)) throw new HttpError(400, 'Student is not in this class');
      const marks = num(item.marks, 'Marks', { min: 0, max: exam.max_marks });
      if (marks == null) run('DELETE FROM marks WHERE exam_id = ? AND student_id = ?', exam.id, studentId);
      else run('INSERT INTO marks(exam_id, student_id, marks) VALUES (?, ?, ?) ON CONFLICT(exam_id, student_id) DO UPDATE SET marks = excluded.marks', exam.id, studentId, marks);
    }
  });
  audit(req.user.id, 'marks_saved', { exam: exam.id, count: list.length });
  res.json({ ok: true });
});

// ---- Attendance report for one of the teacher's subjects ----
router.get('/reports/attendance', (req, res) => {
  const classId = int(req.query.classId, 'Class', req_);
  const subjectId = int(req.query.subjectId, 'Subject', req_);
  assertTeaches(req.user, classId, subjectId);
  const report = classAttendanceReport(classId, subjectId);
  if (req.query.format !== 'csv') return res.json(report);
  const rows = [['Roll no', 'Name', 'Present', 'Total', '%'], ...report.students.map((s) => [s.roll_no, s.name, s.present, s.total, s.pct ?? ''])];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="attendance-report.csv"');
  res.send(`﻿${csv(rows)}`);
});

module.exports = router;
