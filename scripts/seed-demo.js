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
      run(`INSERT INTO students(user_id, roll_no, class_id, guardian_name, guardian_phone, dob, admission_year, blood_group, address)
        VALUES (?, ?, ?, ?, ?, ?, 2025, ?, 'Dehradun, Uttarakhand')`, u, roll, c, `Mr. ${name.split(' ')[1]}`,
      `98${String(37000000 + i * 1013 + ci * 7).padStart(8, '0')}`, `2006-${String((i % 12) + 1).padStart(2, '0')}-${String((i * 2) % 27 + 1).padStart(2, '0')}`,
      ['A+', 'B+', 'O+', 'AB+', 'B-', 'O-'][i % 6]);
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

    // Previous semester (Sem 2) result, published, so grade cards and CGPA have data.
    const sem2 = [['BCA201', 'Object Oriented Programming'], ['BCA202', 'Discrete Mathematics'], ['BCA203', 'Computer Networks']]
      .map(([code, name]) => id(run('INSERT INTO subjects(code, name, department_id, credits) VALUES (?, ?, ?, 4)', code, name, dept)));
    classes.forEach((c, ci) => {
      studentsByClass[ci].forEach((st, k) => sem2.forEach((sub, si) => {
        const internal = 22 + ((k * 5 + si * 3) % 17);
        const external = k % 11 === 7 && si === 1 ? 18 : 28 + ((k * 7 + si * 11) % 31);
        run('INSERT INTO result_entries(student_id, subject_id, semester, class_id, internal, external) VALUES (?, ?, 2, ?, ?, ?)', st, sub, c, internal, external);
      }));
      run('INSERT INTO result_publish(class_id, semester) VALUES (?, 2)', c);
      // Current semester: internals entered by teachers, externals pending.
      studentsByClass[ci].forEach((st, k) => subjects.forEach((sub, si) => run(
        'INSERT INTO result_entries(student_id, subject_id, semester, class_id, internal) VALUES (?, ?, 3, ?, ?)', st, sub, c, 24 + ((k * 3 + si * 5) % 15))));
    });

    // Assignments, some already submitted and graded.
    const isoDay = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
    classes.forEach((c, ci) => {
      const hw1 = id(run(`INSERT INTO homework(class_id, subject_id, teacher_id, title, description, due_date, max_marks)
        VALUES (?, ?, ?, 'Linked list programs', 'Write C programs for insertion and deletion in a singly linked list.', ?, 10)`, c, subjects[0], teachers[0], isoDay(-5)));
      run(`INSERT INTO homework(class_id, subject_id, teacher_id, title, description, due_date, max_marks)
        VALUES (?, ?, ?, 'ER diagram for a library', 'Draw an ER diagram for a college library system and convert it to tables.', ?, 20)`, c, subjects[1], teachers[0], isoDay(4));
      run(`INSERT INTO homework(class_id, subject_id, teacher_id, title, description, due_date, max_marks)
        VALUES (?, ?, ?, 'CPU scheduling numericals', 'Solve the 5 FCFS / SJF / Round Robin questions from unit 2.', ?, 10)`, c, subjects[2], teachers[1], isoDay(7));
      studentsByClass[ci].slice(0, 8).forEach((st, k) => run(`INSERT INTO homework_submissions(homework_id, student_id, answer, submitted_at, marks, feedback)
        VALUES (?, ?, 'Programs attached in the answer below.', ?, ?, ?)`, hw1, st, `${isoDay(-6)} 18:00:00`, k < 5 ? 6 + (k % 5) : null, k < 5 ? 'Good work' : null));
    });

    // Library
    const books = [['LIB0001', 'Data Structures Using C', 'Reema Thareja', 'Computer Science', 5], ['LIB0002', 'Database System Concepts', 'Silberschatz, Korth', 'Computer Science', 4],
      ['LIB0003', 'Operating System Concepts', 'Silberschatz, Galvin', 'Computer Science', 4], ['LIB0004', 'Let Us C', 'Yashavant Kanetkar', 'Programming', 6],
      ['LIB0005', 'Computer Networks', 'Andrew Tanenbaum', 'Computer Science', 3], ['LIB0006', 'Discrete Mathematics', 'Kenneth Rosen', 'Mathematics', 3],
      ['LIB0007', 'Wings of Fire', 'A. P. J. Abdul Kalam', 'General', 2], ['LIB0008', 'Introduction to Algorithms', 'Cormen et al.', 'Computer Science', 2]]
      .map(([acc, title, author, cat, copies], i) => id(run('INSERT INTO books(accession_no, title, author, category, copies, shelf) VALUES (?, ?, ?, ?, ?, ?)', acc, title, author, cat, copies, `R${1 + (i % 4)}`)));
    run('INSERT INTO book_issues(book_id, user_id, issued_on, due_on) VALUES (?, ?, ?, ?)', books[0], studentsByClass[0][0], isoDay(-20), isoDay(-6));
    run('INSERT INTO book_issues(book_id, user_id, issued_on, due_on) VALUES (?, ?, ?, ?)', books[3], studentsByClass[0][0], isoDay(-3), isoDay(11));
    run('INSERT INTO book_issues(book_id, user_id, issued_on, due_on) VALUES (?, ?, ?, ?)', books[1], studentsByClass[1][2], isoDay(-10), isoDay(4));

    // Hostel and transport
    const boys = id(run("INSERT INTO hostels(name, type, warden_name, warden_phone) VALUES ('Aryabhatta Hostel', 'boys', 'Mr. R. K. Negi', '9837011111')"));
    const girls = id(run("INSERT INTO hostels(name, type, warden_name, warden_phone) VALUES ('Gargi Hostel', 'girls', 'Mrs. S. Bisht', '9837022222')"));
    const rooms = [boys, girls].map((h) => [101, 102, 103, 104].map((no) => id(run('INSERT INTO hostel_rooms(hostel_id, room_no, capacity) VALUES (?, ?, 3)', h, String(no)))));
    studentsByClass[0].slice(0, 6).forEach((st, k) => run('INSERT INTO hostel_allotments(student_id, room_id) VALUES (?, ?)', st, rooms[k % 2][Math.floor(k / 2) % 4]));
    const r1 = id(run("INSERT INTO bus_routes(name, bus_no, driver_name, driver_phone, departure_time, stops) VALUES ('Route 1 - ISBT', 'UK07 PA 1234', 'Ramesh Kumar', '9837033333', '07:30', 'ISBT, Clock Tower, Rajpur Road, Campus')"));
    const r2 = id(run("INSERT INTO bus_routes(name, bus_no, driver_name, driver_phone, departure_time, stops) VALUES ('Route 2 - Prem Nagar', 'UK07 PA 5678', 'Suresh Rawat', '9837044444', '07:45', 'Prem Nagar, Ballupur, Kaulagarh, Campus')"));
    studentsByClass[0].slice(6, 10).forEach((st, k) => run('INSERT INTO transport_allotments(student_id, route_id, stop) VALUES (?, ?, ?)', st, k % 2 ? r2 : r1, k % 2 ? 'Ballupur' : 'Clock Tower'));

    // Leave, feedback, grievance
    run("INSERT INTO leave_requests(student_id, from_date, to_date, leave_type, reason) VALUES (?, ?, ?, 'medical', 'Viral fever, doctor advised rest.')", studentsByClass[0][1], isoDay(1), isoDay(3));
    run("INSERT INTO leave_requests(student_id, from_date, to_date, leave_type, reason, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, 'family', 'Sister''s wedding', 'approved', ?, datetime('now'))", studentsByClass[0][0], isoDay(-12), isoDay(-11), teachers[0]);
    studentsByClass.flat().slice(2, 16).forEach((st, k) => subjects.forEach((sub, si) => run(`INSERT INTO feedback(student_id, teacher_id, subject_id, cycle, q1, q2, q3, q4, q5, comment)
      VALUES (?, ?, ?, '2026-27 Odd Sem', ?, ?, ?, ?, ?, ?)`, st, si === 2 ? teachers[1] : teachers[0], sub, 3 + ((k + si) % 3), 4 + (k % 2), 3 + ((k * si) % 3), 4, 3 + ((k + 1) % 3),
    k === 3 && si === 0 ? 'Please share more practice questions before tests.' : null)));
    run("INSERT INTO grievances(user_id, category, subject, description) VALUES (?, 'infrastructure', 'Projector not working in LT-101', 'The projector in LT-101 has not worked for a week, so slides cannot be shown.')", studentsByClass[0][3]);

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
