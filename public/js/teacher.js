import { h, api, toast, busy, confirmBox, table, buildForm, selectEl, startApp, fmtDate, pctBadge, timetableView, noticesView, DAYS, statCard, cardTitle, bars, avatar, icon } from './common.js';
import { leaveReview, resultsSheet, feedbackSummary, myGrievances } from './modules.js';
import { homeworkTeacher } from './homework.js';
import { attendanceView } from './attendance.js';
import { enrollView } from './enroll.js';

const assignmentOptions = (list) => list.map((a) => ({ value: `${a.class_id}:${a.subject_id}`, label: `${a.class_name} - ${a.subject_code} ${a.subject_name}` }));

async function dashboard(main, ctx) {
  const [assignments, tt, sum] = await Promise.all([api('/api/teacher/assignments'), api('/api/timetable'), api('/api/teacher/summary')]);
  ctx.setBadge('leave', sum.pending_leaves);
  const jsDay = new Date().getDay();
  const todayNo = jsDay === 0 ? 7 : jsDay;
  const today = tt.filter((t) => t.day === todayNo);
  const open = assignments.filter((a) => a.open_session_id);
  const p = ctx.me.profile || {};

  main.append(h('div', { class: 'card profile-card' }, avatar(ctx.me.name, null, 'lg'),
    h('div', null, h('h2', { text: `Welcome, ${ctx.me.name}` }), h('div', { class: 'meta' },
      h('span', { text: p.designation || 'Faculty' }), h('span', { text: p.department || '' }), h('span', { text: `Emp no ${p.employee_no || '-'}` })))));
  if (open.length) {
    main.append(h('div', { class: 'notice warn' }, `You have ${open.length} attendance not submitted yet. `, h('a', { href: `#attendance/${open[0].open_session_id}`, text: 'Continue' })));
  }
  main.append(h('div', { class: 'stats' },
    statCard('students', 'My students', sum.students, `${assignments.length} subject(s)`),
    statCard('scan', 'Attendance taken', sum.sessions_month, 'last 30 days', 'ok'),
    statCard('calendar', 'Leave to review', sum.pending_leaves, null, sum.pending_leaves ? 'warn' : ''),
    statCard('clipboard', 'Submissions to grade', sum.to_grade, null, sum.to_grade ? 'warn' : '')));

  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('clock', `Today's classes (${DAYS[todayNo]})`),
      today.length ? h('div', { class: 'list' }, today.map((t) => h('div', { class: 'list-item' },
        h('div', { class: 'date-chip' }, h('strong', { text: t.start_time }), h('span', { text: t.end_time })),
        h('div', { class: 'grow' }, h('div', { class: 'title', text: `${t.subject_code} ${t.subject_name}` }), h('div', { class: 'small muted', text: `${t.class_name}${t.room ? ` · ${t.room}` : ''}` })),
        h('a', { class: 'btn sm primary', href: '#attendance', text: 'Attendance' }))))
        : h('div', { class: 'empty', text: 'No classes on your timetable today.' })),
    h('div', { class: 'card' }, cardTitle('chart', 'Attendance by subject'),
      bars(sum.subject_attendance.map((s) => ({ label: `${s.code} · ${s.class_name}`, value: s.present || 0, max: s.total || 0, text: s.total ? `${Math.round((s.present / s.total) * 100)}%` : '-' })), { pctKind: true }))));

  main.append(h('div', { class: 'card' }, cardTitle('book', 'My subjects', h('button', { class: 'primary', onclick: () => ctx.go('attendance') }, icon('scan', 16), 'Take attendance')), table([
    { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (a) => `${a.subject_code} ${a.subject_name}` },
    { label: 'Registered', key: 'registered', class: 'num' },
    { label: 'Face enrolled', class: 'num', render: (a) => h('span', { class: `badge ${a.enrolled < a.registered ? 'warn' : 'ok'}`, text: `${a.enrolled}/${a.registered}` }) },
    { label: 'Camera', render: (a) => (a.has_camera ? 'IP camera' : 'Laptop / USB') },
  ], assignments, 'No subjects assigned to you yet.')));
}

async function students(main) {
  const classes = await api('/api/teacher/classes');
  const box = h('div', { class: 'card' });
  const sel = selectEl(classes.map((c) => ({ value: c.id, label: c.name })), {
    placeholder: 'Choose a class',
    onchange: busy(async () => {
      if (!sel.value) return box.replaceChildren();
      box.replaceChildren(table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Phone', key: 'phone' },
        { label: 'Guardian', render: (s) => [s.guardian_name, s.guardian_phone].filter(Boolean).join(' · ') },
        { label: 'Face', render: (s) => h('span', { class: `badge ${s.face_samples ? 'ok' : 'warn'}`, text: s.face_samples ? 'Enrolled' : 'Not enrolled' }) },
      ], await api(`/api/teacher/classes/${sel.value}/students`), 'No students.'));
    }),
  });
  main.append(h('div', { class: 'row' }, h('strong', { text: 'Class' }), sel), h('br'), box);
}

