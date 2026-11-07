// Face matching. The browser turns every face into a 128-number descriptor (face-api.js);
// the server keeps the enrolled descriptors and does the matching, so teachers' browsers
// never receive other students' face data.
//
// Per-class galleries are cached in memory: a scan sends a frame every few seconds for
// 5 minutes, and re-reading the face table each time would be wasteful.
const { query } = require('./db');
const { HttpError } = require('./http');

const DIM = 128;

function parseDescriptor(d) {
  if (!Array.isArray(d) || d.length !== DIM || !d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10)) {
    throw new HttpError(400, 'Invalid face data');
  }
  return Float32Array.from(d);
}

const toBytes = (f32) => Buffer.from(f32.buffer.slice(0));
const fromBytes = (b) => new Float32Array(new Uint8Array(b).buffer.slice(0));

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

const galleries = new Map(); // classId -> { at, entries: [{ student_id, name, roll_no, descriptors }] }
const GALLERY_TTL = 10 * 60e3;

async function classGallery(classId) {
  const hit = galleries.get(classId);
  if (hit && Date.now() - hit.at < GALLERY_TTL) return hit.entries;
  const rows = await query(`SELECT f.student_id, f.descriptor, s.name, s.roll_no FROM face_samples f
    JOIN students s ON s.id = f.student_id WHERE s.class_id = $1 AND s.active`, [classId]);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, { student_id: r.student_id, name: r.name, roll_no: r.roll_no, descriptors: [] });
    map.get(r.student_id).descriptors.push(fromBytes(r.descriptor));
  }
  const entries = [...map.values()];
  galleries.set(classId, { at: Date.now(), entries });
  return entries;
}

// Call after enrolment changes so the next frame sees the new faces.
function forgetGallery(classId) {
  if (classId == null) galleries.clear(); else galleries.delete(classId);
}

// One face -> at most one student; one student -> at most one face. Closest pairs win,
// so two look-alikes in the same frame cannot both claim the same student.
function matchFaces(descriptors, gallery, threshold) {
  const pairs = [];
  descriptors.forEach((desc, faceIndex) => {
    for (const entry of gallery) {
      let best = Infinity;
      for (const d of entry.descriptors) best = Math.min(best, distance(desc, d));
      if (best < threshold) pairs.push({ faceIndex, entry, dist: best });
    }
  });
  pairs.sort((a, b) => a.dist - b.dist);
  const usedFaces = new Set();
  const usedStudents = new Set();
  const out = [];
  for (const p of pairs) {
    if (usedFaces.has(p.faceIndex) || usedStudents.has(p.entry.student_id)) continue;
    usedFaces.add(p.faceIndex);
    usedStudents.add(p.entry.student_id);
    out.push({ faceIndex: p.faceIndex, student_id: p.entry.student_id, name: p.entry.name, roll_no: p.entry.roll_no, distance: Math.round(p.dist * 1000) / 1000 });
  }
  return out;
}

// Confidence shown to people: 1.0 at distance 0, 0 at the threshold.
const confidence = (dist, threshold) => Math.max(0, Math.min(1, 1 - dist / threshold));

module.exports = { parseDescriptor, toBytes, fromBytes, distance, classGallery, forgetGallery, matchFaces, confidence };
