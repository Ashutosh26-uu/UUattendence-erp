// Routes every logged-in role uses: login, profile, password, notices, timetable.
const express = require('express');
const { one, all, run, audit, getSetting } = require('../db');
const { HttpError, str, int } = require('../http');
const auth = require('../auth');
const { assertClassAccess } = require('../access');

const router = express.Router();

router.get('/public-info', (req, res) => {
  res.json({ college_name: getSetting('college_name') });
});

router.post('/login', (req, res) => {
  const username = str(req.body?.username, 'Username', { required: true, max: 100 });
  const password = String(req.body?.password ?? '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (!auth.loginAllowed(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 10 minutes.');
  const user = one('SELECT id, password_hash, role, name, active, must_change_pw FROM users WHERE username = ?', username);
  if (!user || !user.active || !auth.verifyPassword(password, user.password_hash)) {
    auth.loginFailed(key);
    audit(user?.id, 'login_failed', { username });
    throw new HttpError(401, 'Wrong username or password');
  }
  auth.loginSucceeded(key);
  auth.createSession(res, req, user.id);
  audit(user.id, 'login');
  res.json({ role: user.role, name: user.name, must_change_pw: !!user.must_change_pw });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', auth.requireRole(), (req, res) => {
  const u = one('SELECT id, username, role, name, email, phone, must_change_pw FROM users WHERE id = ?', req.user.id);
  let profile = null;
  if (u.role === 'student') {
    profile = one(`SELECT s.roll_no, s.class_id, c.name AS class_name, s.guardian_name, s.guardian_phone, s.dob, s.address, s.admission_year,
      (SELECT COUNT(*) FROM face_samples f WHERE f.student_id = s.user_id) AS face_samples
      FROM students s JOIN classes c ON c.id = s.class_id WHERE s.user_id = ?`, u.id);
  } else if (u.role === 'teacher') {
    profile = one(`SELECT t.employee_no, t.designation, d.name AS department FROM teachers t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.user_id = ?`, u.id);
  }
  res.json({
    ...u, must_change_pw: !!u.must_change_pw, profile,
    college_name: getSetting('college_name'),
    min_face_confidence: Number(getSetting('min_face_confidence')) || 0.5,
  });
});

router.post('/me/password', auth.requireRole(), (req, res) => {
  const { current, next } = req.body || {};
  const u = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!auth.verifyPassword(String(current ?? ''), u.password_hash)) throw new HttpError(400, 'Current password is wrong');
  auth.checkNewPassword(next);
  if (next === current) throw new HttpError(400, 'New password must be different');
  run('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', auth.hashPassword(next), req.user.id);
  audit(req.user.id, 'password_changed');
  res.json({ ok: true });
});

router.get('/notices', auth.requireRole(), (req, res) => {
  const audiences = req.user.role === 'admin' ? ['all', 'teacher', 'student'] : ['all', req.user.role];
  res.json(all(`SELECT n.id, n.title, n.body, n.audience, n.created_at, u.name AS author FROM notices n
    LEFT JOIN users u ON u.id = n.created_by WHERE n.audience IN (${audiences.map(() => '?').join(',')})
    ORDER BY n.created_at DESC, n.id DESC LIMIT 100`, ...audiences));
});

const TIMETABLE_SQL = `SELECT t.id, t.class_id, c.name AS class_name, t.day, t.start_time, t.end_time, t.room,
  t.subject_id, sub.code AS subject_code, sub.name AS subject_name, tu.name AS teacher_name
  FROM timetable t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
  LEFT JOIN assignments a ON a.class_id = t.class_id AND a.subject_id = t.subject_id
  LEFT JOIN users tu ON tu.id = a.teacher_id`;

router.get('/timetable', auth.requireRole(), (req, res) => {
  let classId = int(req.query.classId, 'Class');
  if (req.user.role === 'student') {
    classId = one('SELECT class_id FROM students WHERE user_id = ?', req.user.id).class_id;
  } else if (req.user.role === 'teacher' && !classId) {
    return res.json(all(`${TIMETABLE_SQL} WHERE a.teacher_id = ? ORDER BY t.day, t.start_time`, req.user.id));
  }
  if (!classId) throw new HttpError(400, 'Choose a class');
  assertClassAccess(req.user.role === 'student' ? { role: 'admin' } : req.user, classId);
  res.json(all(`${TIMETABLE_SQL} WHERE t.class_id = ? ORDER BY t.day, t.start_time`, classId));
});

module.exports = router;
