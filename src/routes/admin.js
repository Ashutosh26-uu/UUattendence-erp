const express = require('express');
const { one, all, run, tx, audit, getSettings } = require('../db');
const { HttpError, str, int, num, date, time, oneOf, today, csv } = require('../http');
const { requireRole, hashPassword, tempPassword, checkNewPassword } = require('../auth');
const { crud } = require('../crud');
const { getClass } = require('../access');
const { classAttendanceReport } = require('../reports');

const router = express.Router();
router.use(requireRole('admin'));

const req_ = { required: true };

function cameraUrl(v) {
  const s = str(v, 'Camera URL', { max: 500 });
  if (s == null) return null;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'Camera URL is not a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Camera URL must start with http:// or https://');
  return s;
}

router.get('/stats', (req, res) => {
  const count = (sql, ...p) => one(sql, ...p).n;
  res.json({
    students: count("SELECT COUNT(*) AS n FROM students s JOIN users u ON u.id = s.user_id WHERE u.active = 1"),
    teachers: count("SELECT COUNT(*) AS n FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.active = 1"),
    classes: count('SELECT COUNT(*) AS n FROM classes'),
    subjects: count('SELECT COUNT(*) AS n FROM subjects'),
    face_enrolled: count('SELECT COUNT(DISTINCT student_id) AS n FROM face_samples'),
    sessions_today: count("SELECT COUNT(*) AS n FROM attendance_sessions WHERE date = ? AND status = 'submitted'", today()),
    sessions_open: count("SELECT COUNT(*) AS n FROM attendance_sessions WHERE status = 'open'"),
    fees_collected: one('SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments').n,
  });
});

// ---- Master data ----
crud(router, {
  path: '/departments', table: 'departments', label: 'Department',
  fields: { code: (v) => str(v, 'Code', { required: true, max: 20 }), name: (v) => str(v, 'Name', { required: true }) },
  listSql: 'SELECT * FROM departments ORDER BY code',
});

crud(router, {
  path: '/classes', table: 'classes', label: 'Class',
  fields: {
    name: (v) => str(v, 'Name', req_),
    department_id: (v) => int(v, 'Department', req_),
    semester: (v) => int(v, 'Semester', { min: 1, max: 12 }),
    section: (v) => str(v, 'Section', { max: 10 }),
    academic_year: (v) => str(v, 'Academic year', { max: 20 }),
    room: (v) => str(v, 'Room', { max: 50 }),
    camera_url: cameraUrl,
  },
  listSql: `SELECT c.*, d.name AS department_name,
    (SELECT COUNT(*) FROM students s JOIN users u ON u.id = s.user_id WHERE s.class_id = c.id AND u.active = 1) AS student_count
    FROM classes c JOIN departments d ON d.id = c.department_id ORDER BY c.name`,
});

crud(router, {
  path: '/subjects', table: 'subjects', label: 'Subject',
  fields: {
    code: (v) => str(v, 'Code', { required: true, max: 20 }),
    name: (v) => str(v, 'Name', req_),
    department_id: (v) => int(v, 'Department'),
    credits: (v) => int(v, 'Credits', { min: 0, max: 20 }),
  },
  listSql: 'SELECT s.*, d.name AS department_name FROM subjects s LEFT JOIN departments d ON d.id = s.department_id ORDER BY s.code',
});

crud(router, {
  path: '/notices', table: 'notices', label: 'Notice',
  fields: {
    title: (v) => str(v, 'Title', req_),
    body: (v) => str(v, 'Message', { required: true, max: 5000 }),
    audience: (v) => oneOf(v || 'all', 'Audience', ['all', 'teacher', 'student']),
    created_by: (v, body, req) => req.user.id,
  },
  listSql: 'SELECT n.*, u.name AS author FROM notices n LEFT JOIN users u ON u.id = n.created_by ORDER BY n.created_at DESC, n.id DESC',
});

crud(router, {
  path: '/fee-structures', table: 'fee_structures', label: 'Fee',
  fields: {
    class_id: (v) => int(v, 'Class', req_),
    title: (v) => str(v, 'Title', req_),
    amount: (v) => num(v, 'Amount', { required: true, min: 0, max: 1e8 }),
    due_date: (v) => date(v, 'Due date'),
  },
  listSql: 'SELECT f.*, c.name AS class_name FROM fee_structures f JOIN classes c ON c.id = f.class_id ORDER BY c.name, f.due_date',
});

