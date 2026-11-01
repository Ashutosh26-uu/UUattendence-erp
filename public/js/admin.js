import {
  h, api, toast, busy, confirmBox, showSecret, table, buildForm, selectEl, startApp, crudView,
  fmtDate, fmtDateTime, money, pctBadge, DAYS, statCard, cardTitle, donut, bars, columns,
} from './common.js';
import { enrollView } from './enroll.js';
import { leaveReview, resultsSheet, feedbackSummary } from './modules.js';
import { resultsAdmin, library, hostel, transport, grievances, idCards } from './admin-campus.js';

const options = async (url, label) => (await api(url)).map((r) => ({ value: r.id, label: label(r) }));
const deptOptions = () => options('/api/admin/departments', (d) => `${d.code} - ${d.name}`);
const classOptions = () => options('/api/admin/classes', (c) => c.name);
const subjectOptions = () => options('/api/admin/subjects', (s) => `${s.code} - ${s.name}`);
const dayOptions = DAYS.slice(1).map((d, i) => ({ value: i + 1, label: d }));

function userActions(r, reload) {
  return [
    h('button', {
      class: 'sm', text: 'Reset password', onclick: busy(async () => {
        if (!await confirmBox(`Give ${r.name} a new one-time password?`, { ok: 'Reset' })) return;
        const out = await api(`/api/admin/users/${r.id}/reset-password`, { method: 'POST' });
        await showSecret('New password', `One-time password for ${r.username}:`, out.temp_password);
      }),
    }),
    h('button', {
      class: `sm ${r.active ? 'danger' : 'ok'}`, text: r.active ? 'Deactivate' : 'Activate', onclick: busy(async () => {
        if (!await confirmBox(r.active ? `Deactivate ${r.name}? They will not be able to log in.` : `Activate ${r.name}?`, { ok: r.active ? 'Deactivate' : 'Activate', danger: !!r.active })) return;
        await api(`/api/admin/users/${r.id}/active`, { method: 'POST', body: { active: !r.active } });
        await reload();
      }),
    }),
  ];
}

const activeBadge = (r) => h('span', { class: `badge ${r.active ? 'ok' : 'bad'}`, text: r.active ? 'Active' : 'Inactive' });
const showCreatedLogin = (r, d) => showSecret('Account created', `Login for ${d.username}:`, r.temp_password);

