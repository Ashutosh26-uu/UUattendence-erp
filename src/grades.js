// University-style 10-point grading: internal (40) + external (60) = 100 per subject.
const { one, all } = require('./db');

const INTERNAL_MAX = 40;
const EXTERNAL_MAX = 60;
const SCALE = [[90, 'O', 10], [80, 'A+', 9], [70, 'A', 8], [60, 'B+', 7], [50, 'B', 6], [45, 'C', 5], [40, 'P', 4], [0, 'F', 0]];

function grade(total) {
  if (total == null) return { grade: null, points: null };
  const [, g, p] = SCALE.find(([min]) => total >= min);
  return { grade: g, points: p };
}

const round2 = (n) => Math.round(n * 100) / 100;

// All result rows of one student grouped by semester, with SGPA per semester and CGPA.
// onlyPublished: students see a semester only after the admin publishes it.
function gradeCard(studentId, { onlyPublished }) {
  const rows = all(`SELECT r.semester, r.class_id, r.internal, r.external, s.id AS subject_id, s.code, s.name, COALESCE(s.credits, 4) AS credits,
    (SELECT published_at FROM result_publish p WHERE p.class_id = r.class_id AND p.semester = r.semester) AS published_at
    FROM result_entries r JOIN subjects s ON s.id = r.subject_id WHERE r.student_id = ? ORDER BY r.semester, s.code`, studentId);
  const semesters = new Map();
  for (const r of rows) {
    if (onlyPublished && !r.published_at) continue;
    if (!semesters.has(r.semester)) semesters.set(r.semester, { semester: r.semester, published_at: r.published_at, subjects: [] });
    const total = r.internal != null && r.external != null ? r.internal + r.external : null;
    semesters.get(r.semester).subjects.push({ ...grade(total), subject_id: r.subject_id, code: r.code, name: r.name, credits: r.credits, internal: r.internal, external: r.external, total });
  }
  let cgCredits = 0;
  let cgPoints = 0;
  const list = [...semesters.values()].map((sem) => {
    const complete = sem.subjects.every((s) => s.total != null);
    const credits = sem.subjects.reduce((a, s) => a + s.credits, 0);
    const points = sem.subjects.reduce((a, s) => a + s.credits * (s.points || 0), 0);
    const earned = sem.subjects.filter((s) => s.points > 0).reduce((a, s) => a + s.credits, 0);
    if (complete) { cgCredits += credits; cgPoints += points; }
    return { ...sem, credits, earned, sgpa: complete && credits ? round2(points / credits) : null, backlogs: sem.subjects.filter((s) => s.grade === 'F').length };
  });
  return { semesters: list, cgpa: cgCredits ? round2(cgPoints / cgCredits) : null, percentage: cgCredits ? round2((cgPoints / cgCredits) * 9.5) : null };
}

const isPublished = (classId, semester) => !!one('SELECT 1 FROM result_publish WHERE class_id = ? AND semester = ?', classId, semester);

module.exports = { INTERNAL_MAX, EXTERNAL_MAX, SCALE, grade, gradeCard, isPublished, round2 };