crud(router, {
  path: '/timetable', table: 'timetable', label: 'Timetable entry',
  fields: {
    class_id: (v) => int(v, 'Class', req_),
    day: (v) => int(v, 'Day', { required: true, min: 1, max: 7 }),
    start_time: (v) => time(v, 'Start time', req_),
    end_time: (v) => time(v, 'End time', req_),
    subject_id: (v) => int(v, 'Subject', req_),
    room: (v) => str(v, 'Room', { max: 50 }),
  },
  afterValidate: (d) => { if (d.end_time <= d.start_time) throw new HttpError(400, 'End time must be after start time'); },
  listSql: `SELECT t.*, c.name AS class_name, s.code AS subject_code, s.name AS subject_name FROM timetable t
    JOIN classes c ON c.id = t.class_id JOIN subjects s ON s.id = t.subject_id ORDER BY c.name, t.day, t.start_time`,
});

// ---- Teachers and students (each is a user + a profile row) ----
function userFields(body) {
  return {
    name: str(body.name, 'Name', req_),
    username: str(body.username, 'Username', { required: true, max: 60 }),
    email: str(body.email, 'Email', { max: 120 }),
    phone: str(body.phone, 'Phone', { max: 20 }),
  };
}

function createUser(role, body) {
  const u = userFields(body);
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(u.username)) throw new HttpError(400, 'Username: 3-60 letters, digits, . _ @ -');
  const password = body.password ? String(body.password) : tempPassword();
  checkNewPassword(password);
  const r = run('INSERT INTO users(username, password_hash, role, name, email, phone, must_change_pw) VALUES (?, ?, ?, ?, ?, ?, 1)',
    u.username, hashPassword(password), role, u.name, u.email, u.phone);
  return { id: Number(r.lastInsertRowid), password };
}

function updateUser(id, role, body) {
  const u = userFields(body);
  const r = run('UPDATE users SET name = ?, username = ?, email = ?, phone = ? WHERE id = ? AND role = ?', u.name, u.username, u.email, u.phone, id, role);
  if (!r.changes) throw new HttpError(404, 'User not found');
}

const teacherProfile = (b) => [str(b.employee_no, 'Employee no', { required: true, max: 30 }), int(b.department_id, 'Department'), str(b.designation, 'Designation', { max: 60 })];

router.get('/teachers', (req, res) => {
  res.json(all(`SELECT u.id, u.username, u.name, u.email, u.phone, u.active, t.employee_no, t.department_id, t.designation, d.name AS department_name,
    (SELECT COUNT(*) FROM assignments a WHERE a.teacher_id = u.id) AS subject_count
    FROM teachers t JOIN users u ON u.id = t.user_id LEFT JOIN departments d ON d.id = t.department_id ORDER BY u.name`));
});

router.post('/teachers', (req, res) => {
  const body = req.body || {};
  const out = tx(() => {
    const p = teacherProfile(body);
    const user = createUser('teacher', body);
    run('INSERT INTO teachers(user_id, employee_no, department_id, designation) VALUES (?, ?, ?, ?)', user.id, ...p);
    return user;
  });
  audit(req.user.id, 'teacher_created', { id: out.id });
  res.status(201).json({ id: out.id, temp_password: out.password });
});

router.put('/teachers/:id', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  tx(() => {
    updateUser(id, 'teacher', req.body || {});
    run('UPDATE teachers SET employee_no = ?, department_id = ?, designation = ? WHERE user_id = ?', ...teacherProfile(req.body || {}), id);
  });
  audit(req.user.id, 'teacher_updated', { id });
  res.json({ ok: true });
});

const studentProfile = (b) => [
  str(b.roll_no, 'Roll no', { required: true, max: 30 }), int(b.class_id, 'Class', req_),
  str(b.guardian_name, 'Guardian name'), str(b.guardian_phone, 'Guardian phone', { max: 20 }),
  date(b.dob, 'Date of birth'), str(b.address, 'Address', { max: 500 }), int(b.admission_year, 'Admission year', { min: 1950, max: 2100 }),
];

router.get('/students', (req, res) => {
  const classId = int(req.query.classId, 'Class');
  res.json(all(`SELECT u.id, u.username, u.name, u.email, u.phone, u.active, s.roll_no, s.class_id, c.name AS class_name,
    s.guardian_name, s.guardian_phone, s.dob, s.address, s.admission_year,
    (SELECT COUNT(*) FROM face_samples f WHERE f.student_id = u.id) AS face_samples
    FROM students s JOIN users u ON u.id = s.user_id JOIN classes c ON c.id = s.class_id
    ${classId ? 'WHERE s.class_id = ?' : ''} ORDER BY c.name, s.roll_no`, ...(classId ? [classId] : [])));
});

