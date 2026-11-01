import {
  h, api, toast, busy, confirmBox, table, buildForm, startApp, fmtDate, money, pctBadge, pctText, timetableView, noticesView,
  statCard, cardTitle, donut, bars, avatar, dateChip, printButton, DAYS,
} from './common.js';
import { homeworkStudent } from './homework.js';
import { myGrievances, idCard, gradeCard, statusBadge } from './modules.js';

const subjectBars = (subjects) => bars(subjects.map((s) => ({ label: `${s.code} ${s.name}`, value: s.present, max: s.total, text: pctText(s.pct) })), { pctKind: true });

async function dashboard(main, ctx) {
  const [d, results, notices, tt] = await Promise.all([api('/api/student/dashboard'), api('/api/results/me'), api('/api/notices'), api('/api/timetable')]);
  const p = ctx.me.profile;
  const att = d.attendance;
  const jsDay = new Date().getDay();
  const todayNo = jsDay === 0 ? 7 : jsDay;
  const today = tt.filter((t) => t.day === todayNo);

  main.append(h('div', { class: 'card profile-card' }, avatar(ctx.me.name, p.photo, 'lg'),
    h('div', null, h('h2', { text: ctx.me.name }), h('div', { class: 'meta' },
      h('span', { text: `Roll no ${p.roll_no}` }), h('span', { text: p.class_name }), h('span', { text: p.department }),
      h('span', { text: `Semester ${p.semester ?? '-'}` }), h('span', { text: p.face_samples ? 'Face enrolled for camera attendance' : 'Face not enrolled yet' })))));

  if (att.pct != null && att.pct < 75) main.append(h('div', { class: 'notice warn', text: `Your attendance is ${att.pct}%. The university requires at least 75% to sit in the exams.` }));

  main.append(h('div', { class: 'stats' },
    statCard('check', 'Attendance', pctText(att.pct), `${att.present} of ${att.total} classes`, att.pct != null && att.pct < 75 ? 'warn' : 'ok'),
    statCard('award', 'CGPA', results.cgpa ?? '-', results.semesters.length ? `${results.semesters.length} semester(s) declared` : 'No result yet'),
    statCard('wallet', 'Fees due', money(d.fees.due), `Paid ${money(d.fees.paid)}`, d.fees.due > 0 ? 'warn' : 'ok'),
    statCard('clipboard', 'Assignments pending', d.homework_due.length, null, d.homework_due.length ? 'warn' : ''),
    statCard('library', 'Library books', d.books_out, 'currently with you')));

  main.append(h('div', { class: 'grid-2-1' },
    h('div', { class: 'card' }, cardTitle('chart', 'Subject-wise attendance'),
      h('div', { class: 'donut-wrap' }, donut(att.pct, 'overall'), h('div', { class: 'grow' }, subjectBars(att.subjects)))),
    h('div', { class: 'card' }, cardTitle('clock', `Today (${DAYS[todayNo]})`),
      today.length ? h('div', { class: 'list' }, today.map((t) => h('div', { class: 'list-item' },
        h('div', { class: 'date-chip' }, h('strong', { text: t.start_time }), h('span', { text: t.end_time })),
        h('div', { class: 'grow' }, h('div', { class: 'title', text: t.subject_name }), h('div', { class: 'small muted', text: [t.teacher_name, t.room].filter(Boolean).join(' · ') })))))
        : h('div', { class: 'empty', text: 'No classes today.' }))));

  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('clipboard', 'Upcoming assignments', h('a', { class: 'btn sm', href: '#homework', text: 'Open' })),
      d.homework_due.length ? h('div', { class: 'list' }, d.homework_due.map((x) => h('div', { class: 'list-item' }, dateChip(x.due_date),
        h('div', { class: 'grow' }, h('div', { class: 'title', text: x.title }), h('div', { class: 'small muted', text: x.subject_code })))))
        : h('div', { class: 'empty', text: 'Nothing pending.' })),
    h('div', { class: 'card' }, cardTitle('bell', 'Latest notices', h('a', { class: 'btn sm', href: '#notices', text: 'All' })),
      notices.length ? h('div', { class: 'list' }, notices.slice(0, 4).map((n) => h('div', { class: 'list-item' }, dateChip(n.created_at.slice(0, 10)),
        h('div', { class: 'grow' }, h('div', { class: 'title', text: n.title }), h('div', { class: 'small muted', text: n.body.length > 90 ? `${n.body.slice(0, 90)}...` : n.body })))))
        : h('div', { class: 'empty', text: 'No notices.' }))));
}

