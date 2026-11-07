// University administration (admin and super admin).
const express = require('express');
const { query, one, tx, audit } = require('../db');
const { HttpError, str, int, date, time, oneOf, today, sendCsv } = require('../http');
const auth = require('../auth');
const { crud } = require('../crud');
const { parseDescriptor, toBytes, fromBytes, distance, forgetGallery } = require('../face');

const router = express.Router();
router.use(auth.requireRole('admin'));
const req_ = { required: true };

function cameraUrl(v) {
  const s = str(v, 'Camera URL', { max: 500 });
  if (s == null) return null;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'Camera URL is not a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Camera URL must start with http:// or https://');
  return s;
}

router.get('/stats', async (req, res) => {
  const day = today();
  const [counts, todayRow, trend, classAttendance] = await Promise.all([
    one(`SELECT (SELECT count(*) FROM students WHERE active)::int AS students,
      (SELECT count(*) FROM users WHERE role = 'teacher' AND active)::int AS teachers,
      (SELECT count(*) FROM classes)::int AS classes, (SELECT count(*) FROM rooms)::int AS rooms,
      (SELECT count(*) FROM rooms WHERE camera_url IS NOT NULL)::int AS cameras,
      (SELECT count(DISTINCT student_id) FROM face_samples)::int AS enrolled,
      (SELECT count(*) FROM lectures)::int AS lectures`),
    one(`SELECT count(*) FILTER (WHERE status = 'saved')::int AS saved, count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status IN ('scanning','review'))::int AS live,
      COALESCE(sum(present_count) FILTER (WHERE status = 'saved'), 0)::int AS present,
      COALESCE(sum(registered_count) FILTER (WHERE status = 'saved'), 0)::int AS registered
      FROM attendance_sessions WHERE date = $1`, [day]),
    query(`SELECT date::text AS date, sum(present_count)::int AS present, sum(registered_count)::int AS registered
      FROM attendance_sessions WHERE status = 'saved' AND date > $1::date - 30 GROUP BY date ORDER BY date DESC LIMIT 14`, [day]),
    query(`SELECT c.name, COALESCE(sum(a.present_count), 0)::int AS present, COALESCE(sum(a.registered_count), 0)::int AS registered
      FROM classes c LEFT JOIN attendance_sessions a ON a.class_id = c.id AND a.status = 'saved' GROUP BY c.id ORDER BY c.name`),
  ]);
  res.json({ ...counts, today: todayRow, trend: trend.reverse(), class_attendance: classAttendance });
});

// ---- Master data ----
crud(router, {
  path: '/departments', table: 'departments', label: 'Department',
  fields: { code: (v) => str(v, 'Code', { required: true, max: 20 }), name: (v) => str(v, 'Name', req_) },
  listSql: 'SELECT * FROM departments ORDER BY code',
});

crud(router, {
  path: '/classes', table: 'classes', label: 'Class',
  fields: {
    name: (v) => str(v, 'Class name', req_),
    department_id: (v) => int(v, 'Department', req_),
    program: (v) => str(v, 'Program', { max: 60 }),
    semester: (v) => int(v, 'Semester', { min: 1, max: 12 }),
    section: (v) => str(v, 'Section', { max: 10 }),
    academic_year: (v) => str(v, 'Academic year', { max: 20 }),
  },
  listSql: `SELECT c.*, d.name AS department_name, (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.active)::int AS students,
    (SELECT count(DISTINCT f.student_id) FROM face_samples f JOIN students s ON s.id = f.student_id WHERE s.class_id = c.id AND s.active)::int AS enrolled
    FROM classes c JOIN departments d ON d.id = c.department_id ORDER BY c.name`,
});

crud(router, {
  path: '/rooms', table: 'rooms', label: 'Room',
  fields: {
    name: (v) => str(v, 'Room', req_),
    building: (v) => str(v, 'Building'),
    capacity: (v) => int(v, 'Capacity', { min: 1, max: 2000 }),
    camera_url: cameraUrl,
  },
  listSql: 'SELECT * FROM rooms ORDER BY building, name',
});

