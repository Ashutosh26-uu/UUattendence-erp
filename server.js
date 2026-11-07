// United University ERP: camera face-recognition attendance.
process.env.TZ ||= 'Asia/Kolkata';
process.env.UV_THREADPOOL_SIZE ||= '8'; // password hashing runs here; helps the 9 AM login rush

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./src/db');
const { HttpError } = require('./src/http');

async function main() {
  await db.connect();
  const auth = require('./src/auth');
  const queue = require('./src/queue');

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:",
        "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
  });

  // API writes must be JSON: a cross-site form cannot send that without CORS.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new HttpError(415, 'Send JSON'));
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(auth.authenticate);

  app.get('/healthz', async (req, res) => { await db.query('SELECT 1'); res.json({ ok: true }); });
  app.use('/api', require('./src/routes/account'));
  app.use('/api/admin', require('./src/routes/admin'));
  app.use('/api/super', require('./src/routes/superadmin'));
  app.use('/api/attendance', require('./src/routes/attendance'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const faceApiDir = path.dirname(require.resolve('@vladmandic/face-api/package.json'));
  app.use('/vendor/face-api', express.static(path.join(faceApiDir, 'dist'), { maxAge: '7d' }));
  app.use('/models', express.static(path.join(faceApiDir, 'model'), { maxAge: '7d' }));
  // No max-age: browsers revalidate (cheap 304s) so an update reaches everyone immediately.
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: 0 }));
  app.get('/', (req, res) => res.redirect('/login'));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request is too large');
    if (err.code === '23505') err = new HttpError(409, `Already exists (${(err.constraint || err.detail || '').replace(/_/g, ' ')})`);
    if (err.code === '23503') err = new HttpError(409, 'This record is linked to other records, so it cannot be changed or deleted');
    if (err.code === '23514') err = new HttpError(400, 'A value is not allowed here');
    if (!(err instanceof HttpError)) {
      console.error(err);
      err = new HttpError(500, 'Something went wrong on the server');
    }
    res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  });

  // First start: create the super admin. SUPER_ADMIN_PASSWORD sets it (for hosts without
  // file access); otherwise a one-time password is written to data/initial-super-admin.txt.
  if (!(await db.one("SELECT 1 FROM users WHERE role = 'super_admin'"))) {
    const fixed = process.env.SUPER_ADMIN_PASSWORD;
    const password = fixed || auth.tempPassword();
    await db.query("INSERT INTO users (username, password_hash, role, name, must_change_pw) VALUES ('superadmin', $1, 'super_admin', 'Super Admin', $2)",
      [await auth.hashPassword(password), !fixed]);
    if (fixed) console.log('Created the super admin account (password from SUPER_ADMIN_PASSWORD)');
    else {
      const file = path.join(db.DATA_DIR, 'initial-super-admin.txt');
      fs.writeFileSync(file, `username: superadmin\npassword: ${password}\n(change it after the first login, then delete this file)\n`);
      console.log(`Created the super admin account. One-time password saved in ${file}`);
    }
  }
  if (process.env.SEED_DEMO === '1') await require('./scripts/seed-demo').seedDemo();

  await queue.startWorker();
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`United University ERP on http://localhost:${PORT} (database: ${db.mode()})`));
}

main().catch((err) => { console.error(err); process.exit(1); });