async function attendance(main) {
  const d = await api('/api/student/attendance');
  main.append(h('div', { class: 'grid-2-1' },
    h('div', { class: 'card' }, cardTitle('chart', 'By subject'), table([
      { label: 'Subject', render: (s) => `${s.code} ${s.name}` },
      { label: 'Present', class: 'num', render: (s) => `${s.present} / ${s.total}` },
      { label: '%', render: (s) => pctBadge(s.pct) },
    ], d.subjects, 'No attendance recorded yet.')),
    h('div', { class: 'card' }, cardTitle('check', 'Overall'), h('div', { class: 'donut-wrap' }, donut(d.pct, `${d.present}/${d.total}`)),
      h('p', { class: 'small muted', text: 'Minimum 75% attendance is required. Approved leave is visible to your teacher while marking.' }))));
  main.append(h('div', { class: 'card' }, cardTitle('list', 'Recent classes'), table([
    { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Subject', render: (r) => `${r.subject_code} ${r.subject_name}` },
    { label: 'Status', render: (r) => h('span', { class: `badge ${r.status === 'present' ? 'ok' : 'bad'}`, text: r.status }) },
    { label: 'Marked by', render: (r) => (r.source === 'camera' ? 'Camera' : r.source === 'manual' ? 'Teacher' : 'Not marked') },
  ], d.recent, 'No classes yet.')));
}

async function tests(main) {
  main.append(h('div', { class: 'card' }, table([
    { label: 'Date', render: (m) => fmtDate(m.exam_date) }, { label: 'Subject', render: (m) => `${m.subject_code} ${m.subject_name}` },
    { label: 'Test', key: 'name' }, { label: 'Marks', class: 'num', render: (m) => (m.marks == null ? 'Not entered' : `${m.marks} / ${m.max_marks}`) },
  ], await api('/api/student/marks'), 'No class tests yet.')));
}

async function results(main, ctx) {
  const card = await api('/api/results/me');
  const p = ctx.me.profile;
  main.append(h('div', { class: 'row no-print' }, printButton('Print grade card')), h('br'),
    gradeCard(card, { name: ctx.me.name, roll_no: p.roll_no, class_name: p.class_name }, ctx.me));
}

async function fees(main) {
  const f = await api('/api/student/fees');
  main.append(h('div', { class: 'grid-2-1' },
    h('div', { class: 'card' }, cardTitle('wallet', 'Fee details'), table([
      { label: 'Fee', key: 'title' }, { label: 'Due date', render: (x) => fmtDate(x.due_date) }, { label: 'Amount', class: 'num', render: (x) => money(x.amount) },
      { label: 'Paid', class: 'num', render: (x) => money(x.paid) }, { label: 'Balance', class: 'num', render: (x) => h('span', { class: `badge ${x.due > 0 ? 'warn' : 'ok'}`, text: money(x.due) }) },
    ], f.items, 'No fees set for your class.')),
    h('div', { class: 'card' }, cardTitle('chart', 'Summary'), h('div', { class: 'donut-wrap' }, donut(f.total ? (f.paid / f.total) * 100 : null, 'paid', 'ok'),
      h('div', { class: 'legend' }, h('div', null, `Total ${money(f.total)}`), h('div', null, h('span', { class: 'dot c2' }), `Paid ${money(f.paid)}`), h('div', null, h('span', { class: 'dot track' }), `Due ${money(f.due)}`))),
    h('p', { class: 'small muted', text: 'Pay at the accounts office; your receipt appears here.' }))));
  main.append(h('div', { class: 'card' }, cardTitle('receipt', 'Payment receipts'), table([
    { label: 'Receipt', key: 'receipt_no' }, { label: 'Date', render: (p) => fmtDate(p.paid_on) }, { label: 'Fee', key: 'title' },
    { label: 'Mode', render: (p) => (p.mode || '').toUpperCase() }, { label: 'Amount', class: 'num', render: (p) => money(p.amount) },
  ], f.payments, 'No payments yet.')));
}

async function leave(main) {
  const listCard = h('div', { class: 'card' });
  main.append(h('div', { class: 'card' }, cardTitle('calendar', 'Apply for leave'), buildForm([
    { name: 'leave_type', label: 'Type', type: 'select', required: true, default: 'personal', options: ['personal', 'medical', 'family', 'event', 'other'].map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
    { name: 'from_date', label: 'From', type: 'date', required: true },
    { name: 'to_date', label: 'To', type: 'date', required: true },
    { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
  ], {
    submitLabel: 'Apply',
    onSubmit: async (d, form) => { await api('/api/leave', { method: 'POST', body: d }); toast('Leave application sent to your teachers'); form.reset(); await load(); },
  })), listCard);
  async function load() {
    listCard.replaceChildren(cardTitle('list', 'My applications'), table([
      { label: 'Applied', render: (l) => fmtDate(l.created_at) }, { label: 'Type', key: 'leave_type' },
      { label: 'Dates', render: (l) => `${fmtDate(l.from_date)} - ${fmtDate(l.to_date)}` }, { label: 'Reason', render: (l) => h('span', { class: 'small', text: l.reason }) },
      { label: 'Status', render: (l) => h('div', null, statusBadge(l.status), l.remark && h('div', { class: 'small muted', text: l.remark })) },
      { label: '', class: 'actions', render: (l) => l.status === 'pending' && h('button', { class: 'sm danger', text: 'Withdraw', onclick: busy(async () => { if (!await confirmBox('Withdraw this leave application?', { ok: 'Withdraw', danger: true })) return; await api(`/api/leave/${l.id}`, { method: 'DELETE' }); await load(); }) }) },
    ], await api('/api/leave/mine'), 'No leave applications.'));
  }
  await load();
}

async function library(main) {
  const [mine, books] = [await api('/api/library/mine'), h('div')];
  main.append(h('div', { class: 'card' }, cardTitle('library', 'Books with me'), table([
    { label: 'Book', render: (i) => h('div', null, h('div', { text: i.title }), h('div', { class: 'small muted', text: `${i.author || ''} · ${i.accession_no}` })) },
    { label: 'Issued', render: (i) => fmtDate(i.issued_on) },
    { label: 'Due', render: (i) => (i.returned_on ? `Returned ${fmtDate(i.returned_on)}` : h('span', { class: `badge ${i.overdue ? 'bad' : 'primary'}`, text: fmtDate(i.due_on) })) },
    { label: 'Fine', class: 'num', render: (i) => (i.fine ? money(i.fine) : '-') },
  ], mine, 'No books issued.')));
  const q = h('input', { type: 'search', placeholder: 'Search title, author or category', 'aria-label': 'Search books' });
  const search = async () => {
    const list = await api(`/api/library/books${q.value ? `?q=${encodeURIComponent(q.value)}` : ''}`);
    books.replaceChildren(table([
      { label: 'Title', key: 'title' }, { label: 'Author', key: 'author' }, { label: 'Category', key: 'category' }, { label: 'Shelf', key: 'shelf' },
      { label: 'Available', render: (b) => h('span', { class: `badge ${b.available ? 'ok' : 'bad'}`, text: b.available ? `${b.available} available` : 'All issued' }) },
    ], list, 'No book found.'));
  };
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 300); });
  main.append(h('div', { class: 'card' }, cardTitle('book', 'Library catalogue', q), books));
  await search();
}