crud(router, {
  path: '/subjects', table: 'subjects', label: 'Subject',
  fields: { code: (v) => str(v, 'Code', { required: true, max: 20 }), name: (v) => str(v, 'Name', req_), department_id: (v) => int(v, 'Department') },
  listSql: 'SELECT s.*, d.name AS department_name FROM subjects s LEFT JOIN departments d ON d.id = s.department_id ORDER BY s.code',
});

// ---- Faculty ----
router.get('/teachers', async (req, res) => {
  res.json(await query(`SELECT u.id, u.username, u.name, u.email, u.phone, u.active, t.employee_no, t.department_id, t.designation, d.name AS department_name,
    (SELECT count(*) FROM lectures l WHERE l.teacher_id = u.id)::int AS lectures
    FROM teachers t JOIN users u ON u.id = t.user_id LEFT JOIN departments d ON d.id = t.department_id ORDER BY u.name`));
});

const userFields = (b) => ({
  name: str(b.name, 'Name', req_),
  username: str(b.username, 'Username', { required: true, max: 60 }),
  email: str(b.email, 'Email', { max: 120 }),
  phone: str(b.phone, 'Phone', { max: 20 }),
});

async function createUser(t, role, b) {
  const u = userFields(b);
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(u.username)) throw new HttpError(400, 'Username: 3-60 letters, digits, . _ @ -');
  const password = b.password ? String(b.password) : auth.tempPassword();
  auth.checkNewPassword(password);
  const r = await t.one(`INSERT INTO users (username, password_hash, role, name, email, phone, must_change_pw) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id`,
    [u.username, await auth.hashPassword(password), role, u.name, u.email, u.phone]);
  return { id: r.id, password };
}

router.post('/teachers', async (req, res) => {
  const b = req.body || {};
  const prof = [str(b.employee_no, 'Employee no', { required: true, max: 30 }), int(b.department_id, 'Department'), str(b.designation, 'Designation', { max: 60 })];
  const out = await tx(async (t) => {
    const u = await createUser(t, 'teacher', b);
    await t.query('INSERT INTO teachers (user_id, employee_no, department_id, designation) VALUES ($1, $2, $3, $4)', [u.id, ...prof]);
    return u;
  });
  audit(req.user.id, 'teacher_created', { id: out.id });
  res.status(201).json({ id: out.id, temp_password: out.password });
});

router.put('/teachers/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const b = req.body || {};
  const u = userFields(b);
  await tx(async (t) => {
    const r = await t.one("UPDATE users SET name = $2, username = $3, email = $4, phone = $5 WHERE id = $1 AND role = 'teacher' RETURNING id", [id, u.name, u.username, u.email, u.phone]);
    if (!r) throw new HttpError(404, 'Teacher not found');
    await t.query('UPDATE teachers SET employee_no = $2, department_id = $3, designation = $4 WHERE user_id = $1',
      [id, str(b.employee_no, 'Employee no', { required: true, max: 30 }), int(b.department_id, 'Department'), str(b.designation, 'Designation', { max: 60 })]);
  });
  auth.forgetUser(id);
  audit(req.user.id, 'teacher_updated', { id });
  res.json({ ok: true });
});

// Admins manage teachers; the super admin also manages admins (see superadmin.js).
async function manageableUser(req, id) {
  const u = await one('SELECT id, role FROM users WHERE id = $1', [id]);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'Use "Change password" for your own account');
  const allowed = req.user.role === 'super_admin' ? ['admin', 'teacher'] : ['teacher'];
  if (!allowed.includes(u.role)) throw new HttpError(403, 'You cannot change this account');
  return u;
}

router.post('/users/:id/reset-password', async (req, res) => {
  const u = await manageableUser(req, int(req.params.id, 'Id', req_));
  const password = auth.tempPassword();
  await query('UPDATE users SET password_hash = $2, must_change_pw = TRUE, token_version = token_version + 1 WHERE id = $1', [u.id, await auth.hashPassword(password)]);
  auth.forgetUser(u.id);
  audit(req.user.id, 'password_reset', { id: u.id });
  res.json({ temp_password: password });
});

