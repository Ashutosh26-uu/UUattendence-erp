// Semester results: teachers enter internal marks for their subject, the admin enters
// external marks and publishes; students then see their grade card with SGPA / CGPA.
const express = require('express');
const { one, all, run, tx, audit } = require('../db');
const { HttpError, int, num } = require('../http');
const { requireRole } = require('../auth');
const { getClass, assertTeaches } = require('../access');
const { INTERNAL_MAX, EXTERNAL_MAX, SCALE, grade, gradeCard, isPublished, round2 } = require('../grades');

const router = express.Router();
const req_ = { required: true };

function sheetAccess(user, classId, subjectId) {
  const cls = getClass(classId);
  if (user.role === 'teacher') assertTeaches(user, classId, subjectId);
  if (!one('SELECT 1 FROM subjects WHERE id = ?', subjectId)) throw new HttpError(404, 'Subject not found');
  if (!cls.semester) throw new HttpError(400, 'Set the semester of this class first (Classes page)');
  return cls;
}

router.get('/scale', requireRole(), (req, res) => res.json({ scale: SCALE, internal_max: INTERNAL_MAX, external_max: EXTERNAL_MAX }));

// Marks sheet for one class + subject (current semester of the class).
router.get('/sheet', requireRole('admin', 'teacher'), (req, res) => {
  const classId = int(req.query.classId, 'Class', req_);
  const subjectId = int(req.query.subjectId, 'Subject', req_);
  const cls = sheetAccess(req.user, classId, subjectId);
  const students = all(`SELECT u.id, u.name, s.roll_no, r.internal, r.external FROM students s JOIN users u ON u.id = s.user_id
    LEFT JOIN result_entries r ON r.student_id = u.id AND r.subject_id = ? AND r.semester = ?
    WHERE s.class_id = ? AND u.active = 1 ORDER BY s.roll_no`, subjectId, cls.semester, classId)
    .map((st) => ({ ...st, ...grade(st.internal != null && st.external != null ? st.internal + st.external : null) }));
  res.json({ semester: cls.semester, published: isPublished(classId, cls.semester), internal_max: INTERNAL_MAX, external_max: EXTERNAL_MAX, can_edit_external: req.user.role === 'admin', students });
});

router.put('/sheet', requireRole('admin', 'teacher'), (req, res) => {
  const classId = int(req.body?.class_id, 'Class', req_);
  const subjectId = int(req.body?.subject_id, 'Subject', req_);
  const cls = sheetAccess(req.user, classId, subjectId);
  if (isPublished(classId, cls.semester)) throw new HttpError(409, 'Result is published. The admin must unpublish it before marks can change.');
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  tx(() => {
    for (const e of entries) {
      const studentId = int(e.student_id, 'Student', req_);
      if (!one('SELECT 1 FROM students WHERE user_id = ? AND class_id = ?', studentId, classId)) throw new HttpError(400, 'Student is not in this class');
      const internal = num(e.internal, 'Internal marks', { min: 0, max: INTERNAL_MAX });
      const existing = one('SELECT external FROM result_entries WHERE student_id = ? AND subject_id = ? AND semester = ?', studentId, subjectId, cls.semester);
      const external = req.user.role === 'admin' ? num(e.external, 'External marks', { min: 0, max: EXTERNAL_MAX }) : existing?.external ?? null;
      run(`INSERT INTO result_entries(student_id, subject_id, semester, class_id, internal, external, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, subject_id, semester) DO UPDATE SET internal = excluded.internal, external = excluded.external, class_id = excluded.class_id, updated_by = excluded.updated_by`,
      studentId, subjectId, cls.semester, classId, internal, external, req.user.id);
    }
  });
  audit(req.user.id, 'result_marks_saved', { classId, subjectId, semester: cls.semester, count: entries.length });
  res.json({ ok: true });
});

// Whole-class result (admin): every student x subject, SGPA, pass/fail.
router.get('/class', requireRole('admin'), (req, res) => {
  const classId = int(req.query.classId, 'Class', req_);
  const cls = getClass(classId);
  const semester = int(req.query.semester, 'Semester') || cls.semester;
  // Subjects with marks in that semester; for the class's current semester also the subjects being taught now.
  const current = semester === cls.semester;
  const subjects = all(`SELECT DISTINCT s.id, s.code, s.name, COALESCE(s.credits, 4) AS credits FROM subjects s
    WHERE s.id IN (SELECT subject_id FROM result_entries WHERE class_id = ? AND semester = ?)
    ${current ? 'OR s.id IN (SELECT subject_id FROM assignments WHERE class_id = ?)' : ''}
    ORDER BY s.code`, ...(current ? [classId, semester, classId] : [classId, semester]));
  const students = all(`SELECT u.id, u.name, s.roll_no FROM students s JOIN users u ON u.id = s.user_id WHERE s.class_id = ? AND u.active = 1 ORDER BY s.roll_no`, classId);
  const entries = all('SELECT * FROM result_entries WHERE class_id = ? AND semester = ?', classId, semester);
  const map = new Map(entries.map((e) => [`${e.student_id}:${e.subject_id}`, e]));
  const rows = students.map((st) => {
    let credits = 0;
    let points = 0;
    let complete = true;
    const marks = {};
    for (const sub of subjects) {
      const e = map.get(`${st.id}:${sub.id}`);
      const total = e && e.internal != null && e.external != null ? e.internal + e.external : null;
      if (total == null) complete = false;
      const g = grade(total);
      marks[sub.id] = { internal: e?.internal ?? null, external: e?.external ?? null, total, ...g };
      credits += sub.credits;
      points += sub.credits * (g.points || 0);
    }
    const backlogs = Object.values(marks).filter((m) => m.grade === 'F').length;
    return { ...st, marks, sgpa: complete && credits ? round2(points / credits) : null, backlogs, status: !complete ? 'Incomplete' : backlogs ? 'Back' : 'Pass' };
  });
  res.json({ class: cls, semester, published: isPublished(classId, semester), subjects, students: rows });
});

router.post('/publish', requireRole('admin'), (req, res) => {
  const classId = int(req.body?.class_id, 'Class', req_);
  const semester = int(req.body?.semester, 'Semester', { required: true, min: 1, max: 12 });
  getClass(classId);
  if (req.body?.published) run('INSERT OR REPLACE INTO result_publish(class_id, semester) VALUES (?, ?)', classId, semester);
  else run('DELETE FROM result_publish WHERE class_id = ? AND semester = ?', classId, semester);
  audit(req.user.id, req.body?.published ? 'result_published' : 'result_unpublished', { classId, semester });
  res.json({ ok: true });
});

router.get('/me', requireRole('student'), (req, res) => res.json(gradeCard(req.user.id, { onlyPublished: true })));

router.get('/student/:id', requireRole('admin'), (req, res) => {
  const id = int(req.params.id, 'Student', req_);
  const st = one(`SELECT u.name, s.roll_no, c.name AS class_name, s.guardian_name FROM students s JOIN users u ON u.id = s.user_id
    JOIN classes c ON c.id = s.class_id WHERE s.user_id = ?`, id);
  if (!st) throw new HttpError(404, 'Student not found');
  res.json({ student: st, ...gradeCard(id, { onlyPublished: false }) });
});

module.exports = router;
