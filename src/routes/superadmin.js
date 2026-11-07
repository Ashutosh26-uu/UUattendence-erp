// Super admin: admin accounts, university-wide settings, live system monitor, audit log.
const express = require('express');
const { query, one, audit, getSettings, setSettings, mode } = require('../db');
const { HttpError, str, int, num, today } = require('../http');
const auth = require('../auth');
const queue = require('../queue');
const scans = require('../scans');

const router = express.Router();
router.use(auth.requireRole('super_admin'));

router.get('/admins', async (req, res) => {
  res.json(await query("SELECT id, username, name, email, phone, active, created_at FROM users WHERE role = 'admin' ORDER BY name"));
});

router.post('/admins', async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 'Username', { required: true, max: 60 });
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw new HttpError(400, 'Username: 3-60 letters, digits, . _ @ -');
  const password = auth.tempPassword();
  const r = await one(`INSERT INTO users (username, password_hash, role, name, email, phone, must_change_pw) VALUES ($1, $2, 'admin', $3, $4, $5, TRUE) RETURNING id`,
    [username, await auth.hashPassword(password), str(b.name, 'Name', { required: true }), str(b.email, 'Email', { max: 120 }), str(b.phone, 'Phone', { max: 20 })]);
  audit(req.user.id, 'admin_created', { id: r.id });
  res.status(201).json({ id: r.id, temp_password: password });
});

router.put('/admins/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', { required: true });
  const b = req.body || {};
  const r = await one("UPDATE users SET name = $2, email = $3, phone = $4 WHERE id = $1 AND role = 'admin' RETURNING id",
    [id, str(b.name, 'Name', { required: true }), str(b.email, 'Email', { max: 120 }), str(b.phone, 'Phone', { max: 20 })]);
  if (!r) throw new HttpError(404, 'Admin not found');
  auth.forgetUser(id);
  res.json({ ok: true });
});

router.get('/settings', async (req, res) => res.json(await getSettings()));

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const values = {
    university_name: str(b.university_name, 'University name', { required: true, max: 120 }),
    scan_minutes: int(b.scan_minutes, 'Scan duration (minutes)', { required: true, min: 1, max: 15 }),
    frame_interval_seconds: int(b.frame_interval_seconds, 'Seconds between camera captures', { required: true, min: 1, max: 30 }),
    match_threshold: num(b.match_threshold, 'Face match strictness', { required: true, min: 0.3, max: 0.7 }),
    min_face_confidence: num(b.min_face_confidence, 'Face detection confidence', { required: true, min: 0.2, max: 0.95 }),
    queue_threshold: int(b.queue_threshold, 'Queue threshold (submissions per minute)', { required: true, min: 1, max: 100000 }),
    queue_deadline_minutes: int(b.queue_deadline_minutes, 'Queue deadline (minutes)', { required: true, min: 1, max: 55 }),
  };
  await setSettings(values);
  audit(req.user.id, 'settings_updated', values);
  res.json({ ok: true });
});

// Live health of the system: queue, scans in progress, today's numbers.
router.get('/monitor', async (req, res) => {
  const [q, todayCounts, totals] = await Promise.all([
    queue.metrics(),
    one(`SELECT count(*) FILTER (WHERE status = 'scanning')::int AS scanning, count(*) FILTER (WHERE status = 'review')::int AS review,
      count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'saved')::int AS saved
      FROM attendance_sessions WHERE date = $1`, [today()]),
    one(`SELECT (SELECT count(*) FROM students)::int AS students, (SELECT count(*) FROM attendance_records)::int AS records,
      (SELECT count(*) FROM users)::int AS users`),
  ]);
  const mem = process.memoryUsage();
  res.json({
    database: mode(), queue: q, today: todayCounts, totals, live_scans_in_memory: scans.activeCount(),
    server: { uptime_minutes: Math.round(process.uptime() / 60), memory_mb: Math.round(mem.rss / 1048576), node: process.version },
  });
});

// Saves queued attendance now instead of waiting for traffic to drop.
router.post('/queue/drain', async (req, res) => {
  await queue.tick();
  audit(req.user.id, 'queue_drain');
  res.json(await queue.metrics());
});

router.get('/audit', async (req, res) => {
  res.json(await query(`SELECT a.id, a.action, a.detail, a.at, u.name AS user_name, u.role FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300`));
});

module.exports = router;
