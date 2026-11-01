const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'erp.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  semester INTEGER,
  section TEXT,
  academic_year TEXT,
  room TEXT,
  camera_url TEXT
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  credits INTEGER
);
CREATE TABLE IF NOT EXISTS teachers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  department_id INTEGER REFERENCES departments(id),
  designation TEXT
);
CREATE TABLE IF NOT EXISTS students (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roll_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  guardian_name TEXT,
  guardian_phone TEXT,
  dob TEXT,
  address TEXT,
  admission_year INTEGER
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(user_id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  UNIQUE (class_id, subject_id)
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  room TEXT
);
CREATE TABLE IF NOT EXISTS face_samples (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  descriptor BLOB NOT NULL,
  photo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_face_student ON face_samples(student_id);
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','cancelled')),
  registered_count INTEGER NOT NULL DEFAULT 0,
  last_faces INTEGER,
  max_faces INTEGER,
  captures INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_class ON attendance_sessions(class_id, subject_id, date);
CREATE TABLE IF NOT EXISTS attendance_marks (
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(user_id),
  status TEXT NOT NULL CHECK (status IN ('present','absent')),
  source TEXT NOT NULL CHECK (source IN ('camera','manual','auto')),
  distance REAL,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_student ON attendance_marks(student_id);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,
  max_marks REAL NOT NULL CHECK (max_marks > 0),
  exam_date TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS marks (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(user_id),
  marks REAL NOT NULL,
  PRIMARY KEY (exam_id, student_id)
);
CREATE TABLE IF NOT EXISTS fee_structures (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  due_date TEXT
);
CREATE TABLE IF NOT EXISTS fee_payments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(user_id),
  fee_id INTEGER NOT NULL REFERENCES fee_structures(id),
  amount REAL NOT NULL CHECK (amount > 0),
  paid_on TEXT NOT NULL,
  mode TEXT,
  receipt_no TEXT NOT NULL UNIQUE,
  recorded_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','teacher','student')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const DEFAULT_SETTINGS = {
  college_name: 'UU College',
  match_threshold: '0.5',
  min_face_confidence: '0.5',
};
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').run(key, value);
}

const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function audit(userId, action, detail) {
  run('INSERT INTO audit_log(user_id, action, detail) VALUES (?, ?, ?)',
    userId ?? null, action, detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

function getSetting(key) {
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

module.exports = { db, one, all, run, tx, audit, getSetting, getSettings, DATA_DIR, DEFAULT_SETTINGS };
