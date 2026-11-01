// Fills the database with a demo department, classes, teachers, students, timetable,
// fees and a few weeks of past attendance. Run once: npm run seed:demo
// Demo accounts share one password: DEMO_PASSWORD if set, otherwise a random one.
const fs = require('node:fs');
const path = require('node:path');
const { one, run, tx, DATA_DIR } = require('../src/db');
const { hashPassword, tempPassword } = require('../src/auth');

const FIRST = ['Aman', 'Priya', 'Rahul', 'Sneha', 'Vikas', 'Neha', 'Arjun', 'Pooja', 'Rohit', 'Anjali', 'Karan', 'Divya'];
const LAST = ['Sharma', 'Verma', 'Singh', 'Gupta', 'Yadav', 'Mishra', 'Rawat', 'Negi', 'Joshi', 'Bisht'];

function seedDemo() {
  if (one("SELECT 1 FROM departments WHERE code = 'CSE'")) {
    console.log('Demo data already exists. Delete data/erp.db to start over.');
    return false;
  }

  const password = process.env.DEMO_PASSWORD || tempPassword();
  const hash = hashPassword(password);
  const id = (r) => Number(r.lastInsertRowid);

  const logins = [];
  tx(() => {
    const dept = id(run("INSERT INTO departments(code, name) VALUES ('CSE', 'Computer Science and Engineering')"));
    const classes = [
      id(run("INSERT INTO classes(name, department_id, semester, section, academic_year, room) VALUES ('BCA Sem 3 - A', ?, 3, 'A', '2026-27', 'LT-101')", dept)),
      id(run("INSERT INTO classes(name, department_id, semester, section, academic_year, room) VALUES ('BCA Sem 3 - B', ?, 3, 'B', '2026-27', 'LT-102')", dept)),
    ];
    const subjects = [
      ['BCA301', 'Data Structures'], ['BCA302', 'Database Management Systems'], ['BCA303', 'Operating Systems'],
    ].map(([code, name]) => id(run('INSERT INTO subjects(code, name, department_id, credits) VALUES (?, ?, ?, 4)', code, name, dept)));

    const teachers = [['teacher1', 'Dr. Meera Kapoor', 'EMP001'], ['teacher2', 'Prof. Sanjay Rana', 'EMP002']].map(([u, name, emp]) => {
      const t = id(run("INSERT INTO users(username, password_hash, role, name, must_change_pw) VALUES (?, ?, 'teacher', ?, 0)", u, hash, name));
      run("INSERT INTO teachers(user_id, employee_no, department_id, designation) VALUES (?, ?, ?, 'Assistant Professor')", t, emp, dept);
      logins.push(`teacher  ${u}`);
      return t;
    });

    // teacher1: DS + DBMS in both classes, teacher2: OS in both classes
    for (const c of classes) {
      run('INSERT INTO assignments(teacher_id, class_id, subject_id) VALUES (?, ?, ?)', teachers[0], c, subjects[0]);
      run('INSERT INTO assignments(teacher_id, class_id, subject_id) VALUES (?, ?, ?)', teachers[0], c, subjects[1]);
      run('INSERT INTO assignments(teacher_id, class_id, subject_id) VALUES (?, ?, ?)', teachers[1], c, subjects[2]);
    }

    const studentsByClass = classes.map((c, ci) => Array.from({ length: 12 }, (_, i) => {
      const roll = `BCA3${'AB'[ci]}${String(i + 1).padStart(2, '0')}`;
      const name = `${FIRST[(i + ci * 5) % FIRST.length]} ${LAST[(i * 3 + ci) % LAST.length]}`;
      const u = id(run("INSERT INTO users(username, password_hash, role, name, must_change_pw) VALUES (?, ?, 'student', ?, 0)", roll.toLowerCase(), hash, name));
      run('INSERT INTO students(user_id, roll_no, class_id, guardian_name, admission_year) VALUES (?, ?, ?, ?, 2025)', u, roll, c, `Mr. ${name.split(' ')[1]}`);
      if (i === 0) logins.push(`student  ${roll.toLowerCase()}`);
      return u;
    }));

    const slots = [['09:00', '10:00'], ['10:00', '11:00'], ['11:15', '12:15']];
    for (const c of classes) {
      for (let day = 1; day <= 5; day++) {
        slots.forEach(([s, e], k) => run('INSERT INTO timetable(class_id, day, start_time, end_time, subject_id, room) VALUES (?, ?, ?, ?, ?, ?)',
          c, day, s, e, subjects[(k + day) % 3], 'LT-10' + (classes.indexOf(c) + 1)));
      }
      run("INSERT INTO fee_structures(class_id, title, amount, due_date) VALUES (?, 'Tuition fee - Sem 3', 45000, '2026-08-31')", c);
      run("INSERT INTO fee_structures(class_id, title, amount, due_date) VALUES (?, 'Exam fee - Sem 3', 2500, '2026-11-30')", c);
    }

    // Three weeks of past (submitted) attendance so reports have data.
    const start = new Date();
    start.setDate(start.getDate() - 21);
    for (let d = 0; d < 21; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + d);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const date = day.toISOString().slice(0, 10);
      classes.forEach((c, ci) => subjects.forEach((sub, si) => {
        const teacher = si === 2 ? teachers[1] : teachers[0];
        const list = studentsByClass[ci];
        const s = id(run(`INSERT INTO attendance_sessions(class_id, subject_id, teacher_id, date, status, registered_count, last_faces, max_faces, captures, started_at, submitted_at)
          VALUES (?, ?, ?, ?, 'submitted', ?, 0, 0, 1, ?, ?)`, c, sub, teacher, date, list.length, `${date} 09:00:00`, `${date} 09:10:00`));
        let present = 0;
        list.forEach((st, k) => {
          const isPresent = (k * 7 + d * 3 + si) % 10 < (k % 4 === 3 ? 6 : 9);
          if (isPresent) present++;
          run('INSERT INTO attendance_marks(session_id, student_id, status, source, marked_at) VALUES (?, ?, ?, ?, ?)',
            s, st, isPresent ? 'present' : 'absent', isPresent ? 'camera' : 'auto', `${date} 09:05:00`);
        });
        run('UPDATE attendance_sessions SET last_faces = ?, max_faces = ? WHERE id = ?', present, present, s);
      }));
    }

    const admin = one("SELECT id FROM users WHERE role = 'admin'");
    run("INSERT INTO notices(title, body, audience, created_by) VALUES ('Camera attendance starts this week', 'Attendance in all BCA classes is now taken by the classroom camera. Students without a face photo should meet their class teacher.', 'all', ?)", admin?.id ?? null);
  });

  const file = path.join(DATA_DIR, 'demo-logins.txt');
  fs.writeFileSync(file, `Demo accounts (all use the same password): ${password}\n\n${logins.join('\n')}\n(all students: bca3a01..bca3a12, bca3b01..bca3b12)\n\nAdmin login: see initial-admin.txt\n`);
  console.log(`Demo data added. Logins saved in ${file}`);
  return true;
}

module.exports = { seedDemo };
if (require.main === module) seedDemo();
