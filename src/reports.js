// Attendance percentages. Only submitted sessions count.
const { all } = require('./db');

function pct(present, total) {
  return total ? Math.round((present / total) * 1000) / 10 : null;
}

// Per student, per subject attendance for one class (optionally one subject).
function classAttendanceReport(classId, subjectId = null) {
  const students = all(`SELECT s.user_id AS id, s.roll_no, u.name, u.active FROM students s JOIN users u ON u.id = s.user_id
    WHERE s.class_id = ? ORDER BY s.roll_no`, classId);
  const subjects = all(`SELECT DISTINCT sub.id, sub.code, sub.name FROM attendance_sessions a JOIN subjects sub ON sub.id = a.subject_id
    WHERE a.class_id = ? AND a.status = 'submitted' ${subjectId ? 'AND a.subject_id = ?' : ''} ORDER BY sub.code`,
  ...(subjectId ? [classId, subjectId] : [classId]));
  const rows = all(`SELECT m.student_id, a.subject_id, COUNT(*) AS total, SUM(m.status = 'present') AS present
    FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
    WHERE a.class_id = ? AND a.status = 'submitted' ${subjectId ? 'AND a.subject_id = ?' : ''}
    GROUP BY m.student_id, a.subject_id`, ...(subjectId ? [classId, subjectId] : [classId]));

  const cell = new Map(rows.map((r) => [`${r.student_id}:${r.subject_id}`, r]));
  const report = students.map((st) => {
    let present = 0;
    let total = 0;
    const bySubject = {};
    for (const sub of subjects) {
      const c = cell.get(`${st.id}:${sub.id}`);
      if (c) { present += c.present; total += c.total; }
      bySubject[sub.id] = c ? { present: c.present, total: c.total, pct: pct(c.present, c.total) } : null;
    }
    return { ...st, bySubject, present, total, pct: pct(present, total) };
  });
  return { subjects, students: report };
}

// One student's attendance by subject.
function studentAttendance(studentId) {
  const subjects = all(`SELECT sub.id, sub.code, sub.name, COUNT(*) AS total, SUM(m.status = 'present') AS present
    FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN subjects sub ON sub.id = a.subject_id
    WHERE m.student_id = ? AND a.status = 'submitted' GROUP BY sub.id ORDER BY sub.code`, studentId)
    .map((s) => ({ ...s, pct: pct(s.present, s.total) }));
  const present = subjects.reduce((a, s) => a + s.present, 0);
  const total = subjects.reduce((a, s) => a + s.total, 0);
  return { subjects, present, total, pct: pct(present, total) };
}

module.exports = { pct, classAttendanceReport, studentAttendance };
