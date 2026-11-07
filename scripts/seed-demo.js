// Demo data: departments, classes, rooms, faculty, students, a weekly timetable (including
// today) and two weeks of past attendance. Run once: npm run seed:demo
// All demo accounts share one password: DEMO_PASSWORD if set, otherwise a random one.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');

const FIRST = ['Aman', 'Priya', 'Rahul', 'Sneha', 'Vikas', 'Neha', 'Arjun', 'Pooja', 'Rohit', 'Anjali', 'Karan', 'Divya', 'Saurabh', 'Kavya', 'Aditya', 'Shreya', 'Manish', 'Ritika', 'Harsh', 'Nidhi'];
const LAST = ['Sharma', 'Verma', 'Singh', 'Gupta', 'Yadav', 'Mishra', 'Tiwari', 'Pandey', 'Srivastava', 'Dubey', 'Shukla', 'Tripathi'];

async function seedDemo() {
  await db.connect();
  const auth = require('../src/auth');
  if (await db.one("SELECT 1 FROM departments WHERE code = 'CSE'")) {
    console.log('Demo data already exists. Delete the data folder to start over.');
    return false;
  }
  const password = process.env.DEMO_PASSWORD || auth.tempPassword();
  const hash = await auth.hashPassword(password);

  await db.tx(async (t) => {
    const id = async (sql, p) => (await t.one(`${sql} RETURNING id`, p)).id;
    const cse = await id("INSERT INTO departments (code, name) VALUES ('CSE', 'Computer Science and Engineering')");
    const mgmt = await id("INSERT INTO departments (code, name) VALUES ('MGMT', 'School of Management')");

    await t.query("INSERT INTO users (username, password_hash, role, name, must_change_pw) VALUES ('admin1', $1, 'admin', 'Office Admin', FALSE)", [hash]);

    const classes = [
      [await id("INSERT INTO classes (name, department_id, program, semester, section, academic_year) VALUES ('BCA Sem 3 - A', $1, 'BCA', 3, 'A', '2026-27')", [cse]), 'BCA3A', 40],
      [await id("INSERT INTO classes (name, department_id, program, semester, section, academic_year) VALUES ('BCA Sem 3 - B', $1, 'BCA', 3, 'B', '2026-27')", [cse]), 'BCA3B', 38],
      [await id("INSERT INTO classes (name, department_id, program, semester, section, academic_year) VALUES ('MBA Sem 1 - A', $1, 'MBA', 1, 'A', '2026-27')", [mgmt]), 'MBA1A', 42],
    ];
    const rooms = [];
    for (const [name, b] of [['LT-101', 'Academic Block A'], ['LT-102', 'Academic Block A'], ['LT-201', 'Academic Block B'], ['Lab-3', 'Academic Block A']]) {
      rooms.push(await id('INSERT INTO rooms (name, building, capacity) VALUES ($1, $2, 60)', [name, b]));
    }
    const subj = {};
    for (const [code, name, dep] of [['BCA301', 'Data Structures', cse], ['BCA302', 'Database Management Systems', cse], ['BCA303', 'Operating Systems', cse],
      ['BCA304', 'Web Technologies', cse], ['MBA101', 'Principles of Management', mgmt], ['MBA102', 'Business Economics', mgmt], ['MBA103', 'Financial Accounting', mgmt]]) {
      subj[code] = await id('INSERT INTO subjects (code, name, department_id) VALUES ($1, $2, $3)', [code, name, dep]);
    }
    const teachers = [];
    for (const [u, name, emp, dep, des] of [['teacher1', 'Dr. Meera Kapoor', 'UU-EMP-101', cse, 'Associate Professor'], ['teacher2', 'Prof. Sanjay Rana', 'UU-EMP-102', cse, 'Assistant Professor'],
      ['teacher3', 'Dr. Anita Joshi', 'UU-EMP-201', mgmt, 'Professor']]) {
      const uid = await id("INSERT INTO users (username, password_hash, role, name, must_change_pw) VALUES ($1, $2, 'teacher', $3, FALSE)", [u, hash, name]);
      await t.query('INSERT INTO teachers (user_id, employee_no, department_id, designation) VALUES ($1, $2, $3, $4)', [uid, emp, dep, des]);
      teachers.push(uid);
    }

    // Students, bulk inserted.
    for (const [cid, prefix, n] of classes) {
      const rolls = Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
      const names = rolls.map((_, i) => `${FIRST[(i * 7 + cid) % FIRST.length]} ${LAST[(i * 5 + cid * 3) % LAST.length]}`);
      await t.query('INSERT INTO students (roll_no, name, class_id, phone) SELECT r, n, $3, $4 FROM unnest($1::text[], $2::text[]) AS x(r, n)', [rolls, names, cid, null]);
    }

    // Weekly timetable, Monday to Saturday, so every demo day has lectures (today included).
    const plan = {
      [classes[0][0]]: [['BCA301', 0, 0], ['BCA302', 0, 0], ['BCA303', 1, 0], ['BCA304', 1, 3]],
      [classes[1][0]]: [['BCA302', 0, 1], ['BCA301', 0, 1], ['BCA304', 1, 3], ['BCA303', 1, 1]],
      [classes[2][0]]: [['MBA101', 2, 2], ['MBA102', 2, 2], ['MBA103', 2, 2]],
    };
    const slots = [['09:00', '10:00'], ['10:10', '11:10'], ['11:20', '12:20'], ['13:00', '14:00']];
    const lectures = [];
    for (let day = 1; day <= 6; day++) {
      for (const [cid, list] of Object.entries(plan)) {
        // Rotate subjects across the day so each weekday looks different; avoid clashes per teacher/room.
        list.forEach(([code, tIdx, rIdx], k) => {
          const slot = (k + day + Number(cid)) % slots.length;
          lectures.push({ cid: Number(cid), code, teacher: teachers[tIdx], room: rooms[rIdx], day, slot });
        });
      }
    }
    // Drop any lecture that would clash with an earlier one for the same teacher or room.
    const busy = new Set();
    for (const l of lectures) {
      let slot = l.slot;
      for (let tries = 0; tries < slots.length; tries++, slot = (slot + 1) % slots.length) {
        const keys = [`t${l.teacher}:${l.day}:${slot}`, `r${l.room}:${l.day}:${slot}`, `c${l.cid}:${l.day}:${slot}`];
        if (keys.every((k) => !busy.has(k))) { keys.forEach((k) => busy.add(k)); l.slot = slot; l.ok = true; break; }
      }
      if (l.ok) {
        l.id = await id('INSERT INTO lectures (teacher_id, class_id, subject_id, room_id, day, start_time, end_time) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [l.teacher, l.cid, subj[l.code], l.room, l.day, slots[l.slot][0], slots[l.slot][1]]);
      }
    }

    // Two weeks of saved attendance before today.
    const studentsBy = new Map();
    for (const [cid] of classes) studentsBy.set(cid, (await t.query('SELECT id FROM students WHERE class_id = $1 ORDER BY roll_no', [cid])).map((r) => r.id));
    const todayIso = new Date();
    for (let back = 14; back >= 1; back--) {
      const d = new Date(todayIso.getFullYear(), todayIso.getMonth(), todayIso.getDate() - back);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      for (const l of lectures.filter((x) => x.ok && x.day === dow)) {
        const ids = studentsBy.get(l.cid);
        const status = ids.map((_, k) => ((k * 7 + back * 3 + l.slot) % 10 < (k % 6 === 5 ? 6 : 9) ? 'P' : 'A'));
        const source = status.map((s, k) => (s === 'P' ? (k % 9 === 4 ? 'manual' : 'camera') : 'auto'));
        const present = status.filter((s) => s === 'P').length;
        const sid = await id(`INSERT INTO attendance_sessions (lecture_id, class_id, subject_id, teacher_id, room_id, date, status, registered_count, max_faces,
          recognised_count, present_count, frames, started_at, scan_ends_at, submitted_at, saved_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'saved', $7, $8, $9, $8, 100, $10::timestamptz, $10::timestamptz + interval '5 minutes', $10::timestamptz + interval '7 minutes', $10::timestamptz + interval '7 minutes')`,
        [l.id, l.cid, subj[l.code], l.teacher, l.room, date, ids.length, present, source.filter((s) => s === 'camera').length, `${date}T${slots[l.slot][0]}:00+05:30`]);
        await t.query(`INSERT INTO attendance_records (session_id, student_id, status, source, confidence)
          SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::real[])`,
        [sid, ids, status, source, source.map((s, k) => (s === 'camera' ? 0.55 + ((k * 13) % 40) / 100 : null))]);
      }
    }
  });

  const file = path.join(db.DATA_DIR, 'demo-logins.txt');
  fs.writeFileSync(file, `Demo accounts (all use the same password): ${password}\n\nadmin     admin1\nteacher   teacher1, teacher2, teacher3 (or employee no UU-EMP-101 ...)\n\nSuper admin: see initial-super-admin.txt\n`);
  console.log(`Demo data added. Logins saved in ${file}`);
  return true;
}

module.exports = { seedDemo };
if (require.main === module) seedDemo().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