async function marks(main) {
  const assignments = await api('/api/teacher/assignments');
  const editor = h('div', { class: 'card hidden' });
  const listCard = h('div', { class: 'card' });
  main.append(h('div', { class: 'card' }, h('h2', { text: 'New exam / test' }), buildForm([
    { name: 'pair', label: 'Class and subject', type: 'select', required: true, options: assignmentOptions(assignments) },
    { name: 'name', label: 'Exam name', required: true, placeholder: 'Mid-term 1' },
    { name: 'max_marks', label: 'Maximum marks', type: 'number', required: true, min: 1 },
    { name: 'exam_date', label: 'Date', type: 'date' },
  ], {
    submitLabel: 'Create',
    onSubmit: async (d, form) => {
      const [class_id, subject_id] = d.pair.split(':');
      const r = await api('/api/teacher/exams', { method: 'POST', body: { class_id, subject_id, name: d.name, max_marks: d.max_marks, exam_date: d.exam_date } });
      form.reset();
      toast('Exam created');
      await load();
      await openExam(r.id);
    },
  })), editor, listCard);

  async function openExam(id) {
    const d = await api(`/api/teacher/exams/${id}/marks`);
    const inputs = new Map();
    editor.replaceChildren(h('div', { class: 'between' }, h('h2', { text: `${d.exam.name} (out of ${d.exam.max_marks})` }),
      h('button', { class: 'sm', text: 'Close', onclick: () => editor.classList.add('hidden') })),
    table([
      { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
      {
        label: 'Marks', render: (s) => {
          const inp = h('input', { class: 'marks', type: 'number', min: 0, max: d.exam.max_marks, step: '0.5', value: s.marks ?? '', 'aria-label': `Marks for ${s.name}` });
          inputs.set(s.id, inp);
          return inp;
        },
      },
    ], d.students, 'No students.'),
    h('div', { class: 'form-actions' }, h('button', {
      class: 'primary', text: 'Save marks', onclick: busy(async () => {
        const list = [...inputs].map(([student_id, inp]) => ({ student_id, marks: inp.value === '' ? null : inp.value }));
        await api(`/api/teacher/exams/${id}/marks`, { method: 'PUT', body: { marks: list } });
        toast('Marks saved');
        await load();
      }),
    })));
    editor.classList.remove('hidden');
    editor.scrollIntoView({ behavior: 'smooth' });
  }

  async function load() {
    listCard.replaceChildren(h('h2', { text: 'Exams' }), table([
      { label: 'Date', render: (e) => fmtDate(e.exam_date) }, { label: 'Exam', key: 'name' }, { label: 'Class', key: 'class_name' },
      { label: 'Subject', key: 'subject_code' }, { label: 'Max', key: 'max_marks', class: 'num' }, { label: 'Entered', key: 'marked', class: 'num' },
      {
        label: '', class: 'actions', render: (e) => h('span', { class: 'row end' },
          h('button', { class: 'sm primary', text: 'Enter marks', onclick: busy(() => openExam(e.id)) }),
          h('button', {
            class: 'sm danger', text: 'Delete', onclick: busy(async () => {
              if (!await confirmBox(`Delete ${e.name} and all its marks?`, { ok: 'Delete', danger: true })) return;
              await api(`/api/teacher/exams/${e.id}`, { method: 'DELETE' });
              await load();
            }),
          })),
      },
    ], await api('/api/teacher/exams'), 'No exams yet.'));
  }
  await load();
}

async function reports(main) {
  const assignments = await api('/api/teacher/assignments');
  const box = h('div', { class: 'card' });
  const sel = selectEl(assignmentOptions(assignments), {
    placeholder: 'Choose class and subject',
    onchange: busy(async () => {
      if (!sel.value) return box.replaceChildren();
      const [classId, subjectId] = sel.value.split(':');
      const q = `classId=${classId}&subjectId=${subjectId}`;
      const r = await api(`/api/teacher/reports/attendance?${q}`);
      box.replaceChildren(h('div', { class: 'between' }, h('h2', { text: 'Attendance' }), h('a', { class: 'btn', href: `/api/teacher/reports/attendance?${q}&format=csv`, text: 'Download CSV' })),
        table([
          { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
          { label: 'Present', class: 'num', render: (s) => `${s.present} / ${s.total}` }, { label: '%', render: (s) => pctBadge(s.pct) },
        ], r.students, 'No students.'));
    }),
  });
  main.append(h('div', { class: 'row' }, sel), h('br'), box);
}

async function timetable(main) {
  main.append(h('div', { class: 'card' }, timetableView(await api('/api/timetable'), { showClass: true })));
}

const myPairs = async () => assignmentOptions(await api('/api/teacher/assignments'));

startApp('teacher', [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview', render: dashboard },
  { id: 'attendance', label: 'Take attendance', icon: 'scan', group: 'Attendance', render: attendanceView },
  { id: 'faces', label: 'Face enrolment', icon: 'camera', group: 'Attendance', render: enrollView('/api/teacher/classes') },
  { id: 'reports', label: 'Attendance report', icon: 'chart', group: 'Attendance', render: reports },
  { id: 'leave', label: 'Leave requests', icon: 'calendar', group: 'Attendance', render: leaveReview },
  { id: 'students', label: 'My students', icon: 'students', group: 'Academics', render: students },
  { id: 'homework', label: 'Assignments', icon: 'clipboard', group: 'Academics', render: homeworkTeacher },
  { id: 'marks', label: 'Class tests', icon: 'file', group: 'Academics', render: marks },
  { id: 'results', label: 'Internal marks', icon: 'award', group: 'Academics', render: async (main) => resultsSheet(main, await myPairs()) },
  { id: 'timetable', label: 'Timetable', icon: 'clock', group: 'Academics', render: timetable },
  { id: 'feedback', label: 'My feedback', icon: 'star', group: 'Communication', render: feedbackSummary },
  { id: 'notices', label: 'Notices', icon: 'bell', group: 'Communication', render: noticesView },
  { id: 'grievance', label: 'Grievance', icon: 'alert', group: 'Communication', render: myGrievances },
]).then((ctx) => {
  api('/api/teacher/summary').then((s) => ctx.setBadge('leave', s.pending_leaves)).catch(() => {});
});