async function campus(main) {
  const d = await api('/api/campus/mine');
  const kv = (rows) => h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v ?? '-' })]));
  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('home', 'Hostel'), d.hostel ? h('div', null, kv([
      ['Hostel', d.hostel.hostel_name], ['Room', d.hostel.room_no], ['Beds', d.hostel.capacity], ['Since', fmtDate(d.hostel.allotted_on)],
      ['Warden', d.hostel.warden_name], ['Warden phone', d.hostel.warden_phone]]),
    h('h3', { class: 'face-head', text: 'Roommates' }), d.roommates.length ? h('div', { class: 'list' }, d.roommates.map((r) => h('div', { class: 'list-item' }, avatar(r.name), h('div', { class: 'grow' }, h('div', { class: 'title', text: r.name }), h('div', { class: 'small muted', text: `${r.roll_no} · ${r.class_name}` })))))
      : h('p', { class: 'muted', text: 'No roommates yet.' }))
      : h('div', { class: 'empty', text: 'You are not staying in the college hostel. Contact the hostel office to apply.' })),
    h('div', { class: 'card' }, cardTitle('bus', 'Transport'), d.transport ? kv([
      ['Route', d.transport.name], ['Bus no', d.transport.bus_no], ['Your stop', d.transport.stop], ['Departs', d.transport.departure_time],
      ['Driver', d.transport.driver_name], ['Driver phone', d.transport.driver_phone], ['Stops', d.transport.stops]])
      : h('div', { class: 'empty', text: 'You have no bus pass. Contact the transport office to apply.' }))));
}

