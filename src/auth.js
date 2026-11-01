const crypto = require('node:crypto');
const { one, run } = require('./db');
const { HttpError } = require('./http');

const SESSION_HOURS = 12;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function tempPassword() {
  // Readable one-time password: no 0/O/1/l confusion.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.randomBytes(10)) out += chars[b % chars.length];
  return out;
}

function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_HOURS * 3600e3);
  res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Attaches req.user when the session cookie is valid. Never rejects by itself.
function authenticate(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const user = one(`SELECT u.id, u.username, u.role, u.name, u.must_change_pw
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, sha256(token), Date.now());
    if (user) req.user = { ...user, must_change_pw: !!user.must_change_pw };
  }
  next();
}

// Paths a user with a one-time password may still use.
const PW_CHANGE_ALLOWED = new Set(['/api/me', '/api/me/password', '/api/logout']);

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in'));
    if (req.user.must_change_pw && !PW_CHANGE_ALLOWED.has(req.originalUrl.split('?')[0])) {
      return next(new HttpError(403, 'Change your password first', { mustChangePassword: true }));
    }
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have access to this'));
    next();
  };
}

// Brute-force guard for the login form: 5 failures per username+IP locks it for 10 minutes.
const failures = new Map();
function loginAllowed(key) {
  const f = failures.get(key);
  return !f || f.count < 5 || f.until < Date.now();
}
function loginFailed(key) {
  const f = failures.get(key);
  const count = f && f.until > Date.now() ? f.count + 1 : 1;
  failures.set(key, { count, until: Date.now() + 10 * 60e3 });
}
function loginSucceeded(key) { failures.delete(key); }

module.exports = {
  hashPassword, verifyPassword, tempPassword, checkNewPassword,
  createSession, destroySession, authenticate, requireRole,
  loginAllowed, loginFailed, loginSucceeded,
};