router.post('/users/:id/active', async (req, res) => {
  const u = await manageableUser(req, int(req.params.id, 'Id', req_));
  const active = !!req.body?.active;
  await query('UPDATE users SET active = $2, token_version = token_version + 1 WHERE id = $1', [u.id, active]);
  auth.forgetUser(u.id);
  audit(req.user.id, active ? 'user_activated' : 'user_deactivated', { id: u.id });
  res.json({ ok: true });
});

// ---- Students (no login; paginated because a university has thousands) ----
router.get('/students', async (req, res) => {
  const classId = int(req.query.classId, 'Class');
  const q = str(req.query.q, 'Search', { max: 60 });
  const page = int(req.query.page, 'Page', { min: 1, max: 10000 }) || 1;
  const where = ['TRUE'];
  const p = [];
  if (classId) { p.push(classId); where.push(`s.class_id = $${p.length}`); }
  if (q) { p.push(`%${q}%`); where.push(`(s.name ILIKE $${p.length} OR s.roll_no ILIKE $${p.length})`); }
  const total = (await one(`SELECT count(*)::int AS n FROM students s WHERE ${where.join(' AND ')}`, p)).n;
  p.push(100, (page - 1) * 100);
  const rows = await query(`SELECT s.*, c.name AS class_name, (SELECT count(*) FROM face_samples f WHERE f.student_id = s.id)::int AS faces
    FROM students s JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')} ORDER BY c.name, s.roll_no LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / 100)), rows });
});

const studentRow = (b) => [
  str(b.roll_no, 'Roll no', { required: true, max: 30 }), str(b.name, 'Name', req_), int(b.class_id, 'Class', req_),
  str(b.email, 'Email', { max: 120 }), str(b.phone, 'Phone', { max: 20 }), str(b.guardian_phone, 'Guardian phone', { max: 20 }),
];

router.post('/students', async (req, res) => {
  const r = await one('INSERT INTO students (roll_no, name, class_id, email, phone, guardian_phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', studentRow(req.body || {}));
  forgetGallery(int(req.body.class_id, 'Class'));
  audit(req.user.id, 'student_created', { id: r.id });
  res.status(201).json({ id: r.id });
});

router.put('/students/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const before = await one('SELECT class_id FROM students WHERE id = $1', [id]);
  if (!before) throw new HttpError(404, 'Student not found');
  const row = studentRow(req.body || {});
  await query('UPDATE students SET roll_no = $2, name = $3, class_id = $4, email = $5, phone = $6, guardian_phone = $7, active = $8 WHERE id = $1',
    [id, ...row, req.body?.active !== false && req.body?.active !== 'false']);
  forgetGallery(before.class_id);
  forgetGallery(row[2]);
  audit(req.user.id, 'student_updated', { id });
  res.json({ ok: true });
});

// Bulk import: [{ roll_no, name, class (name) or class_id, email, phone, guardian_phone }], up to 2000 a call.
router.post('/students/import', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 2000) throw new HttpError(400, 'Send 1 to 2000 rows at a time');
  const classes = new Map((await query('SELECT id, lower(name) AS name FROM classes')).map((c) => [c.name, c.id]));
  const ok = [];
  const errors = [];
  rows.forEach((r, i) => {
    try {
      const classId = r.class_id ? int(r.class_id, 'Class') : classes.get(String(r.class || '').trim().toLowerCase());
      if (!classId) throw new HttpError(400, `Unknown class "${r.class || ''}"`);
      ok.push(studentRow({ ...r, class_id: classId }));
    } catch (err) { errors.push({ line: i + 1, roll_no: r.roll_no, error: err.message }); }
  });
  const inserted = ok.length ? await query(`INSERT INTO students (roll_no, name, class_id, email, phone, guardian_phone)
    SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[]) ON CONFLICT (roll_no) DO NOTHING RETURNING roll_no`,
  [0, 1, 2, 3, 4, 5].map((k) => ok.map((r) => r[k]))) : [];
  const added = new Set(inserted.map((r) => r.roll_no));
  for (const r of ok) if (!added.has(r[0])) errors.push({ roll_no: r[0], error: 'Roll no already exists' });
  forgetGallery();
  audit(req.user.id, 'students_imported', { added: added.size, errors: errors.length });
  res.json({ added: added.size, errors });
});

// ---- Face enrolment ----
router.get('/faces/class/:classId', async (req, res) => {
  const classId = int(req.params.classId, 'Class', req_);
  const students = await query('SELECT id, name, roll_no FROM students WHERE class_id = $1 AND active ORDER BY roll_no', [classId]);
  const samples = await query(`SELECT f.id, f.student_id, f.photo FROM face_samples f JOIN students s ON s.id = f.student_id WHERE s.class_id = $1 ORDER BY f.id`, [classId]);
  const by = new Map(students.map((s) => [s.id, { ...s, samples: [] }]));
  for (const f of samples) by.get(f.student_id)?.samples.push({ id: f.id, photo: f.photo });
  res.json([...by.values()]);
});

function checkPhoto(photo) {
  if (photo == null) return null;
  if (typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 200000) throw new HttpError(400, 'Photo must be a small JPEG');
  return photo;
}

async function enrol(req, student) {
  const desc = parseDescriptor(req.body?.descriptor);
  const photo = checkPhoto(req.body?.photo);
  const n = (await one('SELECT count(*)::int AS n FROM face_samples WHERE student_id = $1', [student.id])).n;
  if (n >= 10) throw new HttpError(400, 'This student already has 10 photos. Delete one first.');
  if (!req.body?.force) {
    // Same face already saved for someone else in the class = probably the wrong name.
    const others = await query(`SELECT f.descriptor, s.name, s.roll_no FROM face_samples f JOIN students s ON s.id = f.student_id
      WHERE s.class_id = $1 AND s.id <> $2 AND s.active`, [student.class_id, student.id]);
    for (const o of others) {
      if (distance(desc, fromBytes(o.descriptor)) < 0.42) throw new HttpError(409, `This face looks like ${o.name} (${o.roll_no}), who is already enrolled. Check the name.`);
    }
  }
  const r = await one('INSERT INTO face_samples (student_id, descriptor, photo, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [student.id, toBytes(desc), photo, req.user.id]);
  forgetGallery(student.class_id);
  audit(req.user.id, 'face_enrolled', { student: student.id, sample: r.id });
  return r.id;
}

router.post('/faces/student/:id', async (req, res) => {
  const st = await one('SELECT id, class_id FROM students WHERE id = $1', [int(req.params.id, 'Student', req_)]);
  if (!st) throw new HttpError(404, 'Student not found');
  res.status(201).json({ id: await enrol(req, st) });
});

// For bulk photo upload where every file is named by roll number (e.g. BCA3A01.jpg).
router.post('/faces/by-roll', async (req, res) => {
  const roll = str(req.body?.roll_no, 'Roll no', req_);
  const st = await one('SELECT id, class_id FROM students WHERE lower(roll_no) = lower($1)', [roll]);
  if (!st) throw new HttpError(404, `No student with roll no ${roll}`);
  res.status(201).json({ id: await enrol(req, st) });
});

router.delete('/faces/:id', async (req, res) => {
  const f = await one('DELETE FROM face_samples f USING students s WHERE f.id = $1 AND s.id = f.student_id RETURNING s.class_id', [int(req.params.id, 'Id', req_)]);
  if (!f) throw new HttpError(404, 'Photo not found');
  forgetGallery(f.class_id);
  res.json({ ok: true });
});

// ---- Lecture allotment (timetable) ----
const LECTURE_SQL = `SELECT l.*, to_char(l.start_time, 'HH24:MI') AS start_time, to_char(l.end_time, 'HH24:MI') AS end_time,
  u.name AS teacher_name, c.name AS class_name, s.code AS subject_code, s.name AS subject_name, r.name AS room_name
  FROM lectures l JOIN users u ON u.id = l.teacher_id JOIN classes c ON c.id = l.class_id JOIN subjects s ON s.id = l.subject_id
  LEFT JOIN rooms r ON r.id = l.room_id`;

router.get('/lectures', async (req, res) => {
  const classId = int(req.query.classId, 'Class');
  const teacherId = int(req.query.teacherId, 'Teacher');
  const where = [];
  const p = [];
  if (classId) { p.push(classId); where.push(`l.class_id = $${p.length}`); }
  if (teacherId) { p.push(teacherId); where.push(`l.teacher_id = $${p.length}`); }
  res.json(await query(`${LECTURE_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.day, l.start_time, c.name`, p));
});

async function lectureFromBody(b, id = null) {
  const l = {
    teacher_id: int(b.teacher_id, 'Teacher', req_), class_id: int(b.class_id, 'Class', req_), subject_id: int(b.subject_id, 'Subject', req_),
    room_id: int(b.room_id, 'Room'), day: int(b.day, 'Day', { required: true, min: 1, max: 7 }),
    start_time: time(b.start_time, 'Start time', req_), end_time: time(b.end_time, 'End time', req_),
  };
  if (l.end_time <= l.start_time) throw new HttpError(400, 'End time must be after start time');
  // Nobody can be in two places at once: same teacher, class or room overlapping on the same day.
  const clash = await one(`SELECT l.id, u.name AS teacher, c.name AS class, r.name AS room,
      l.teacher_id = $1 AS t, l.class_id = $2 AS c, l.room_id IS NOT DISTINCT FROM $3 AND $3::int IS NOT NULL AS r
    FROM lectures l JOIN users u ON u.id = l.teacher_id JOIN classes c ON c.id = l.class_id LEFT JOIN rooms r ON r.id = l.room_id
    WHERE l.day = $4 AND l.start_time < $6::time AND l.end_time > $5::time AND ($7::int IS NULL OR l.id <> $7)
      AND (l.teacher_id = $1 OR l.class_id = $2 OR (l.room_id = $3 AND $3::int IS NOT NULL)) LIMIT 1`,
  [l.teacher_id, l.class_id, l.room_id, l.day, l.start_time, l.end_time, id]);
  if (clash) throw new HttpError(409, `Time clash: ${clash.t ? `${clash.teacher} already teaches then` : clash.c ? `${clash.class} already has a lecture then` : `room ${clash.room} is already booked`}`);
  return l;
}

router.post('/lectures', async (req, res) => {
  const l = await lectureFromBody(req.body || {});
  const cols = Object.keys(l);
  const r = await one(`INSERT INTO lectures (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(l));
  audit(req.user.id, 'lecture_created', { id: r.id, ...l });
  res.status(201).json({ id: r.id });
});

router.put('/lectures/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const l = await lectureFromBody(req.body || {}, id);
  const cols = Object.keys(l);
  const r = await one(`UPDATE lectures SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`, [id, ...Object.values(l)]);
  if (!r) throw new HttpError(404, 'Lecture not found');
  audit(req.user.id, 'lecture_updated', { id, ...l });
  res.json({ ok: true });
});

