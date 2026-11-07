// Login, logout, own profile, password, notifications.
const express = require('express');
const { one, query, audit, getSettings } = require('../db');
const { HttpError, str, int } = require('../http');
const auth = require('../auth');

const router = express.Router();

router.get('/public-info', async (req, res) => {
  const s = await getSettings();
  res.json({ university_name: s.university_name });
});

router.post('/login', async (req, res) => {
  const username = str(req.body?.username, 'Username', { required: true, max: 100 });
  const role = req.body?.role ? String(req.body.role) : null;
  const key = auth.loginKey(req, username);
  if (!auth.loginAllowed(key)) throw new HttpError(429, 'Too many wrong attempts. Try again after 10 minutes.');
  const u = await one(`SELECT u.id, u.password_hash, u.role, u.name, u.active, u.must_change_pw, u.token_version FROM users u
    LEFT JOIN teachers t ON t.user_id = u.id WHERE lower(u.username) = lower($1) OR lower(t.employee_no) = lower($1)
    ORDER BY lower(u.username) = lower($1) DESC LIMIT 1`, [username]);
  const ok = u && u.active && await auth.verifyPassword(req.body?.password ?? '', u.password_hash);
  // The chosen login tab must match the account, so a teacher cannot sign in on the admin tab.
  const roleOk = ok && (!role || role === u.role);
  if (!roleOk) {
    auth.loginFailed(key);
    audit(u?.id, 'login_failed', { username, role });
    throw new HttpError(401, ok ? 'This account cannot sign in here. Choose the right login tab.' : 'Wrong username or password');
  }
  auth.loginSucceeded(key);
  auth.setSessionCookie(req, res, u);
  audit(u.id, 'login');
  res.json({ role: u.role, name: u.name, must_change_pw: u.must_change_pw });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', auth.requireRole(), async (req, res) => {
  const u = await one('SELECT id, username, role, name, email, phone, must_change_pw FROM users WHERE id = $1', [req.user.id]);
  const profile = u.role === 'teacher'
    ? await one(`SELECT t.employee_no, t.designation, d.name AS department FROM teachers t LEFT JOIN departments d ON d.id = t.department_id WHERE t.user_id = $1`, [u.id])
    : null;
  const s = await getSettings();
  res.json({
    ...u, profile, university_name: s.university_name,
    scan_minutes: Number(s.scan_minutes), frame_interval_seconds: Number(s.frame_interval_seconds), min_face_confidence: Number(s.min_face_confidence),
  });
});

router.post('/me/password', auth.requireRole(), async (req, res) => {
  const { current, next } = req.body || {};
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!await auth.verifyPassword(current ?? '', u.password_hash)) throw new HttpError(400, 'Current password is wrong');
  auth.checkNewPassword(next);
  if (next === current) throw new HttpError(400, 'New password must be different');
  // token_version + 1 logs out every other device.
  const r = await one('UPDATE users SET password_hash = $2, must_change_pw = FALSE, token_version = token_version + 1 WHERE id = $1 RETURNING *', [req.user.id, await auth.hashPassword(next)]);
  auth.forgetUser(req.user.id);
  auth.setSessionCookie(req, res, r);
  audit(req.user.id, 'password_changed');
  res.json({ ok: true });
});

router.get('/notifications', auth.requireRole(), async (req, res) => {
  const list = await query('SELECT id, title, body, link, read, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [req.user.id]);
  res.json({ unread: list.filter((n) => !n.read).length, list });
});

router.post('/notifications/read', auth.requireRole(), async (req, res) => {
  const id = int(req.body?.id, 'Id');
  await query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 ${id ? 'AND id = $2' : ''}`, id ? [req.user.id, id] : [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
