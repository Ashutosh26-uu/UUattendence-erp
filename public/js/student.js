import { h, api, table, startApp, fmtDate, money, pctBadge, pctText, timetableView, noticesView } from './common.js';

function stat(label, value, sub, kind = '') {
  return h('div', { class: `stat ${kind}` }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), sub && h('div', { class: 'sub', text: sub }));
}

const subjectTable = (subjects) => table([
  { label: 'Subject', render: (s) => `${s.code} ${s.name}` },
  { label: 'Present', class: 'num', render: (s) => `${s.present} / ${s.total}` },
  { label: '%', render: (s) => pctBadge(s.pct) },
], subjects, 'No attendance recorded yet.');

async function dashboard(main, ctx) {
  const d = await api('/api/student/dashboard');
  const p = ctx.me.profile;
  main.append(h('p', { class: 'muted', text: `${p.class_name} · Roll no ${p.roll_no}` }));
  const att = d.attendance;
  main.append(h('div', { class: 'stats' },
    stat('Attendance', pctText(att.pct), `${att.present} of ${att.total} classes`, att.pct != null && att.pct < 75 ? 'warn' : 'ok'),
    stat('Fees due', money(d.fees.due), `Paid ${money(d.fees.paid)} of ${money(d.fees.total)}`, d.fees.due > 0 ? 'warn' : ''),
    stat('Face photo', p.face_samples ? 'Enrolled' : 'Not enrolled', p.face_samples ? 'Camera attendance works for you' : 'Ask your teacher to enrol your face')));
  if (att.pct != null && att.pct < 75) main.append(h('div', { class: 'notice warn', text: 'Your attendance is below 75%.' }));
  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, h('h2', { text: 'Attendance by subject' }), subjectTable(att.subjects)),
    h('div', { class: 'card' }, h('h2', { text: 'Recent marks' }), table([
      { label: 'Exam', render: (m) => `${m.subject_code} ${m.name}` }, { label: 'Marks', class: 'num', render: (m) => `${m.marks} / ${m.max_marks}` },
    ], d.recent_marks, 'No marks yet.'))));
}

async function attendance(main) {
  const d = await api('/api/student/attendance');
  main.append(h('div', { class: 'card' }, h('h2', { text: `Overall: ${pctText(d.pct)} (${d.present} of ${d.total})` }), subjectTable(d.subjects)));
  main.append(h('div', { class: 'card' }, h('h2', { text: 'Recent classes' }), table([
    { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Subject', render: (r) => `${r.subject_code} ${r.subject_name}` },
    { label: 'Status', render: (r) => h('span', { class: `badge ${r.status === 'present' ? 'ok' : 'bad'}`, text: r.status }) },
    { label: 'Marked by', render: (r) => (r.source === 'camera' ? 'Camera' : r.source === 'manual' ? 'Teacher' : 'Not marked') },
  ], d.recent, 'No classes yet.')));
}

async function marks(main) {
  main.append(h('div', { class: 'card' }, table([
    { label: 'Date', render: (m) => fmtDate(m.exam_date) }, { label: 'Subject', render: (m) => `${m.subject_code} ${m.subject_name}` },
    { label: 'Exam', key: 'name' }, { label: 'Marks', class: 'num', render: (m) => (m.marks == null ? 'Not entered' : `${m.marks} / ${m.max_marks}`) },
  ], await api('/api/student/marks'), 'No exams yet.')));
}

async function fees(main) {
  const f = await api('/api/student/fees');
  main.append(h('div', { class: 'stats' }, stat('Total', money(f.total)), stat('Paid', money(f.paid), null, 'ok'), stat('Due', money(f.due), null, f.due > 0 ? 'warn' : '')));
  main.append(h('div', { class: 'card' }, h('h2', { text: 'Fees' }), table([
    { label: 'Fee', key: 'title' }, { label: 'Due date', render: (x) => fmtDate(x.due_date) }, { label: 'Amount', class: 'num', render: (x) => money(x.amount) },
    { label: 'Paid', class: 'num', render: (x) => money(x.paid) }, { label: 'Due', class: 'num', render: (x) => h('span', { class: `badge ${x.due > 0 ? 'warn' : 'ok'}`, text: money(x.due) }) },
  ], f.items, 'No fees set for your class.')));
  main.append(h('div', { class: 'card' }, h('h2', { text: 'Payments' }), table([
    { label: 'Receipt', key: 'receipt_no' }, { label: 'Date', render: (p) => fmtDate(p.paid_on) }, { label: 'Fee', key: 'title' },
    { label: 'Mode', render: (p) => (p.mode || '').toUpperCase() }, { label: 'Amount', class: 'num', render: (p) => money(p.amount) },
  ], f.payments, 'No payments yet.')));
}

async function profile(main, ctx) {
  const p = ctx.me.profile;
  const rows = [['Name', ctx.me.name], ['Roll no', p.roll_no], ['Class', p.class_name], ['Username', ctx.me.username], ['Email', ctx.me.email],
    ['Phone', ctx.me.phone], ['Guardian', p.guardian_name], ['Guardian phone', p.guardian_phone], ['Date of birth', fmtDate(p.dob)],
    ['Admission year', p.admission_year], ['Address', p.address]];
  main.append(h('div', { class: 'card' }, table([{ label: 'Field', key: 0 }, { label: 'Value', key: 1 }], rows)),
    h('p', { class: 'muted small', text: 'To correct any detail, contact the college office.' }));
}

async function timetable(main) {
  main.append(h('div', { class: 'card' }, timetableView(await api('/api/timetable'))));
}

startApp('student', [
  { id: 'dashboard', label: 'Dashboard', render: dashboard },
  { id: 'attendance', label: 'Attendance', render: attendance },
  { id: 'marks', label: 'Marks', render: marks },
  { id: 'fees', label: 'Fees', render: fees },
  { id: 'timetable', label: 'Timetable', render: timetable },
  { id: 'notices', label: 'Notices', render: noticesView },
  { id: 'profile', label: 'My profile', render: profile },
]);