router.delete('/lectures/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  if (await one('SELECT 1 FROM attendance_sessions WHERE lecture_id = $1 LIMIT 1', [id])) throw new HttpError(409, 'Attendance has been taken for this lecture, so it cannot be deleted');
  await query('DELETE FROM lectures WHERE id = $1', [id]);
  audit(req.user.id, 'lecture_deleted', { id });
  res.json({ ok: true });
});

// ---- Attendance records and reports ----
router.get('/sessions', async (req, res) => {
  const classId = int(req.query.classId, 'Class');
  const day = date(req.query.date, 'Date');
  const status = oneOf(req.query.status || null, 'Status', ['scanning', 'review', 'queued', 'saved', 'cancelled']);
  const where = [];
  const p = [];
  if (classId) { p.push(classId); where.push(`a.class_id = $${p.length}`); }
  if (day) { p.push(day); where.push(`a.date = $${p.length}`); }
  if (status) { p.push(status); where.push(`a.status = $${p.length}`); }
  res.json(await query(`SELECT a.id, a.date::text AS date, a.status, a.registered_count, a.max_faces, a.recognised_count, a.present_count, a.started_at, a.saved_at,
    c.name AS class_name, s.code AS subject_code, s.name AS subject_name, u.name AS teacher_name, r.name AS room_name
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id
    LEFT JOIN rooms r ON r.id = a.room_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.date DESC, a.started_at DESC LIMIT 300`, p));
});

