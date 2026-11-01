const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { one, run, DATA_DIR } = require('./src/db');
const { HttpError } = require('./src/http');
const { authenticate, hashPassword, tempPassword } = require('./src/auth');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
      "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'",
      "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});

// JSON only for API writes: a cross-site form post cannot send application/json without CORS.
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json') && req.headers['content-length'] !== '0') {
    return next(new HttpError(415, 'Send JSON'));
  }
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(authenticate);

app.use('/api', require('./src/routes/common'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/teacher', require('./src/routes/teacher'));
app.use('/api/attendance', require('./src/routes/attendance'));
app.use('/api/faces', require('./src/routes/faces'));
app.use('/api/camera', require('./src/routes/camera'));
app.use('/api/student', require('./src/routes/student'));
app.use('/api/results', require('./src/routes/results'));
app.use('/api/leave', require('./src/routes/leave'));
app.use('/api/homework', require('./src/routes/homework'));
app.use('/api/library', require('./src/routes/library'));
app.use('/api/campus', require('./src/routes/campus'));
app.use('/api/support', require('./src/routes/support'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// face-api.js (TensorFlow in the browser) and its model weights, served from node_modules.
const faceApiDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')));
app.use('/vendor/face-api', express.static(path.join(faceApiDir, 'dist'), { maxAge: '7d' }));
app.use('/models', express.static(path.join(faceApiDir, 'model'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.redirect('/login'));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON');
  if (err.type === 'entity.too.large') err = new HttpError(413, 'Request is too large');
  if (err.code === 'ERR_SQLITE_ERROR') {
    if (/UNIQUE/.test(err.message)) err = new HttpError(409, `Already exists: ${err.message.split(':').pop().trim().split('.').pop()} must be unique`);
    else if (/FOREIGN KEY/.test(err.message)) err = new HttpError(409, 'This record is linked to other records, so it cannot be changed or deleted');
  }
  if (!(err instanceof HttpError)) {
    console.error(err);
    err = new HttpError(500, 'Something went wrong on the server');
  }
  res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
});

// First run: create the admin account. On a host without file access (e.g. Render free)
// set ADMIN_PASSWORD; otherwise a one-time password is written to data/initial-admin.txt.
if (!one("SELECT 1 FROM users WHERE role = 'admin'")) {
  if (process.env.ADMIN_PASSWORD) {
    run("INSERT INTO users(username, password_hash, role, name, must_change_pw) VALUES ('admin', ?, 'admin', 'Administrator', 0)", hashPassword(process.env.ADMIN_PASSWORD));
    console.log('Created admin account with the password from ADMIN_PASSWORD');
  } else {
    const password = tempPassword();
    run("INSERT INTO users(username, password_hash, role, name, must_change_pw) VALUES ('admin', ?, 'admin', 'Administrator', 1)", hashPassword(password));
    const file = path.join(DATA_DIR, 'initial-admin.txt');
    fs.writeFileSync(file, `username: admin\npassword: ${password}\n(you must change it after the first login; delete this file afterwards)\n`);
    console.log(`Created admin account. One-time password saved in ${file}`);
  }
}

// SEED_DEMO=1 fills an empty database with demo data (for hosts whose disk resets on restart).
if (process.env.SEED_DEMO === '1') require('./scripts/seed-demo').seedDemo();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`College ERP running on http://localhost:${PORT}`));
