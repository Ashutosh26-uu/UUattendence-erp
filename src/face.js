// Face matching. The browser turns each face into a 128-number descriptor
// (face-api.js); the server keeps the enrolled descriptors and does the matching,
// so a teacher's browser never sees other students' face data.
const { all } = require('./db');
const { HttpError } = require('./http');

const DIM = 128;

function parseDescriptor(d) {
  if (!Array.isArray(d) || d.length !== DIM || !d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10)) {
    throw new HttpError(400, 'Invalid face data');
  }
  return Float32Array.from(d);
}

const toBlob = (f32) => new Uint8Array(f32.buffer.slice(0));
const fromBlob = (u8) => new Float32Array(new Uint8Array(u8).buffer);

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

// All enrolled faces of active students in a class: [{ student_id, name, roll_no, descriptors: [] }]
function classGallery(classId) {
  const rows = all(`SELECT f.student_id, f.descriptor, u.name, s.roll_no
    FROM face_samples f JOIN students s ON s.user_id = f.student_id JOIN users u ON u.id = s.user_id
    WHERE s.class_id = ? AND u.active = 1`, classId);
  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, { student_id: r.student_id, name: r.name, roll_no: r.roll_no, descriptors: [] });
    byStudent.get(r.student_id).descriptors.push(fromBlob(r.descriptor));
  }
  return [...byStudent.values()];
}

function bestDistance(desc, entry) {
  let best = Infinity;
  for (const d of entry.descriptors) best = Math.min(best, distance(desc, d));
  return best;
}

// One face -> at most one student, one student -> at most one face.
// Closest pairs are taken first so two look-alikes cannot both claim one student.
function matchFaces(descriptors, gallery, threshold) {
  const pairs = [];
  descriptors.forEach((desc, faceIndex) => {
    for (const entry of gallery) {
      const dist = bestDistance(desc, entry);
      if (dist < threshold) pairs.push({ faceIndex, entry, dist });
    }
  });
  pairs.sort((a, b) => a.dist - b.dist);
  const usedFaces = new Set();
  const usedStudents = new Set();
  const matches = [];
  for (const p of pairs) {
    if (usedFaces.has(p.faceIndex) || usedStudents.has(p.entry.student_id)) continue;
    usedFaces.add(p.faceIndex);
    usedStudents.add(p.entry.student_id);
    matches.push({ faceIndex: p.faceIndex, student_id: p.entry.student_id, name: p.entry.name, roll_no: p.entry.roll_no, distance: Math.round(p.dist * 1000) / 1000 });
  }
  return matches;
}

// Closest *other* student to a new sample, to catch enrolling a face under the wrong name.
function closestOtherStudent(desc, studentId) {
  const rows = all(`SELECT f.student_id, f.descriptor, u.name, s.roll_no FROM face_samples f
    JOIN students s ON s.user_id = f.student_id JOIN users u ON u.id = s.user_id
    WHERE f.student_id <> ? AND u.active = 1`, studentId);
  let best = null;
  for (const r of rows) {
    const dist = distance(desc, fromBlob(r.descriptor));
    if (!best || dist < best.distance) best = { student_id: r.student_id, name: r.name, roll_no: r.roll_no, distance: dist };
  }
  return best;
}

module.exports = { parseDescriptor, toBlob, fromBlob, distance, classGallery, matchFaces, closestOtherStudent };
