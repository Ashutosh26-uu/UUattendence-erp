// PostgreSQL access. Production: set DATABASE_URL (a real PostgreSQL server, connection pool).
// Development: without DATABASE_URL an embedded PostgreSQL (PGlite) is stored in data/pgdata.
// Both speak the same SQL, so the rest of the code does not care which one runs.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

let impl;

async function connect() {
  if (impl) return impl;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE) || 20,
      ssl: process.env.DATABASE_SSL === '0' ? false : (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }),
    });
    impl = {
      mode: 'postgresql',
      query: (text, params) => pool.query(text, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.join(DATA_DIR, 'pgdata');
    // A brand-new database starts from a pre-initialised copy (assets/empty-pgdata.tar.gz)
    // instead of running initdb, which needs ~550 MB of memory; this needs ~150 MB.
    const bundle = path.join(__dirname, '..', 'assets', 'empty-pgdata.tar.gz');
    const opts = !fs.existsSync(dir) && fs.existsSync(bundle) ? { loadDataDir: new Blob([fs.readFileSync(bundle)]) } : {};
    const pg = new PGlite(dir, opts);
    await pg.waitReady;
    impl = {
      mode: 'embedded (PGlite)',
      query: (text, params) => pg.query(text, params),
      tx: (fn) => pg.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
      close: () => pg.close(),
    };
  }
  await migrate();
  return impl;
}

const query = async (text, params = []) => (await impl.query(text, params)).rows;
const one = async (text, params = []) => (await impl.query(text, params)).rows[0] || null;
const tx = (fn) => impl.tx(async (c) => fn({
  query: async (t, p = []) => (await c.query(t, p)).rows,
  one: async (t, p = []) => (await c.query(t, p)).rows[0] || null,
}));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','teacher')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pw BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  program TEXT,
  semester SMALLINT,
  section TEXT,
  academic_year TEXT
);
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  building TEXT,
  capacity INTEGER,
  camera_url TEXT
);
CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id)
);
CREATE TABLE IF NOT EXISTS teachers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_no TEXT NOT NULL UNIQUE,
  department_id INTEGER REFERENCES departments(id),
  designation TEXT
);
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  roll_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  email TEXT,
  phone TEXT,
  guardian_phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS students_class ON students (class_id) WHERE active;

CREATE TABLE IF NOT EXISTS face_samples (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  descriptor BYTEA NOT NULL,
  photo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS face_student ON face_samples (student_id);

-- Lecture allotment: which teacher teaches which class + subject, when and where.
CREATE TABLE IF NOT EXISTS lectures (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  room_id INTEGER REFERENCES rooms(id),
  day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS lectures_teacher ON lectures (teacher_id, day);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id BIGSERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER REFERENCES rooms(id),
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scanning','review','queued','saved','cancelled')),
  registered_count INTEGER NOT NULL DEFAULT 0,
  max_faces INTEGER NOT NULL DEFAULT 0,
  recognised_count INTEGER NOT NULL DEFAULT 0,
  present_count INTEGER,
  frames INTEGER NOT NULL DEFAULT 0,
  scan_result JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan_ends_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_attendance_per_lecture_day ON attendance_sessions (lecture_id, date) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS sessions_class_date ON attendance_sessions (class_id, date);
CREATE INDEX IF NOT EXISTS sessions_teacher ON attendance_sessions (teacher_id, date);

CREATE TABLE IF NOT EXISTS attendance_records (
  session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  status CHAR(1) NOT NULL CHECK (status IN ('P','A')),
  source TEXT NOT NULL CHECK (source IN ('camera','manual','auto')),
  confidence REAL,
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS records_student ON attendance_records (student_id);

-- Write-behind queue: final attendance waits here during peak load.
CREATE TABLE IF NOT EXISTS attendance_queue (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS queue_pending ON attendance_queue (enqueued_at) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const DEFAULT_SETTINGS = {
  university_name: 'United University, Prayagraj',
  scan_minutes: '5',
  frame_interval_seconds: '3',
  match_threshold: '0.5',
  min_face_confidence: '0.5',
  queue_threshold: '500',
  queue_deadline_minutes: '45',
};

let settingsCache = null;

async function migrate() {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await impl.query(stmt.replace(/^--.*$/gm, '').trim());
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await impl.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

// Settings are read on every scan frame, so they are cached; writes refresh the cache.
async function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS };
    for (const r of await query('SELECT key, value FROM settings')) settingsCache[r.key] = r.value;
  }
  return settingsCache;
}
async function setSettings(values) {
  await tx(async (t) => {
    for (const [k, v] of Object.entries(values)) {
      await t.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]);
    }
  });
  settingsCache = null;
}

function audit(userId, action, detail) {
  // Fire-and-forget: an audit row must never slow down or fail the request.
  query('INSERT INTO audit_log(user_id, action, detail) VALUES ($1, $2, $3)', [userId ?? null, action, detail == null ? null : JSON.stringify(detail)])
    .catch((err) => console.error('audit failed', err.message));
}

module.exports = { connect, query, one, tx, audit, getSettings, setSettings, DATA_DIR, DEFAULT_SETTINGS, mode: () => impl?.mode };
