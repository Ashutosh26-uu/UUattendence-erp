// Login and sessions. Sessions are signed cookies (HMAC), so a request does not need a
// database lookup to know who is calling; a short in-memory cache handles deactivation
// and "log out everywhere" (token_version). This matters with thousands of users online.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { one, DATA_DIR } = require('./db');
const { HttpError } = require('./http');

const scrypt = promisify(crypto.scrypt);
const SESSION_HOURS = 12;
const COOKIE = 'uu_sid';

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

// scrypt runs on the libuv thread pool, so logins do not block other requests.
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function tempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.randomBytes(10)) out += chars[b % chars.length];
  return out;
}

function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
}

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function issueToken(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, tv: user.token_version, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, user) {
  res.append('Set-Cookie', `${COOKIE}=${issueToken(user)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// user id -> { user, at }. Kept for 30 s, dropped at once on any change to the user.
const userCache = new Map();
const USER_TTL = 30e3;
const forgetUser = (id) => userCache.delete(id);

async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.user;
  const user = await one('SELECT id, username, role, name, active, must_change_pw, token_version FROM users WHERE id = $1', [id]);
  userCache.set(id, { user, at: Date.now() });
  if (userCache.size > 20000) userCache.delete(userCache.keys().next().value);
  return user;
}

async function authenticate(req, res, next) {
  try {
    const p = readToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (p) {
      const u = await loadUser(p.uid);
      if (u && u.active && u.token_version === p.tv) req.user = u;
    }
    next();
  } catch (err) { next(err); }
}

const PW_CHANGE_ALLOWED = new Set(['/api/me', '/api/me/password', '/api/logout']);

// requireRole() = any logged-in user. super_admin may do everything an admin can.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in'));
    if (req.user.must_change_pw && !PW_CHANGE_ALLOWED.has(req.originalUrl.split('?')[0])) {
      return next(new HttpError(403, 'Change your password first', { mustChangePassword: true }));
    }
    const ok = !roles.length || roles.includes(req.user.role) || (roles.includes('admin') && req.user.role === 'super_admin');
    if (!ok) return next(new HttpError(403, 'You do not have access to this'));
    next();
  };
}

// Brute-force guard: 5 wrong passwords per username+IP lock it for 10 minutes.
const failures = new Map();
const loginKey = (req, u) => `${req.ip}|${String(u).toLowerCase()}`;
function loginAllowed(key) {
  const f = failures.get(key);
  return !f || f.count < 5 || f.until < Date.now();
}
function loginFailed(key) {
  const f = failures.get(key);
  failures.set(key, { count: f && f.until > Date.now() ? f.count + 1 : 1, until: Date.now() + 10 * 60e3 });
  if (failures.size > 50000) failures.clear();
}
const loginSucceeded = (key) => failures.delete(key);

module.exports = {
  hashPassword, verifyPassword, tempPassword, checkNewPassword, setSessionCookie, clearSessionCookie,
  authenticate, requireRole, forgetUser, loginKey, loginAllowed, loginFailed, loginSucceeded,
};
