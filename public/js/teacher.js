import { h, api, toast, busy, confirmBox, table, buildForm, selectEl, startApp, fmtDate, pctBadge, timetableView, noticesView, DAYS } from './common.js';
import { attendanceView } from './attendance.js';
import { enrollView } from './enroll.js';

const assignmentOptions = (list) => list.map((a) => ({ value: `${a.class_id}:${a.subject_id}`, label: `${a.class_name} - ${a.subject_code} ${a.subject_name}` }));

async function dashboard(main, ctx) {
  const [assignments, tt] = await Promise.all([api('/api/teacher/assignments'), api('/api/timetable')]);
  const jsDay = new Date().getDay();
  const todayNo = jsDay === 0 ? 7 : jsDay;
  const today = tt.filter((t) => t.day === todayNo);
  const open = assignments.filter((a) => a.open_session_id);
  if (open.length) {
    main.append(h('div', { class: 'notice warn' }, `You have ${open.length} attendance not submitted yet. `,
      h('a', { href: `#attendance/${open[0].open_session_id}`, text: 'Continue' })));
  }
  main.append(h('div', { class: 'card' }, h('h2', { text: `Today (${DAYS[todayNo]})` }), table([
    { label: 'Time', render: (t) => `${t.start_time} - ${t.end_time}` }, { label: 'Class', key: 'class_name' },
    { label: 'Subject', render: (t) => `${t.subject_code} ${t.subject_name}` }, { label: 'Room', key: 'room' },
  ], today, 'No classes on your timetable today.')));
  main.append(h('div', { class: 'card' }, h('div', { class: 'between' }, h('h2', { text: 'My subjects' }),
    h('button', { class: 'primary', text: 'Take attendance', onclick: () => ctx.go('attendance') })), table([
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

startApp('teacher', [
  { id: 'dashboard', label: 'Dashboard', render: dashboard },
  { id: 'attendance', label: 'Take attendance', render: attendanceView },
  { id: 'faces', label: 'Face enrolment', render: enrollView('/api/teacher/classes') },
  { id: 'students', label: 'My students', render: students },
  { id: 'marks', label: 'Exams and marks', render: marks },
  { id: 'reports', label: 'Attendance report', render: reports },
  { id: 'timetable', label: 'Timetable', render: timetable },
  { id: 'notices', label: 'Notices', render: noticesView },
]);
