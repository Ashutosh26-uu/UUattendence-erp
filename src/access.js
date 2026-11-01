// Who may touch which class / subject. Every route re-checks on the server.
const { one } = require('./db');
const { HttpError } = require('./http');

function getClass(classId) {
  const cls = one('SELECT * FROM classes WHERE id = ?', classId);
  if (!cls) throw new HttpError(404, 'Class not found');
  return cls;
}

// Admin: any class. Teacher: only classes they teach at least one subject in.
function assertClassAccess(user, classId) {
  const cls = getClass(classId);
  if (user.role === 'admin') return cls;
  if (user.role === 'teacher' && one('SELECT 1 FROM assignments WHERE teacher_id = ? AND class_id = ?', user.id, classId)) return cls;
  throw new HttpError(403, 'You do not teach this class');
}

// Teacher must be the one assigned to this class + subject.
function assertTeaches(user, classId, subjectId) {
  const row = one('SELECT id FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ?', user.id, classId, subjectId);
  if (!row) throw new HttpError(403, 'You are not assigned to this class and subject');
  return row;
}

function assertStudentAccess(user, studentId) {
  const st = one('SELECT s.user_id, s.class_id FROM students s WHERE s.user_id = ?', studentId);
  if (!st) throw new HttpError(404, 'Student not found');
  assertClassAccess(user, st.class_id);
  return st;
}

module.exports = { getClass, assertClassAccess, assertTeaches, assertStudentAccess };