async function feedback(main) {
  const d = await api('/api/support/feedback/form');
  if (!d.open) { main.append(h('div', { class: 'card empty', text: 'Faculty feedback is closed right now.' })); return; }
  main.append(h('p', { class: 'muted', text: `${d.cycle}. Rate each teacher from 1 (poor) to 5 (excellent). Your name is never shown to teachers.` }));
  for (const s of d.subjects) {
    const c = h('div', { class: 'card' }, cardTitle('star', `${s.code} ${s.name} · ${s.teacher_name}`, s.done ? h('span', { class: 'badge ok', text: 'Submitted' }) : null));
    if (!s.done) {
      const groups = d.questions.map((q, i) => h('div', { class: 'field' }, h('label', { text: `${i + 1}. ${q}` }),
        h('div', { class: 'rating', role: 'radiogroup', 'aria-label': q }, [1, 2, 3, 4, 5].map((n) => h('label', null, h('input', { type: 'radio', name: `q${i + 1}_${s.subject_id}`, value: n }), String(n))))));
      const comment = h('textarea', { placeholder: 'Comment (optional)', 'aria-label': 'Comment' });
      c.append(h('div', { class: 'form-grid' }, groups), h('br'), comment, h('div', { class: 'form-actions' }, h('button', {
        class: 'primary', text: 'Submit feedback', onclick: busy(async () => {
          const body = { subject_id: s.subject_id, comment: comment.value };
          for (let i = 1; i <= 5; i++) {
            const picked = c.querySelector(`input[name="q${i}_${s.subject_id}"]:checked`);
            if (!picked) throw new Error(`Please answer question ${i}`);
            body[`q${i}`] = picked.value;
          }
          await api('/api/support/feedback', { method: 'POST', body });
          toast('Thank you for your feedback');
          c.replaceChildren(cardTitle('star', `${s.code} ${s.name} · ${s.teacher_name}`, h('span', { class: 'badge ok', text: 'Submitted' })));
        }),
      })));
    }
    main.append(c);
  }
}

async function myIdCard(main, ctx) {
  const p = ctx.me.profile;
  main.append(h('div', { class: 'row no-print' }, printButton('Print ID card')), h('br'),
    idCard({ ...p, name: ctx.me.name }, ctx.me),
    !p.photo ? h('p', { class: 'muted small no-print', text: 'Your photo appears once your face is enrolled for camera attendance.' }) : null);
}

async function profile(main, ctx) {
  const p = ctx.me.profile;
  main.append(h('div', { class: 'card profile-card' }, avatar(ctx.me.name, p.photo, 'lg'), h('div', null, h('h2', { text: ctx.me.name }), h('div', { class: 'meta' }, h('span', { text: p.roll_no }), h('span', { text: p.class_name })))));
  main.append(h('div', { class: 'card' }, h('dl', { class: 'kv' }, [
    ['Roll no', p.roll_no], ['Course / class', p.class_name], ['Department', p.department], ['Semester', p.semester], ['Username', ctx.me.username],
    ['Email', ctx.me.email], ['Phone', ctx.me.phone], ['Date of birth', p.dob ? fmtDate(p.dob) : null], ['Blood group', p.blood_group],
    ['Guardian', p.guardian_name], ['Guardian phone', p.guardian_phone], ['Admission year', p.admission_year], ['Address', p.address],
  ].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v ?? '-' })]))),
  h('p', { class: 'muted small', text: 'To correct any detail, contact the college office.' }));
}

async function timetable(main) {
  main.append(h('div', { class: 'card' }, timetableView(await api('/api/timetable'))));
}

startApp('student', [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview', render: dashboard },
  { id: 'attendance', label: 'Attendance', icon: 'check', group: 'Academics', render: attendance },
  { id: 'timetable', label: 'Timetable', icon: 'clock', group: 'Academics', render: timetable },
  { id: 'homework', label: 'Assignments', icon: 'clipboard', group: 'Academics', render: homeworkStudent },
  { id: 'tests', label: 'Class tests', icon: 'file', group: 'Academics', render: tests },
  { id: 'results', label: 'Results', icon: 'award', group: 'Academics', render: results },
  { id: 'fees', label: 'Fees', icon: 'wallet', group: 'Services', render: fees },
  { id: 'leave', label: 'Leave', icon: 'calendar', group: 'Services', render: leave },
  { id: 'library', label: 'Library', icon: 'library', group: 'Services', render: library },
  { id: 'campus', label: 'Hostel and transport', icon: 'home', group: 'Services', render: campus },
  { id: 'id-card', label: 'ID card', icon: 'id', group: 'Services', render: myIdCard },
  { id: 'notices', label: 'Notices', icon: 'bell', group: 'Communication', render: noticesView },
  { id: 'feedback', label: 'Faculty feedback', icon: 'star', group: 'Communication', render: feedback },
  { id: 'grievance', label: 'Grievance', icon: 'alert', group: 'Communication', render: myGrievances },
  { id: 'profile', label: 'My profile', icon: 'teacher', group: 'Account', render: profile },
]);