router.get('/sessions/:id', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const s = await one(`SELECT a.*, a.date::text AS date, c.name AS class_name, sub.code AS subject_code, sub.name AS subject_name, u.name AS teacher_name
    FROM attendance_sessions a JOIN classes c ON c.id = a.class_id JOIN subjects sub ON sub.id = a.subject_id JOIN users u ON u.id = a.teacher_id WHERE a.id = $1`, [id]);
  if (!s) throw new HttpError(404, 'Attendance not found');
  const records = await query(`SELECT r.*, st.name, st.roll_no FROM attendance_records r JOIN students st ON st.id = r.student_id WHERE r.session_id = $1 ORDER BY st.roll_no`, [id]);
  res.json({ session: s, records });
});

// Correction after saving (e.g. a student proves they were present). Logged in the audit trail.
router.put('/sessions/:id/records/:studentId', async (req, res) => {
  const id = int(req.params.id, 'Id', req_);
  const studentId = int(req.params.studentId, 'Student', req_);
  const status = oneOf(req.body?.status, 'Status', ['P', 'A'], req_);
  const done = await tx(async (t) => {
    const r = await t.one("UPDATE attendance_records SET status = $3, source = 'manual', confidence = NULL WHERE session_id = $1 AND student_id = $2 RETURNING 1", [id, studentId, status]);
    if (!r) return false;
    await t.query("UPDATE attendance_sessions SET present_count = (SELECT count(*) FROM attendance_records WHERE session_id = $1 AND status = 'P') WHERE id = $1", [id]);
    return true;
  });
  if (!done) throw new HttpError(404, 'Record not found');
  audit(req.user.id, 'attendance_corrected', { session: id, studentId, status });
  res.json({ ok: true });
});