router.post('/students', (req, res) => {
  const body = req.body || {};
  const out = tx(() => {
    const p = studentProfile(body);
    const user = createUser('student', body);
    run(`INSERT INTO students(user_id, roll_no, class_id, guardian_name, guardian_phone, dob, address, admission_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, user.id, ...p);
    return user;
  });
  audit(req.user.id, 'student_created', { id: out.id });
  res.status(201).json({ id: out.id, temp_password: out.password });
});

router.put('/students/:id', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  tx(() => {
    updateUser(id, 'student', req.body || {});
    run(`UPDATE students SET roll_no = ?, class_id = ?, guardian_name = ?, guardian_phone = ?, dob = ?, address = ?, admission_year = ?
      WHERE user_id = ?`, ...studentProfile(req.body || {}), id);
  });
  audit(req.user.id, 'student_updated', { id });
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const u = one('SELECT id, role FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'Use "Change password" for your own account');
  const password = tempPassword();
  tx(() => {
    run('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?', hashPassword(password), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
  });
  audit(req.user.id, 'password_reset', { id });
  res.json({ temp_password: password });
});

router.post('/users/:id/active', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  if (id === req.user.id) throw new HttpError(400, 'You cannot deactivate yourself');
  const active = req.body?.active ? 1 : 0;
  const r = run("UPDATE users SET active = ? WHERE id = ? AND role <> 'admin'", active, id);
  if (!r.changes) throw new HttpError(404, 'User not found');
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req.user.id, active ? 'user_activated' : 'user_deactivated', { id });
  res.json({ ok: true });
});

// ---- Who teaches what ----
router.get('/assignments', (req, res) => {
  res.json(all(`SELECT a.id, a.teacher_id, a.class_id, a.subject_id, u.name AS teacher_name, c.name AS class_name, s.code AS subject_code, s.name AS subject_name
    FROM assignments a JOIN users u ON u.id = a.teacher_id JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
    ORDER BY c.name, s.code`));
});

router.post('/assignments', (req, res) => {
  const teacherId = int(req.body?.teacher_id, 'Teacher', req_);
  const classId = int(req.body?.class_id, 'Class', req_);
  const subjectId = int(req.body?.subject_id, 'Subject', req_);
  const existing = one('SELECT id FROM assignments WHERE class_id = ? AND subject_id = ?', classId, subjectId);
  if (existing) {
    // Re-assigning a subject to another teacher; open sessions stay with the old teacher until they finish.
    run('UPDATE assignments SET teacher_id = ? WHERE id = ?', teacherId, existing.id);
  } else {
    run('INSERT INTO assignments(teacher_id, class_id, subject_id) VALUES (?, ?, ?)', teacherId, classId, subjectId);
  }
  audit(req.user.id, 'assignment_set', { teacherId, classId, subjectId });
  res.status(201).json({ ok: true });
});

router.delete('/assignments/:id', (req, res) => {
  const r = run('DELETE FROM assignments WHERE id = ?', int(req.params.id, 'Id', req_));
  if (!r.changes) throw new HttpError(404, 'Assignment not found');
  audit(req.user.id, 'assignment_removed', { id: req.params.id });
  res.json({ ok: true });
});

// ---- Fees ----
function studentDues(classId) {
  return all(`SELECT u.id, u.name, s.roll_no, c.name AS class_name,
    COALESCE((SELECT SUM(amount) FROM fee_structures f WHERE f.class_id = s.class_id), 0) AS total,
    COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.student_id = s.user_id), 0) AS paid
    FROM students s JOIN users u ON u.id = s.user_id JOIN classes c ON c.id = s.class_id
    WHERE u.active = 1 ${classId ? 'AND s.class_id = ?' : ''} ORDER BY c.name, s.roll_no`, ...(classId ? [classId] : []))
    .map((r) => ({ ...r, due: Math.max(0, r.total - r.paid) }));
}

router.get('/fees/dues', (req, res) => res.json(studentDues(int(req.query.classId, 'Class'))));

router.get('/fees/payments', (req, res) => {
  const studentId = int(req.query.studentId, 'Student');
  res.json(all(`SELECT p.*, f.title AS fee_title, u.name AS student_name, s.roll_no, r.name AS recorded_by_name
    FROM fee_payments p JOIN fee_structures f ON f.id = p.fee_id JOIN users u ON u.id = p.student_id
    JOIN students s ON s.user_id = p.student_id LEFT JOIN users r ON r.id = p.recorded_by
    ${studentId ? 'WHERE p.student_id = ?' : ''} ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`, ...(studentId ? [studentId] : [])));
});

router.post('/fees/payments', (req, res) => {
  const b = req.body || {};
  const studentId = int(b.student_id, 'Student', req_);
  const feeId = int(b.fee_id, 'Fee', req_);
  const amount = num(b.amount, 'Amount', { required: true, min: 0.01, max: 1e8 });
  const paidOn = date(b.paid_on, 'Paid on') || today();
  const mode = oneOf(b.mode || 'cash', 'Mode', ['cash', 'upi', 'card', 'bank', 'cheque']);
  const out = tx(() => {
    const st = one('SELECT class_id FROM students WHERE user_id = ?', studentId);
    if (!st) throw new HttpError(404, 'Student not found');
    const fee = one('SELECT * FROM fee_structures WHERE id = ?', feeId);
    if (!fee || fee.class_id !== st.class_id) throw new HttpError(400, "This fee is not for the student's class");
    const paid = one('SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments WHERE student_id = ? AND fee_id = ?', studentId, feeId).n;
    if (amount > fee.amount - paid + 1e-9) throw new HttpError(400, `Only ${(fee.amount - paid).toFixed(2)} is due for this fee`);
    const r = run('INSERT INTO fee_payments(student_id, fee_id, amount, paid_on, mode, receipt_no, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      studentId, feeId, amount, paidOn, mode, `tmp-${Date.now()}-${Math.random()}`, req.user.id);
    const id = Number(r.lastInsertRowid);
    const receipt = `R${paidOn.slice(0, 4)}-${String(id).padStart(5, '0')}`;
    run('UPDATE fee_payments SET receipt_no = ? WHERE id = ?', receipt, id);
    return { id, receipt_no: receipt };
  });
  audit(req.user.id, 'fee_payment', { ...out, studentId, feeId, amount });
  res.status(201).json(out);
});

// ---- Attendance oversight ----
router.get('/attendance/sessions', (req, res) => {
  const classId = int(req.query.classId, 'Class');
  const day = date(req.query.date, 'Date');
  const where = [];
  const params = [];
  if (classId) { where.push('a.class_id = ?'); params.push(classId); }
  if (day) { where.push('a.date = ?'); params.push(day); }
  res.json(all(`SELECT a.*, c.name AS class_name, s.code AS subject_code, s.name AS subject_name, u.name AS teacher_name,
    (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id = a.id AND m.status = 'present') AS present,
    (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id = a.id AND m.status = 'present' AND m.source = 'camera') AS by_camera
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.date DESC, a.id DESC LIMIT 300`, ...params));
});

router.get('/attendance/sessions/:id', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const s = one('SELECT * FROM attendance_sessions WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'Session not found');
  res.json({
    session: s,
    marks: all(`SELECT m.*, u.name, st.roll_no FROM attendance_marks m JOIN users u ON u.id = m.student_id JOIN students st ON st.user_id = m.student_id
      WHERE m.session_id = ? ORDER BY st.roll_no`, id),
  });
});

// Admin correction of a submitted record (e.g. student proves they were present).
router.put('/attendance/sessions/:id/marks', (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const studentId = int(req.body?.student_id, 'Student', req_);
  const status = oneOf(req.body?.status, 'Status', ['present', 'absent'], req_);
  const r = run(`UPDATE attendance_marks SET status = ?, source = 'manual', distance = NULL, marked_at = datetime('now')
    WHERE session_id = ? AND student_id = ?`, status, id, studentId);
  if (!r.changes) throw new HttpError(404, 'Mark not found');
  audit(req.user.id, 'attendance_corrected', { session: id, studentId, status });
  res.json({ ok: true });
});

router.get('/reports/attendance', (req, res) => {
  const classId = int(req.query.classId, 'Class', req_);
  const cls = getClass(classId);
  const report = classAttendanceReport(classId, int(req.query.subjectId, 'Subject'));
  if (req.query.format !== 'csv') return res.json({ class: cls, ...report });
  const head = ['Roll no', 'Name', ...report.subjects.map((s) => `${s.code} %`), 'Present', 'Total', 'Overall %'];
  const body = report.students.map((st) => [st.roll_no, st.name, ...report.subjects.map((s) => st.bySubject[s.id]?.pct ?? ''), st.present, st.total, st.pct ?? '']);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="attendance-${cls.name.replace(/[^A-Za-z0-9-]+/g, '_')}.csv"`);
  res.send(`﻿${csv([head, ...body])}`);
});

// ---- Settings and audit ----
router.get('/settings', (req, res) => res.json(getSettings()));

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const values = {
    college_name: str(b.college_name, 'College name', { required: true, max: 120 }),
    match_threshold: String(num(b.match_threshold, 'Match threshold', { required: true, min: 0.3, max: 0.7 })),
    min_face_confidence: String(num(b.min_face_confidence, 'Face detection confidence', { required: true, min: 0.2, max: 0.95 })),
  };
  tx(() => { for (const [k, v] of Object.entries(values)) run('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)', k, v); });
  audit(req.user.id, 'settings_updated', values);
  res.json({ ok: true });
});

router.get('/audit', (req, res) => {
  res.json(all(`SELECT a.id, a.action, a.detail, a.at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 300`));
});

module.exports = router;
