// Face enrollment: the one-time photo of every student that camera attendance matches against.
const express = require('express');
const { one, all, run, audit } = require('../db');
const { HttpError, int } = require('../http');
const { requireRole } = require('../auth');
const { assertClassAccess, assertStudentAccess } = require('../access');
const { parseDescriptor, toBlob, closestOtherStudent } = require('../face');

const router = express.Router();
router.use(requireRole('admin', 'teacher'));

const MAX_SAMPLES = 10;
const SAME_PERSON = 0.42; // closer than this to another student = probably the wrong name

function checkPhoto(photo) {
  if (photo == null) return null;
  if (typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 200_000) {
    throw new HttpError(400, 'Photo must be a small JPEG');
  }
  return photo;
}

router.get('/class/:classId', (req, res) => {
  const classId = int(req.params.classId, 'Class', { required: true });
  assertClassAccess(req.user, classId);
  const students = all(`SELECT u.id, u.name, s.roll_no FROM students s JOIN users u ON u.id = s.user_id
    WHERE s.class_id = ? AND u.active = 1 ORDER BY s.roll_no`, classId);
  const samples = all(`SELECT f.id, f.student_id, f.photo, f.created_at FROM face_samples f JOIN students s ON s.user_id = f.student_id
    WHERE s.class_id = ? ORDER BY f.id`, classId);
  const byStudent = new Map(students.map((s) => [s.id, { ...s, samples: [] }]));
  for (const f of samples) byStudent.get(f.student_id)?.samples.push({ id: f.id, photo: f.photo, created_at: f.created_at });
  res.json([...byStudent.values()]);
});

router.post('/students/:studentId', (req, res) => {
  const studentId = int(req.params.studentId, 'Student', { required: true });
  assertStudentAccess(req.user, studentId);
  const desc = parseDescriptor(req.body?.descriptor);
  const photo = checkPhoto(req.body?.photo);
  const n = one('SELECT COUNT(*) AS n FROM face_samples WHERE student_id = ?', studentId).n;
  if (n >= MAX_SAMPLES) throw new HttpError(400, `This student already has ${MAX_SAMPLES} photos. Delete an old one first.`);
  if (!req.body?.force) {
    const other = closestOtherStudent(desc, studentId);
    if (other && other.distance < SAME_PERSON) {
      throw new HttpError(409, `This face looks like ${other.name} (${other.roll_no}), who is already enrolled. Check the name before saving.`,
        { conflict: { student_id: other.student_id, name: other.name, roll_no: other.roll_no } });
    }
  }
  const r = run('INSERT INTO face_samples(student_id, descriptor, photo, created_by) VALUES (?, ?, ?, ?)', studentId, toBlob(desc), photo, req.user.id);
  audit(req.user.id, 'face_enrolled', { studentId, sample: Number(r.lastInsertRowid), forced: !!req.body?.force });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/samples/:id', (req, res) => {
  const id = int(req.params.id, 'Id', { required: true });
  const f = one('SELECT student_id FROM face_samples WHERE id = ?', id);
  if (!f) throw new HttpError(404, 'Photo not found');
  assertStudentAccess(req.user, f.student_id);
  run('DELETE FROM face_samples WHERE id = ?', id);
  audit(req.user.id, 'face_deleted', { studentId: f.student_id, sample: id });
  res.json({ ok: true });
});

module.exports = router;