router.get('/reports/class/:classId', async (req, res) => {
  const classId = int(req.params.classId, 'Class', req_);
  const from = date(req.query.from, 'From') || '2000-01-01';
  const to = date(req.query.to, 'To') || '2999-12-31';
  const cls = await one('SELECT * FROM classes WHERE id = $1', [classId]);
  if (!cls) throw new HttpError(404, 'Class not found');
  const rows = await query(`SELECT st.id, st.roll_no, st.name,
      count(r.session_id)::int AS total, count(*) FILTER (WHERE r.status = 'P')::int AS present
    FROM students st LEFT JOIN attendance_records r ON r.student_id = st.id
      AND r.session_id IN (SELECT id FROM attendance_sessions WHERE class_id = $1 AND status = 'saved' AND date BETWEEN $2 AND $3)
    WHERE st.class_id = $1 AND st.active GROUP BY st.id ORDER BY st.roll_no`, [classId, from, to]);
  const list = rows.map((r) => ({ ...r, pct: r.total ? Math.round((r.present / r.total) * 1000) / 10 : null }));
  if (req.query.format === 'csv') {
    return sendCsv(res, `attendance-${cls.name}.csv`, [['Roll no', 'Name', 'Present', 'Total', '%'], ...list.map((r) => [r.roll_no, r.name, r.present, r.total, r.pct ?? ''])]);
  }
  res.json({ class: cls, from, to, students: list });
});

module.exports = router;