// ---- Views ----
async function dashboard(main, ctx) {
  const s = await api('/api/admin/stats');
  ctx.setBadge('leave', s.pending_leaves);
  ctx.setBadge('grievances', s.open_grievances);
  const feePct = s.fees_total ? (s.fees_collected / s.fees_total) * 100 : null;
  main.append(h('div', { class: 'stats' },
    statCard('students', 'Students', s.students, `${s.face_enrolled} face enrolled`),
    statCard('teacher', 'Faculty', s.teachers, `${s.subjects} subjects`),
    statCard('building', 'Classes', s.classes),
    statCard('scan', 'Attendance today', s.sessions_today, `${s.sessions_open} in progress`, 'ok'),
    statCard('wallet', 'Fees collected', money(s.fees_collected), `of ${money(s.fees_total)}`, 'ok'),
    statCard('calendar', 'Leave requests', s.pending_leaves, 'pending', s.pending_leaves ? 'warn' : ''),
    statCard('alert', 'Grievances', s.open_grievances, 'open', s.open_grievances ? 'bad' : ''),
    statCard('library', 'Books issued', s.books_issued, `${s.hostel_residents} in hostel · ${s.bus_riders} on bus`)));

  main.append(h('div', { class: 'grid-2-1' },
    h('div', { class: 'card' }, cardTitle('chart', 'Daily attendance (last 14 class days)'),
      columns(s.attendance_trend.map((d) => {
        const p = d.total ? Math.round((d.present / d.total) * 100) : 0;
        return { label: new Date(`${d.date}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short' }), value: p, text: `${p}%` };
      }))),
    h('div', { class: 'card' }, cardTitle('wallet', 'Fee collection'),
      h('div', { class: 'donut-wrap' }, donut(feePct, 'collected', 'ok'),
        h('div', { class: 'legend' }, h('div', null, h('span', { class: 'dot c2' }), `Collected ${money(s.fees_collected)}`),
          h('div', null, h('span', { class: 'dot track' }), `Due ${money(Math.max(0, s.fees_total - s.fees_collected))}`))))));

  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('building', 'Class-wise attendance'),
      bars(s.class_attendance.map((c) => ({ label: c.name, value: c.present || 0, max: c.total || 0, text: c.total ? `${Math.round((c.present / c.total) * 100)}%` : '-' })), { pctKind: true })),
    h('div', { class: 'card' }, cardTitle('list', 'Quick actions'), h('div', { class: 'row' },
      [['students', 'Add student'], ['fees', 'Collect fee'], ['results', 'Results'], ['leave', 'Leave requests'], ['library', 'Issue book'], ['notices', 'Post notice'], ['id-cards', 'Print ID cards']]
        .map(([id, label]) => h('a', { class: 'btn', href: `#${id}`, text: label }))))));
}
const departments = crudView({
  endpoint: '/api/admin/departments',
  fields: async () => [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }],
  columns: [{ label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }],
});

const classes = crudView({
  endpoint: '/api/admin/classes',
  intro: 'Camera URL: the JPEG snapshot address of the classroom IP camera, e.g. http://user:pass@192.168.1.50/cgi-bin/snapshot.jpg. Leave empty if teachers use a laptop / USB camera.',
  fields: async () => [
    { name: 'name', label: 'Class name', required: true, placeholder: 'BCA Sem 3 - A' },
    { name: 'department_id', label: 'Department', type: 'select', required: true, options: await deptOptions() },
    { name: 'semester', label: 'Semester', type: 'number', min: 1, max: 12 },
    { name: 'section', label: 'Section' },
    { name: 'academic_year', label: 'Academic year', placeholder: '2026-27' },
    { name: 'room', label: 'Room' },
    { name: 'camera_url', label: 'Classroom camera URL', full: true, placeholder: 'http://192.168.1.50/snapshot.jpg' },
  ],
  columns: [
    { label: 'Class', key: 'name' }, { label: 'Department', key: 'department_name' }, { label: 'Sem', key: 'semester' },
    { label: 'Year', key: 'academic_year' }, { label: 'Room', key: 'room' }, { label: 'Students', key: 'student_count', class: 'num' },
    { label: 'Camera', render: (c) => h('span', { class: `badge ${c.camera_url ? 'ok' : ''}`, text: c.camera_url ? 'IP camera' : 'None' }) },
  ],
});

const subjects = crudView({
  endpoint: '/api/admin/subjects',
  fields: async () => [
    { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
    { name: 'department_id', label: 'Department', type: 'select', options: await deptOptions() },
    { name: 'credits', label: 'Credits', type: 'number', min: 0, max: 20 },
  ],
  columns: [{ label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Department', key: 'department_name' }, { label: 'Credits', key: 'credits', class: 'num' }],
});

const teachers = crudView({
  endpoint: '/api/admin/teachers',
  canDelete: false,
  fields: async () => [
    { name: 'name', label: 'Full name', required: true },
    { name: 'employee_no', label: 'Employee no', required: true },
    { name: 'username', label: 'Username', required: true },
    { name: 'password', label: 'Password', type: 'password', createOnly: true, hint: 'Leave empty to generate a one-time password' },
    { name: 'department_id', label: 'Department', type: 'select', options: await deptOptions() },
    { name: 'designation', label: 'Designation' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' },
  ],
  onCreated: showCreatedLogin,
  rowActions: userActions,
  columns: [
    { label: 'Name', key: 'name' }, { label: 'Emp no', key: 'employee_no' }, { label: 'Username', key: 'username' },
    { label: 'Department', key: 'department_name' }, { label: 'Subjects', key: 'subject_count', class: 'num' }, { label: 'Status', render: activeBadge },
  ],
});

const studentFields = async () => [
  { name: 'name', label: 'Full name', required: true },
  { name: 'roll_no', label: 'Roll no', required: true },
  { name: 'class_id', label: 'Class', type: 'select', required: true, options: await classOptions() },
  { name: 'username', label: 'Username', required: true },
  { name: 'password', label: 'Password', type: 'password', createOnly: true, hint: 'Leave empty to generate a one-time password' },
  { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' },
  { name: 'guardian_name', label: 'Guardian name' }, { name: 'guardian_phone', label: 'Guardian phone' },
  { name: 'dob', label: 'Date of birth', type: 'date' }, { name: 'admission_year', label: 'Admission year', type: 'number' },
  { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b })) },
  { name: 'address', label: 'Address', type: 'textarea', full: true },
];

// Paste many students at once: one per line "roll_no, name, username".
function importButton(reload) {
  return h('button', {
    text: 'Import list', onclick: async () => {
      const cls = await classOptions();
      const out = h('div');
      const form = buildForm([
        { name: 'class_id', label: 'Class', type: 'select', required: true, options: cls },
        { name: 'lines', label: 'One student per line: roll_no, name, username (username optional, roll no is used)', type: 'textarea', required: true, full: true, placeholder: 'BCA301, Aman Verma, aman301\nBCA302, Priya Singh' },
      ], {
        submitLabel: 'Import',
        onSubmit: async (d) => {
          const results = [];
          for (const line of String(d.lines).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
            const [roll, name, username] = line.split(',').map((x) => x.trim());
            try {
              const r = await api('/api/admin/students', { method: 'POST', body: { class_id: d.class_id, roll_no: roll, name, username: username || roll } });
              results.push({ roll, name, username: username || roll, password: r.temp_password, ok: true });
            } catch (err) {
              results.push({ roll, name, username: username || roll, password: err.message, ok: false });
            }
          }
          const csvText = ['roll_no,name,username,one_time_password', ...results.filter((r) => r.ok).map((r) => [r.roll, r.name, r.username, r.password].join(','))].join('\n');
          const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
          out.replaceChildren(h('div', { class: 'between' }, h('h2', { text: `Imported ${results.filter((r) => r.ok).length} of ${results.length}` }),
            h('a', { class: 'btn primary', href: url, download: 'student-logins.csv', text: 'Download logins (CSV)' })),
          table([{ label: 'Roll', key: 'roll' }, { label: 'Name', key: 'name' }, { label: 'Username', key: 'username' },
            { label: 'One-time password / error', render: (r) => h('span', { class: r.ok ? 'secret small' : 'badge bad', text: r.password }) }], results));
          await reload();
        },
      });
      const card = h('div', { class: 'card' }, h('h2', { text: 'Import students' }), form, out);
      document.querySelector('.main .page-head').after(card);
    },
  });
}

const students = crudView({
  endpoint: '/api/admin/students',
  canDelete: false,
  filter: { param: 'classId', placeholder: 'All classes', options: classOptions },
  fields: studentFields,
  extra: importButton,
  onCreated: showCreatedLogin,
  rowActions: userActions,
  columns: [
    { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Class', key: 'class_name' }, { label: 'Username', key: 'username' },
    { label: 'Face', render: (s) => h('span', { class: `badge ${s.face_samples ? 'ok' : 'warn'}`, text: s.face_samples ? `${s.face_samples} photo(s)` : 'Not enrolled' }) },
    { label: 'Status', render: activeBadge },
  ],
});

async function assignments(main) {
  const [tOpts, cOpts, sOpts] = await Promise.all([
    options('/api/admin/teachers', (t) => `${t.name} (${t.employee_no})`), classOptions(), subjectOptions()]);
  const listCard = h('div', { class: 'card' });
  main.append(h('p', { class: 'muted', text: 'Each class + subject has one teacher. Only that teacher can take attendance and enter marks for it.' }),
    h('div', { class: 'card' }, h('h2', { text: 'Assign a subject' }), buildForm([
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: cOpts },
      { name: 'subject_id', label: 'Subject', type: 'select', required: true, options: sOpts },
      { name: 'teacher_id', label: 'Teacher', type: 'select', required: true, options: tOpts },
    ], { submitLabel: 'Assign', onSubmit: async (d) => { await api('/api/admin/assignments', { method: 'POST', body: d }); toast('Assigned'); await load(); } })),
    listCard);
  async function load() {
    listCard.replaceChildren(table([
      { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (a) => `${a.subject_code} ${a.subject_name}` }, { label: 'Teacher', key: 'teacher_name' },
      { label: '', class: 'actions', render: (a) => h('button', { class: 'sm danger', text: 'Remove', onclick: busy(async () => { await api(`/api/admin/assignments/${a.id}`, { method: 'DELETE' }); await load(); }) }) },
    ], await api('/api/admin/assignments'), 'No subjects assigned yet.'));
  }
  await load();
}

const timetable = crudView({
  endpoint: '/api/admin/timetable',
  fields: async () => [
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: await classOptions() },
    { name: 'day', label: 'Day', type: 'select', required: true, options: dayOptions },
    { name: 'start_time', label: 'Start', type: 'time', required: true }, { name: 'end_time', label: 'End', type: 'time', required: true },
    { name: 'subject_id', label: 'Subject', type: 'select', required: true, options: await subjectOptions() },
    { name: 'room', label: 'Room' },
  ],
  columns: [
    { label: 'Class', key: 'class_name' }, { label: 'Day', render: (t) => DAYS[t.day] }, { label: 'Time', render: (t) => `${t.start_time} - ${t.end_time}` },
    { label: 'Subject', render: (t) => `${t.subject_code} ${t.subject_name}` }, { label: 'Room', key: 'room' },
  ],
});

const feeHeads = crudView({
  endpoint: '/api/admin/fee-structures',
  intro: 'Fee heads per class (tuition, exam fee, ...). Every student of the class owes each head.',
  fields: async () => [
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: await classOptions() },
    { name: 'title', label: 'Title', required: true, placeholder: 'Tuition fee - Sem 3' },
    { name: 'amount', label: 'Amount (Rs)', type: 'number', required: true, min: 0, step: '0.01' },
    { name: 'due_date', label: 'Due date', type: 'date' },
  ],
  columns: [{ label: 'Class', key: 'class_name' }, { label: 'Title', key: 'title' }, { label: 'Amount', class: 'num', render: (f) => money(f.amount) }, { label: 'Due', render: (f) => fmtDate(f.due_date) }],
});

async function feeCollection(main) {
  const cOpts = await classOptions();
  const formCard = h('div', { class: 'card hidden' });
  const duesCard = h('div', { class: 'card' });
  const payCard = h('div', { class: 'card' });
  const classSel = selectEl(cOpts, { placeholder: 'All classes', onchange: () => load() });
  main.append(h('div', { class: 'row' }, h('strong', { text: 'Class' }), classSel), h('br'), formCard, duesCard, payCard);

  async function record(st) {
    const heads = (await api('/api/admin/fee-structures')).filter((f) => f.class_name === st.class_name);
    formCard.replaceChildren(h('h2', { text: `Record payment: ${st.name} (${st.roll_no})` }), h('p', { class: 'muted', text: `Due: ${money(st.due)}` }), buildForm([
      { name: 'fee_id', label: 'Fee', type: 'select', required: true, options: heads.map((f) => ({ value: f.id, label: `${f.title} (${money(f.amount)})` })) },
      { name: 'amount', label: 'Amount (Rs)', type: 'number', required: true, min: 0.01, step: '0.01' },
      { name: 'paid_on', label: 'Paid on', type: 'date', default: new Date().toISOString().slice(0, 10) },
      { name: 'mode', label: 'Mode', type: 'select', required: true, default: 'cash', options: ['cash', 'upi', 'card', 'bank', 'cheque'].map((m) => ({ value: m, label: m.toUpperCase() })) },
    ], {
      submitLabel: 'Save payment',
      onCancel: () => formCard.classList.add('hidden'),
      onSubmit: async (d) => {
        const r = await api('/api/admin/fees/payments', { method: 'POST', body: { ...d, student_id: st.id } });
        toast(`Payment saved. Receipt ${r.receipt_no}`);
        formCard.classList.add('hidden');
        await load();
      },
    }));
    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  async function load() {
    const q = classSel.value ? `?classId=${classSel.value}` : '';
    const dues = await api(`/api/admin/fees/dues${q}`);
    duesCard.replaceChildren(h('h2', { text: 'Student dues' }), table([
      { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Class', key: 'class_name' },
      { label: 'Total', class: 'num', render: (r) => money(r.total) }, { label: 'Paid', class: 'num', render: (r) => money(r.paid) },
      { label: 'Due', class: 'num', render: (r) => h('span', { class: `badge ${r.due > 0 ? 'warn' : 'ok'}`, text: money(r.due) }) },
      { label: '', class: 'actions', render: (r) => r.due > 0 && h('button', { class: 'sm primary', text: 'Record payment', onclick: busy(() => record(r)) }) },
    ], dues, 'No students.'));
    const pays = await api('/api/admin/fees/payments');
    payCard.replaceChildren(h('h2', { text: 'Recent payments' }), table([
      { label: 'Receipt', key: 'receipt_no' }, { label: 'Date', render: (p) => fmtDate(p.paid_on) }, { label: 'Student', render: (p) => `${p.student_name} (${p.roll_no})` },
      { label: 'Fee', key: 'fee_title' }, { label: 'Mode', render: (p) => (p.mode || '').toUpperCase() }, { label: 'Amount', class: 'num', render: (p) => money(p.amount) },
      { label: 'By', key: 'recorded_by_name' },
    ], pays.slice(0, 50), 'No payments yet.'));
  }
  await load();
}

async function attendance(main) {
  const cOpts = await classOptions();
  const reportCard = h('div', { class: 'card' });
  const sessCard = h('div', { class: 'card' });
  const detailCard = h('div', { class: 'card hidden' });
  const classSel = selectEl(cOpts, { placeholder: 'Choose a class', onchange: () => load() });
  main.append(h('div', { class: 'row' }, h('strong', { text: 'Class' }), classSel), h('br'), detailCard, reportCard, sessCard);

  async function showSession(id) {
    const d = await api(`/api/admin/attendance/sessions/${id}`);
    const s = d.session;
    detailCard.replaceChildren(h('div', { class: 'between' }, h('h2', { text: `Attendance on ${fmtDate(s.date)} (${s.status})` }),
      h('button', { class: 'sm', text: 'Close', onclick: () => detailCard.classList.add('hidden') })),
    h('p', { class: 'muted', text: `Registered ${s.registered_count} · counted by camera ${s.max_faces ?? '-'} · ${s.captures} capture(s)` }),
    table([
      { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
      { label: 'Status', render: (m) => h('span', { class: `badge ${m.status === 'present' ? 'ok' : 'bad'}`, text: m.status }) },
      { label: 'How', key: 'source' }, { label: 'Marked', render: (m) => fmtDateTime(m.marked_at) },
      s.status === 'submitted' && {
        label: 'Correct', class: 'actions', render: (m) => h('button', {
          class: 'sm', text: m.status === 'present' ? 'Make absent' : 'Make present', onclick: busy(async () => {
            const to = m.status === 'present' ? 'absent' : 'present';
            if (!await confirmBox(`Change ${m.name} to ${to}? This is recorded in the audit log.`, { ok: 'Change' })) return;
            await api(`/api/admin/attendance/sessions/${id}/marks`, { method: 'PUT', body: { student_id: m.student_id, status: to } });
            await showSession(id);
            await load();
          }),
        }),
      },
    ].filter(Boolean), d.marks, 'No marks.'));
    detailCard.classList.remove('hidden');
    detailCard.scrollIntoView({ behavior: 'smooth' });
  }

  async function load() {
    const classId = classSel.value;
    if (classId) {
      const r = await api(`/api/admin/reports/attendance?classId=${classId}`);
      reportCard.replaceChildren(h('div', { class: 'between' }, h('h2', { text: `Attendance report: ${r.class.name}` }),
        h('a', { class: 'btn', href: `/api/admin/reports/attendance?classId=${classId}&format=csv`, text: 'Download CSV' })),
      table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
        ...r.subjects.map((sub) => ({ label: sub.code, class: 'num', render: (st) => (st.bySubject[sub.id] ? `${st.bySubject[sub.id].present}/${st.bySubject[sub.id].total}` : '-') })),
        { label: 'Overall', render: (st) => pctBadge(st.pct) },
      ], r.students, 'No students in this class.'));
    } else {
      reportCard.replaceChildren(h('div', { class: 'empty', text: 'Choose a class to see its attendance report.' }));
    }
    const sessions = await api(`/api/admin/attendance/sessions${classId ? `?classId=${classId}` : ''}`);
    sessCard.replaceChildren(h('h2', { text: 'Attendance sessions' }), table([
      { label: 'Date', render: (s) => fmtDate(s.date) }, { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (s) => `${s.subject_code} ${s.subject_name}` },
      { label: 'Teacher', key: 'teacher_name' },
      { label: 'Present', class: 'num', render: (s) => `${s.present}/${s.registered_count}` },
      { label: 'By camera', class: 'num', key: 'by_camera' }, { label: 'Camera count', class: 'num', render: (s) => s.max_faces ?? '-' },
      { label: 'Status', render: (s) => h('span', { class: `badge ${s.status === 'submitted' ? 'ok' : s.status === 'open' ? 'warn' : ''}`, text: s.status }) },
      { label: '', class: 'actions', render: (s) => h('button', { class: 'sm', text: 'View', onclick: busy(() => showSession(s.id)) }) },
    ], sessions, 'No attendance taken yet.'));
  }
  await load();
}

const notices = crudView({
  endpoint: '/api/admin/notices',
  fields: async () => [
    { name: 'title', label: 'Title', required: true },
    { name: 'audience', label: 'Show to', type: 'select', required: true, default: 'all', options: [{ value: 'all', label: 'Everyone' }, { value: 'teacher', label: 'Teachers' }, { value: 'student', label: 'Students' }] },
    { name: 'body', label: 'Message', type: 'textarea', required: true, full: true },
  ],
  columns: [{ label: 'Date', render: (n) => fmtDate(n.created_at) }, { label: 'Title', key: 'title' }, { label: 'For', key: 'audience' }, { label: 'By', key: 'author' }],
});

async function settings(main) {
  const s = await api('/api/admin/settings');
  main.append(h('div', { class: 'card' }, buildForm([
    { name: 'college_name', label: 'College name', required: true },
    { name: 'college_short', label: 'Logo letters (max 4)', required: true },
    { name: 'academic_session', label: 'Academic session', required: true, placeholder: '2026-27' },
    { name: 'library_issue_days', label: 'Library: issue period (days)', type: 'number', min: 1, max: 180, required: true },
    { name: 'library_fine_per_day', label: 'Library: late fine per day (Rs)', type: 'number', min: 0, step: '0.5', required: true },
    { name: 'feedback_open', label: 'Faculty feedback form', type: 'select', required: true, options: [{ value: '1', label: 'Open for students' }, { value: '0', label: 'Closed' }] },
    { name: 'feedback_cycle', label: 'Feedback cycle name', required: true, placeholder: '2026-27 Odd Sem' },
    { name: 'match_threshold', label: 'Face match strictness (0.30 - 0.70)', type: 'number', step: '0.01', min: 0.3, max: 0.7, required: true, hint: 'Lower = stricter (fewer wrong matches, more students missed). 0.50 is a good start; try 0.45 if look-alikes get mixed up.' },
    { name: 'min_face_confidence', label: 'Face detection confidence (0.20 - 0.95)', type: 'number', step: '0.05', min: 0.2, max: 0.95, required: true, hint: 'Lower finds more small or back-row faces but may count non-faces.' },
  ], { values: s, submitLabel: 'Save settings', onSubmit: async (d) => { await api('/api/admin/settings', { method: 'PUT', body: d }); toast('Settings saved'); } })));
}

async function auditLog(main) {
  main.append(h('div', { class: 'card' }, table([
    { label: 'When', render: (a) => fmtDateTime(a.at) }, { label: 'Who', key: 'user_name' }, { label: 'Action', key: 'action' },
    { label: 'Detail', render: (a) => h('span', { class: 'small muted', text: a.detail || '' }) },
  ], await api('/api/admin/audit'))));
}

const subjectPairs = async () => {
  const list = await api('/api/admin/assignments');
  return list.map((a) => ({ value: `${a.class_id}:${a.subject_id}`, label: `${a.class_name} - ${a.subject_code} ${a.subject_name} (${a.teacher_name})` }));
};

startApp('admin', [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview', render: dashboard },
  { id: 'students', label: 'Students', icon: 'students', group: 'Academics', render: students },
  { id: 'teachers', label: 'Faculty', icon: 'teacher', group: 'Academics', render: teachers },
  { id: 'classes', label: 'Classes', icon: 'building', group: 'Academics', render: classes },
  { id: 'subjects', label: 'Subjects', icon: 'book', group: 'Academics', render: subjects },
  { id: 'departments', label: 'Departments', icon: 'layers', group: 'Academics', render: departments },
  { id: 'assignments', label: 'Subject allotment', icon: 'link', group: 'Academics', render: assignments },
  { id: 'timetable', label: 'Timetable', icon: 'clock', group: 'Academics', render: timetable },
  { id: 'attendance', label: 'Attendance', icon: 'check', group: 'Attendance', render: attendance },
  { id: 'faces', label: 'Face enrolment', icon: 'scan', group: 'Attendance', render: enrollView('/api/admin/classes') },
  { id: 'leave', label: 'Leave requests', icon: 'calendar', group: 'Attendance', render: leaveReview },
  { id: 'results', label: 'Results', icon: 'award', group: 'Examination', render: resultsAdmin },
  { id: 'marks-entry', label: 'Marks entry', icon: 'clipboard', group: 'Examination', render: async (main) => resultsSheet(main, await subjectPairs()) },
  { id: 'fees', label: 'Fee collection', icon: 'wallet', group: 'Finance', render: feeCollection },
  { id: 'fee-heads', label: 'Fee heads', icon: 'receipt', group: 'Finance', render: feeHeads },
  { id: 'library', label: 'Library', icon: 'library', group: 'Campus', render: library },
  { id: 'hostel', label: 'Hostel', icon: 'home', group: 'Campus', render: hostel },
  { id: 'transport', label: 'Transport', icon: 'bus', group: 'Campus', render: transport },
  { id: 'id-cards', label: 'ID cards', icon: 'id', group: 'Campus', render: idCards },
  { id: 'notices', label: 'Notices', icon: 'bell', group: 'Communication', render: notices },
  { id: 'grievances', label: 'Grievances', icon: 'alert', group: 'Communication', render: grievances },
  { id: 'feedback', label: 'Faculty feedback', icon: 'star', group: 'Communication', render: feedbackSummary },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'System', render: settings },
  { id: 'audit', label: 'Audit log', icon: 'log', group: 'System', render: auditLog },
]).then((ctx) => {
  // Menu counters for things waiting on the admin.
  api('/api/admin/stats').then((s) => { ctx.setBadge('leave', s.pending_leaves); ctx.setBadge('grievances', s.open_grievances); }).catch(() => {});
});
