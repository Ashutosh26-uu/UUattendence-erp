import {
  h, api, toast, busy, confirmBox, showSecret, table, buildForm, selectEl, startApp, icon, statCard, cardTitle, bars, columns,
  DAYS, fmtDate, fmtDateTime, fmtTime, pctKind,
} from './common.js';

const opts = async (url, label) => (await api(url)).map((r) => ({ value: r.id, label: label(r) }));
const deptOptions = () => opts('/api/admin/departments', (d) => `${d.code} - ${d.name}`);
const classOptions = () => opts('/api/admin/classes', (c) => c.name);
const dayOptions = DAYS.slice(1).map((d, i) => ({ value: i + 1, label: d }));

// Generic list + add/edit form.
function crudView({ endpoint, cols, fields, intro, onCreated, rowActions, canDelete = true, toValues }) {
  return async (main) => {
    const fieldList = await fields();
    const formCard = h('div', { class: 'card hidden' });
    const listCard = h('div', { class: 'card' });
    main.querySelector('.page-head').append(h('button', { class: 'primary', onclick: () => openForm(null) }, icon('upload', 16), 'Add new'));
    if (intro) main.append(h('p', { class: 'muted', text: intro }));
    main.append(formCard, listCard);
    function openForm(row) {
      formCard.replaceChildren(h('h2', { text: row ? 'Edit' : 'Add new' }), buildForm(fieldList.filter((f) => !(row && f.createOnly)), {
        values: row ? (toValues ? toValues(row) : row) : {},
        submitLabel: row ? 'Save changes' : 'Add',
        onCancel: () => formCard.classList.add('hidden'),
        onSubmit: async (d) => {
          if (row) { await api(`${endpoint}/${row.id}`, { method: 'PUT', body: d }); toast('Saved', 'ok'); } else {
            const r = await api(endpoint, { method: 'POST', body: d });
            toast('Added', 'ok');
            if (onCreated) await onCreated(r, d);
          }
          formCard.classList.add('hidden');
          await load();
        },
      }));
      formCard.classList.remove('hidden');
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    async function load() {
      listCard.replaceChildren(table([...cols, {
        label: '', class: 'actions', render: (r) => h('span', { class: 'row end' }, h('button', { class: 'sm', text: 'Edit', onclick: () => openForm(r) }), rowActions?.(r, load),
          canDelete && h('button', { class: 'sm danger', text: 'Delete', onclick: busy(async () => { if (!await confirmBox('Delete this record?', { ok: 'Delete', danger: true })) return; await api(`${endpoint}/${r.id}`, { method: 'DELETE' }); toast('Deleted'); await load(); }) })),
      }], await api(endpoint)));
    }
    await load();
  };
}

function userActions(r, reload) {
  return [
    h('button', { class: 'sm', text: 'Reset password', onclick: busy(async () => {
      if (!await confirmBox(`Give ${r.name} a new one-time password?`, { ok: 'Reset' })) return;
      const out = await api(`/api/admin/users/${r.id}/reset-password`, { method: 'POST' });
      await showSecret('New password', `One-time password for ${r.username}:`, out.temp_password);
    }) }),
    h('button', { class: `sm ${r.active ? 'danger' : 'ok'}`, text: r.active ? 'Deactivate' : 'Activate', onclick: busy(async () => {
      if (!await confirmBox(r.active ? `Deactivate ${r.name}? They will be logged out and cannot log in.` : `Activate ${r.name}?`, { ok: r.active ? 'Deactivate' : 'Activate', danger: !!r.active })) return;
      await api(`/api/admin/users/${r.id}/active`, { method: 'POST', body: { active: !r.active } });
      await reload();
    }) }),
  ];
}
const activeBadge = (r) => h('span', { class: `badge ${r.active ? 'ok' : 'bad'}`, text: r.active ? 'Active' : 'Inactive' });

// ---- Dashboard ----
async function dashboard(main) {
  const s = await api('/api/admin/stats');
  const t = s.today;
  main.append(h('div', { class: 'stats' },
    statCard('students', 'Students', s.students.toLocaleString('en-IN'), `${s.enrolled.toLocaleString('en-IN')} face enrolled`),
    statCard('teacher', 'Faculty', s.teachers, `${s.lectures} lectures / week`),
    statCard('building', 'Classes', s.classes, `${s.rooms} rooms · ${s.cameras} cameras`),
    statCard('checkbox', 'Attendance today', t.saved, `${t.live} in progress · ${t.queued} queued`, 'ok'),
    statCard('usercheck', 'Present today', t.registered ? `${Math.round((t.present / t.registered) * 100)}%` : '-', `${t.present} of ${t.registered}`, 'red')));
  if (s.enrolled < s.students) main.append(h('div', { class: 'notice warn' }, `${s.students - s.enrolled} students have no face photo yet, so the camera cannot recognise them. `, h('a', { href: '#faces', text: 'Enrol faces' })));
  main.append(h('div', { class: 'grid-2-1' },
    h('div', { class: 'card' }, cardTitle('chart', 'Daily attendance %'), columns(s.trend.map((d) => ({ label: fmtDate(d.date).slice(0, 6), value: d.registered ? Math.round((d.present / d.registered) * 100) : 0 })))),
    h('div', { class: 'card' }, cardTitle('building', 'Class-wise attendance'), bars(s.class_attendance.map((c) => ({ label: c.name, value: c.present, max: c.registered }))))));
}

// ---- Master data ----
const departments = crudView({
  endpoint: '/api/admin/departments',
  fields: async () => [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }],
  cols: [{ label: 'Code', key: 'code' }, { label: 'Department', key: 'name' }],
});

const classes = crudView({
  endpoint: '/api/admin/classes',
  fields: async () => [
    { name: 'name', label: 'Class name', required: true, placeholder: 'BCA Sem 3 - A' },
    { name: 'department_id', label: 'Department', type: 'select', required: true, options: await deptOptions() },
    { name: 'program', label: 'Program', placeholder: 'BCA' }, { name: 'semester', label: 'Semester', type: 'number', min: 1, max: 12 },
    { name: 'section', label: 'Section' }, { name: 'academic_year', label: 'Academic year', placeholder: '2026-27' },
  ],
  cols: [{ label: 'Class', key: 'name' }, { label: 'Department', key: 'department_name' }, { label: 'Program', key: 'program' }, { label: 'Sem', key: 'semester' },
    { label: 'Students', class: 'num', key: 'students' },
    { label: 'Face enrolled', render: (c) => h('span', { class: `badge ${c.enrolled >= c.students && c.students ? 'ok' : 'warn'}`, text: `${c.enrolled} / ${c.students}` }) }],
});

const rooms = crudView({
  endpoint: '/api/admin/rooms',
  intro: 'Camera URL = the JPEG snapshot address of the IP camera in the room, e.g. http://user:pass@10.0.5.21/cgi-bin/snapshot.cgi. The server fetches it, so the camera password never reaches teachers. Leave empty if the room uses a laptop / USB camera.',
  fields: async () => [{ name: 'name', label: 'Room', required: true, placeholder: 'LT-101' }, { name: 'building', label: 'Building' },
    { name: 'capacity', label: 'Capacity', type: 'number', min: 1 }, { name: 'camera_url', label: 'Camera snapshot URL', full: true }],
  cols: [{ label: 'Room', key: 'name' }, { label: 'Building', key: 'building' }, { label: 'Capacity', class: 'num', key: 'capacity' },
    { label: 'Camera', render: (r) => h('span', { class: `badge ${r.camera_url ? 'ok' : ''}`, text: r.camera_url ? 'IP camera' : 'None' }) }],
});

const subjects = crudView({
  endpoint: '/api/admin/subjects',
  fields: async () => [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Subject', required: true }, { name: 'department_id', label: 'Department', type: 'select', options: await deptOptions() }],
  cols: [{ label: 'Code', key: 'code' }, { label: 'Subject', key: 'name' }, { label: 'Department', key: 'department_name' }],
});

const faculty = crudView({
  endpoint: '/api/admin/teachers',
  canDelete: false,
  fields: async () => [
    { name: 'name', label: 'Full name', required: true }, { name: 'employee_no', label: 'Employee ID', required: true, hint: 'Teachers can log in with this' },
    { name: 'username', label: 'Username', required: true }, { name: 'password', label: 'Password', type: 'password', createOnly: true, hint: 'Leave empty to generate a one-time password' },
    { name: 'department_id', label: 'Department', type: 'select', options: await deptOptions() }, { name: 'designation', label: 'Designation' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' },
  ],
  onCreated: (r, d) => showSecret('Teacher account created', `Login for ${d.employee_no} / ${d.username}:`, r.temp_password),
  rowActions: userActions,
  cols: [{ label: 'Name', key: 'name' }, { label: 'Employee ID', key: 'employee_no' }, { label: 'Department', key: 'department_name' }, { label: 'Designation', key: 'designation' },
    { label: 'Lectures/week', class: 'num', key: 'lectures' }, { label: 'Status', render: activeBadge }],
});

// ---- Students: paginated, search, CSV import ----
async function students(main) {
  const classOpts = await classOptions();
  let page = 1;
  const classSel = selectEl(classOpts, { placeholder: 'All classes', onchange: () => { page = 1; load(); } });
  const q = h('input', { type: 'search', placeholder: 'Search name or roll no', 'aria-label': 'Search students' });
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 300); });
  const formCard = h('div', { class: 'card hidden' });
  const importCard = h('div', { class: 'card hidden' });
  const listCard = h('div', { class: 'card' });
  main.querySelector('.page-head').append(h('div', { class: 'row' },
    h('button', { onclick: () => { importCard.classList.toggle('hidden'); } }, icon('upload', 16), 'Import CSV'),
    h('button', { class: 'primary', onclick: () => openForm(null) }, 'Add student')));
  main.append(importCard, formCard, h('div', { class: 'row' }, classSel, q), h('br'), listCard);

  const fields = [
    { name: 'roll_no', label: 'Roll no / enrolment no', required: true }, { name: 'name', label: 'Full name', required: true },
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpts },
    { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'guardian_phone', label: 'Guardian phone' },
  ];
  function openForm(row) {
    formCard.replaceChildren(h('h2', { text: row ? 'Edit student' : 'Add student' }), buildForm(row ? [...fields, { name: 'active', label: 'Status', type: 'select', required: true, options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Left / inactive' }] }] : fields, {
      values: row ? { ...row, active: String(row.active) } : { class_id: classSel.value },
      submitLabel: row ? 'Save' : 'Add',
      onCancel: () => formCard.classList.add('hidden'),
      onSubmit: async (d) => {
        if (row) await api(`/api/admin/students/${row.id}`, { method: 'PUT', body: d }); else await api('/api/admin/students', { method: 'POST', body: d });
        toast('Saved', 'ok');
        formCard.classList.add('hidden');
        await load();
      },
    }));
    formCard.classList.remove('hidden');
  }

  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file' });
  const out = h('div');
  importCard.append(cardTitle('upload', 'Import students from CSV'),
    h('p', { class: 'muted small', text: 'Columns (first row = headings): roll_no, name, class, phone, email, guardian_phone. "class" is the class name exactly as on the Classes page. Thousands of rows are fine.' }),
    h('div', { class: 'row' }, file, h('button', { class: 'primary', onclick: busy(async () => {
      const f = file.files[0];
      if (!f) throw new Error('Choose a CSV file');
      const rows = parseCsv(await f.text());
      if (!rows.length) throw new Error('No rows found');
      let added = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await api('/api/admin/students/import', { method: 'POST', body: { rows: rows.slice(i, i + 1000) } });
        added += r.added;
        errors.push(...r.errors.map((e) => ({ ...e, line: e.line ? e.line + i + 1 : '' })));
      }
      out.replaceChildren(h('div', { class: `notice ${errors.length ? 'warn' : 'ok'}`, text: `Added ${added} of ${rows.length} students.${errors.length ? ` ${errors.length} skipped:` : ''}` }),
        errors.length ? table([{ label: 'Line', key: 'line' }, { label: 'Roll no', key: 'roll_no' }, { label: 'Problem', key: 'error' }], errors.slice(0, 200)) : null);
      await load();
    }) }, 'Import')), out);

  async function load() {
    const p = new URLSearchParams({ page });
    if (classSel.value) p.set('classId', classSel.value);
    if (q.value.trim()) p.set('q', q.value.trim());
    const d = await api(`/api/admin/students?${p}`);
    listCard.replaceChildren(h('div', { class: 'muted small', text: `${d.total.toLocaleString('en-IN')} students` }), table([
      { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Class', key: 'class_name' }, { label: 'Phone', key: 'phone' },
      { label: 'Face', render: (s) => h('span', { class: `badge ${s.faces ? 'ok' : 'warn'}`, text: s.faces ? `${s.faces} photo(s)` : 'Not enrolled' }) },
      { label: 'Status', render: (s) => h('span', { class: `badge ${s.active ? 'ok' : 'bad'}`, text: s.active ? 'Active' : 'Inactive' }) },
      { label: '', class: 'actions', render: (s) => h('button', { class: 'sm', text: 'Edit', onclick: () => openForm(s) }) },
    ], d.rows, 'No students found.'),
    h('div', { class: 'pager' }, h('span', { class: 'small muted', text: `Page ${d.page} of ${d.pages}` }),
      h('button', { class: 'sm', text: 'Previous', disabled: d.page <= 1, onclick: () => { page--; load(); } }),
      h('button', { class: 'sm', text: 'Next', disabled: d.page >= d.pages, onclick: () => { page++; load(); } })));
  }
  await load();
}

function parseCsv(text) {
  const lines = [];
  let row = [''];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { row[row.length - 1] += '"'; i++; } else if (ch === '"') quoted = false; else row[row.length - 1] += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push('');
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; lines.push(row); row = ['']; } else row[row.length - 1] += ch;
  }
  lines.push(row);
  const clean = lines.filter((r) => r.some((c) => c.trim()));
  if (!clean.length) return [];
  const head = clean[0].map((c) => c.trim().toLowerCase().replace(/^﻿/, '').replace(/\s+/g, '_'));
  return clean.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] || '').trim()])));
}

// ---- Timetable (lecture allotment) ----
async function timetable(main) {
  const [teachers, classOpts, subjects, rooms] = await Promise.all([
    opts('/api/admin/teachers', (t) => `${t.name} (${t.employee_no})`), classOptions(),
    opts('/api/admin/subjects', (s) => `${s.code} - ${s.name}`), opts('/api/admin/rooms', (r) => `${r.name}${r.camera_url ? ' (camera)' : ''}`)]);
  const formCard = h('div', { class: 'card hidden' });
  const listCard = h('div', { class: 'card' });
  const classSel = selectEl(classOpts, { placeholder: 'All classes', onchange: () => load() });
  const teacherSel = selectEl(teachers, { placeholder: 'All teachers', onchange: () => load() });
  main.querySelector('.page-head').append(h('button', { class: 'primary', onclick: () => openForm(null) }, 'Allot lecture'));
  main.append(h('p', { class: 'muted', text: 'Teachers see these lectures on their dashboard and start attendance from them. Clashes (same teacher, class or room at the same time) are refused.' }),
    formCard, h('div', { class: 'row' }, classSel, teacherSel), h('br'), listCard);
  function openForm(row) {
    formCard.replaceChildren(h('h2', { text: row ? 'Edit lecture' : 'Allot a lecture' }), buildForm([
      { name: 'teacher_id', label: 'Teacher', type: 'select', required: true, options: teachers },
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpts },
      { name: 'subject_id', label: 'Subject', type: 'select', required: true, options: subjects },
      { name: 'room_id', label: 'Room', type: 'select', options: rooms },
      { name: 'day', label: 'Day', type: 'select', required: true, options: dayOptions },
      { name: 'start_time', label: 'Start', type: 'time', required: true }, { name: 'end_time', label: 'End', type: 'time', required: true },
    ], {
      values: row || { class_id: classSel.value, teacher_id: teacherSel.value },
      submitLabel: row ? 'Save' : 'Allot',
      onCancel: () => formCard.classList.add('hidden'),
      onSubmit: async (d) => {
        if (row) await api(`/api/admin/lectures/${row.id}`, { method: 'PUT', body: d }); else await api('/api/admin/lectures', { method: 'POST', body: d });
        toast('Saved', 'ok');
        formCard.classList.add('hidden');
        await load();
      },
    }));
    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth' });
  }
  async function load() {
    const p = new URLSearchParams();
    if (classSel.value) p.set('classId', classSel.value);
    if (teacherSel.value) p.set('teacherId', teacherSel.value);
    listCard.replaceChildren(table([
      { label: 'Day', render: (l) => h('strong', { text: DAYS[l.day] }) }, { label: 'Time', render: (l) => `${l.start_time} - ${l.end_time}` },
      { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (l) => `${l.subject_code} ${l.subject_name}` }, { label: 'Teacher', key: 'teacher_name' }, { label: 'Room', key: 'room_name' },
      { label: '', class: 'actions', render: (l) => h('span', { class: 'row end' }, h('button', { class: 'sm', text: 'Edit', onclick: () => openForm(l) }),
        h('button', { class: 'sm danger', text: 'Delete', onclick: busy(async () => { if (!await confirmBox('Delete this lecture?', { ok: 'Delete', danger: true })) return; await api(`/api/admin/lectures/${l.id}`, { method: 'DELETE' }); await load(); }) })) },
    ], await api(`/api/admin/lectures?${p}`), 'No lectures allotted yet.'));
  }
  await load();
}

// ---- Face enrolment ----
async function faces(main, ctx) {
  const cam = await import('./camera.js');
  const classOpts = await classOptions();
  const classSel = selectEl(classOpts, { placeholder: 'Choose a class', onchange: () => loadClass() });
  const listCard = h('div', { class: 'card' });
  const bulkOut = h('div');
  const bar = h('div');
  const progress = h('div', { class: 'progress hidden' }, bar);
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Student photos' });

  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('upload', 'Bulk upload (fastest for a whole batch)'),
      h('p', { class: 'muted small', text: 'Select many photos at once. Name every file with the student\'s roll number, e.g. BCA3A01.jpg. One clear front-facing face per photo. Detection runs in this browser.' }),
      h('div', { class: 'row' }, files, h('button', { class: 'primary', onclick: busy(bulk) }, 'Enrol photos')), progress, bulkOut),
    h('div', { class: 'card' }, cardTitle('camera', 'Capture with a camera'),
      h('p', { class: 'muted small', text: 'Choose a class below, then capture a group photo or one student; pick the name under each face.' }),
      h('div', { id: 'capture' }, h('div', { class: 'empty', text: 'Choose a class first.' })))),
  h('div', { class: 'row' }, h('strong', { text: 'Class' }), classSel), h('br'), listCard);

  async function bulk() {
    const list = [...files.files];
    if (!list.length) throw new Error('Choose photos first');
    progress.classList.remove('hidden');
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const roll = f.name.replace(/\.[^.]+$/, '').trim();
      try {
        const canvas = await cam.fileToCanvas(f);
        const found = await cam.detectFaces(canvas, ctx.me.min_face_confidence);
        if (!found.length) throw new Error('No face found');
        const face = found.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
        await api('/api/admin/faces/by-roll', { method: 'POST', body: { roll_no: roll, descriptor: face.descriptor, photo: cam.cropFace(canvas, face.box) } });
        results.push({ roll, ok: true, note: found.length > 1 ? `Saved the largest of ${found.length} faces` : 'Saved' });
      } catch (err) { results.push({ roll, ok: false, note: err.message }); }
      bar.style.width = `${((i + 1) / list.length) * 100}%`;
    }
    const good = results.filter((r) => r.ok).length;
    bulkOut.replaceChildren(h('div', { class: `notice ${good === results.length ? 'ok' : 'warn'}`, text: `Enrolled ${good} of ${results.length} photos.` }),
      table([{ label: 'Roll no', key: 'roll' }, { label: 'Result', render: (r) => h('span', { class: `badge ${r.ok ? 'ok' : 'bad'}`, text: r.note }) }], results.filter((r) => !r.ok).concat(results.filter((r) => r.ok)).slice(0, 300)));
    if (classSel.value) await loadClass();
  }

  let panel = null;
  ctx.cleanup = () => panel?.stop();
  async function loadClass() {
    panel?.stop();
    const box = main.querySelector('#capture');
    if (!classSel.value) { box.replaceChildren(h('div', { class: 'empty', text: 'Choose a class first.' })); listCard.replaceChildren(); return; }
    let roster = await api(`/api/admin/faces/class/${classSel.value}`);
    panel = cam.cameraPanel({ allowUpload: true });
    const faceGrid = h('div', { class: 'face-grid' });
    box.replaceChildren(panel.el, h('br'), h('button', { class: 'red', onclick: busy(async () => {
      const frame = await panel.grab();
      const found = await cam.detectFaces(frame, ctx.me.min_face_confidence);
      panel.setStatus(found.length ? `Found ${found.length} face(s). Choose the name under each and save.` : 'No face found. Move closer or improve the light.');
      faceGrid.replaceChildren(...found.map((f) => {
        const photo = cam.cropFace(frame, f.box);
        const sel = selectEl(roster.map((s) => ({ value: s.id, label: `${s.roll_no} - ${s.name}${s.samples.length ? ` (${s.samples.length})` : ''}` })), { placeholder: 'Who is this?' });
        const card = h('div', { class: 'face-card' }, h('img', { src: photo, alt: '' }), sel);
        card.append(h('button', { class: 'primary sm', text: 'Save', onclick: busy(async (e) => {
          if (!sel.value) throw new Error('Choose the student');
          const body = { descriptor: f.descriptor, photo };
          try { await api(`/api/admin/faces/student/${sel.value}`, { method: 'POST', body }); } catch (err) {
            if (err.status !== 409 || !await confirmBox(`${err.message}\n\nSave anyway?`, { ok: 'Save anyway', danger: true })) throw err.status === 409 ? new Error('Not saved') : err;
            await api(`/api/admin/faces/student/${sel.value}`, { method: 'POST', body: { ...body, force: true } });
          }
          card.classList.add('saved');
          e.target.replaceWith(h('span', { class: 'badge ok', text: 'Saved' }));
          roster = await api(`/api/admin/faces/class/${classSel.value}`);
          renderRoster();
        }) }));
        return card;
      }));
    }) }, icon('camera', 16), 'Capture and find faces'), h('br'), h('br'), faceGrid);
    function renderRoster() {
      const done = roster.filter((s) => s.samples.length).length;
      listCard.replaceChildren(cardTitle('users', `Enrolled ${done} of ${roster.length}`), table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
        { label: 'Photos', render: (s) => (s.samples.length ? h('div', { class: 'thumbs' }, s.samples.map((p) => h('div', { class: 'thumb' }, h('img', { src: p.photo || '', alt: '' }),
          h('button', { class: 'danger', text: 'x', 'aria-label': `Delete photo of ${s.name}`, onclick: busy(async () => { if (!await confirmBox(`Delete this photo of ${s.name}?`, { ok: 'Delete', danger: true })) return; await api(`/api/admin/faces/${p.id}`, { method: 'DELETE' }); roster = await api(`/api/admin/faces/class/${classSel.value}`); renderRoster(); }) }))))
          : h('span', { class: 'badge warn', text: 'Not enrolled' })) },
      ], roster, 'No students in this class.'));
    }
    renderRoster();
  }
}

// ---- Attendance records ----
async function records(main) {
  const classSel = selectEl(await classOptions(), { placeholder: 'All classes', onchange: () => load() });
  const dateIn = h('input', { type: 'date', 'aria-label': 'Date' });
  dateIn.addEventListener('change', () => load());
  const detail = h('div', { class: 'card hidden' });
  const listCard = h('div', { class: 'card' });
  main.append(h('div', { class: 'row' }, classSel, dateIn), h('br'), detail, listCard);
  const sBadge = (s) => h('span', { class: `badge ${{ saved: 'ok', queued: 'navy', scanning: 'red', review: 'warn' }[s] || ''}`, text: s });
  async function open(id) {
    const d = await api(`/api/admin/sessions/${id}`);
    const s = d.session;
    detail.replaceChildren(cardTitle('checkbox', `${s.class_name} · ${s.subject_code} · ${fmtDate(s.date)}`, h('button', { class: 'sm', text: 'Close', onclick: () => detail.classList.add('hidden') })),
      h('p', { class: 'muted', text: `Teacher ${s.teacher_name} · registered ${s.registered_count} · camera count ${s.max_faces} · recognised ${s.recognised_count} · present ${s.present_count ?? '-'}` }),
      table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
        { label: 'Status', render: (r) => h('span', { class: `badge ${r.status === 'P' ? 'ok' : 'bad'}`, text: r.status === 'P' ? 'Present' : 'Absent' }) },
        { label: 'Marked by', render: (r) => ({ camera: `Camera (${Math.round((r.confidence || 0) * 100)}%)`, manual: 'Hand', auto: 'Not seen' }[r.source]) },
        { label: 'Correct', class: 'actions', render: (r) => h('button', { class: 'sm', text: r.status === 'P' ? 'Make absent' : 'Make present', onclick: busy(async () => {
          const to = r.status === 'P' ? 'A' : 'P';
          if (!await confirmBox(`Change ${r.name} to ${to === 'P' ? 'present' : 'absent'}? This is written to the audit log.`, { ok: 'Change' })) return;
          await api(`/api/admin/sessions/${id}/records/${r.student_id}`, { method: 'PUT', body: { status: to } });
          await open(id);
          await load();
        }) }) },
      ], d.records, s.status === 'saved' ? 'No records.' : `Not saved yet (status: ${s.status}).`));
    detail.classList.remove('hidden');
    detail.scrollIntoView({ behavior: 'smooth' });
  }
  async function load() {
    const p = new URLSearchParams();
    if (classSel.value) p.set('classId', classSel.value);
    if (dateIn.value) p.set('date', dateIn.value);
    listCard.replaceChildren(table([
      { label: 'Date', render: (s) => fmtDate(s.date) }, { label: 'Started', render: (s) => fmtTime(s.started_at) }, { label: 'Class', key: 'class_name' },
      { label: 'Subject', key: 'subject_code' }, { label: 'Teacher', key: 'teacher_name' }, { label: 'Room', key: 'room_name' },
      { label: 'Registered', class: 'num', key: 'registered_count' }, { label: 'Camera count', class: 'num', key: 'max_faces' },
      { label: 'Present', class: 'num', render: (s) => s.present_count ?? '-' }, { label: 'Status', render: (s) => sBadge(s.status) },
      { label: '', class: 'actions', render: (s) => h('button', { class: 'sm', text: 'View', onclick: busy(() => open(s.id)) }) },
    ], await api(`/api/admin/sessions?${p}`), 'No attendance found.'));
  }
  await load();
}

async function reports(main) {
  const box = h('div');
  const classSel = selectEl(await classOptions(), { placeholder: 'Choose a class', onchange: () => load() });
  const from = h('input', { type: 'date', 'aria-label': 'From' });
  const to = h('input', { type: 'date', 'aria-label': 'To' });
  from.addEventListener('change', () => load());
  to.addEventListener('change', () => load());
  main.append(h('div', { class: 'row' }, classSel, h('span', { class: 'muted', text: 'From' }), from, h('span', { class: 'muted', text: 'To' }), to), h('br'), box);
  async function load() {
    if (!classSel.value) return box.replaceChildren(h('div', { class: 'card empty', text: 'Choose a class.' }));
    const p = new URLSearchParams();
    if (from.value) p.set('from', from.value);
    if (to.value) p.set('to', to.value);
    const d = await api(`/api/admin/reports/class/${classSel.value}?${p}`);
    const low = d.students.filter((s) => s.pct != null && s.pct < 75);
    box.replaceChildren(h('div', { class: 'card' }, cardTitle('chart', `${d.class.name} attendance`, h('a', { class: 'btn', href: `/api/admin/reports/class/${classSel.value}?${p}&format=csv` }, icon('download', 16), 'Download CSV')),
      low.length ? h('div', { class: 'notice warn', text: `${low.length} student(s) below 75% attendance.` }) : null,
      table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Present', class: 'num', render: (s) => `${s.present} / ${s.total}` },
        { label: '%', render: (s) => h('span', { class: `badge ${({ ok: 'ok', warn: 'warn', bad: 'bad' })[pctKind(s.pct)] || ''}`, text: s.pct == null ? '-' : `${s.pct}%` }) },
      ], d.students, 'No students.')));
  }
  await load();
}

// ---- Super admin ----
async function monitor(main, ctx) {
  const box = h('div');
  main.querySelector('.page-head').append(h('button', { class: 'primary', onclick: busy(async () => { await api('/api/super/queue/drain', { method: 'POST' }); toast('Queue processed', 'ok'); await load(); }) }, icon('queue', 16), 'Save queued attendance now'));
  main.append(h('p', { class: 'muted', text: 'Refreshes every 5 seconds. When more than the threshold of attendance submissions arrive in one minute, new ones are queued and saved when traffic drops (the gap between lectures); anything waiting longer than the deadline is saved anyway.' }), box);
  async function load() {
    const m = await api('/api/super/monitor');
    const q = m.queue;
    const peak = q.traffic_per_minute > q.threshold;
    box.replaceChildren(
      h('div', { class: 'stats' },
        statCard('activity', 'Submissions / minute', q.traffic_per_minute, `queue starts above ${q.threshold}`, peak ? 'red' : 'ok'),
        statCard('queue', 'Waiting in queue', q.pending, q.oldest_seconds ? `oldest ${Math.round(q.oldest_seconds / 60)} min` : 'empty', q.pending ? 'warn' : 'ok'),
        statCard('scan', 'Live scans', m.today.scanning, `${m.live_scans_in_memory} in memory`, 'red'),
        statCard('checkbox', 'Saved today', m.today.saved, `${m.today.review} waiting for teacher`, 'ok')),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, cardTitle('queue', 'Write path'), h('dl', { class: 'kv' },
          h('dt', { text: 'Mode now' }), h('dd', { text: peak ? 'Peak: new submissions are queued' : 'Normal: saved directly' }),
          h('dt', { text: 'Saved directly' }), h('dd', { text: q.direct }), h('dt', { text: 'Queued' }), h('dd', { text: q.queued }),
          h('dt', { text: 'Saved from queue' }), h('dd', { text: q.drained }), h('dt', { text: 'Failed (retrying)' }), h('dd', { text: q.failed }),
          h('dt', { text: 'Last queue run' }), h('dd', { text: q.lastDrainAt ? fmtDateTime(q.lastDrainAt) : '-' }))),
        h('div', { class: 'card' }, cardTitle('settings', 'System'), h('dl', { class: 'kv' },
          h('dt', { text: 'Database' }), h('dd', { text: m.database }), h('dt', { text: 'Users' }), h('dd', { text: m.totals.users }),
          h('dt', { text: 'Students' }), h('dd', { text: m.totals.students.toLocaleString('en-IN') }), h('dt', { text: 'Attendance records' }), h('dd', { text: m.totals.records.toLocaleString('en-IN') }),
          h('dt', { text: 'Server memory' }), h('dd', { text: `${m.server.memory_mb} MB` }), h('dt', { text: 'Uptime' }), h('dd', { text: `${m.server.uptime_minutes} min` })))));
  }
  await load();
  const t = setInterval(() => load().catch(() => {}), 5000);
  ctx.cleanup = () => clearInterval(t);
}

const admins = crudView({
  endpoint: '/api/super/admins',
  canDelete: false,
  fields: async () => [{ name: 'name', label: 'Full name', required: true }, { name: 'username', label: 'Username', required: true, createOnly: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }],
  onCreated: (r, d) => showSecret('Admin account created', `Login for ${d.username}:`, r.temp_password),
  rowActions: userActions,
  cols: [{ label: 'Name', key: 'name' }, { label: 'Username', key: 'username' }, { label: 'Email', key: 'email' }, { label: 'Status', render: activeBadge }],
});

async function settings(main) {
  const s = await api('/api/super/settings');
  main.append(h('div', { class: 'card' }, buildForm([
    { name: 'university_name', label: 'University name', required: true, full: true },
    { name: 'scan_minutes', label: 'Camera scan duration (minutes)', type: 'number', min: 1, max: 15, required: true, hint: 'How long the camera looks for students after the teacher presses Start' },
    { name: 'frame_interval_seconds', label: 'Seconds between camera captures', type: 'number', min: 1, max: 30, required: true },
    { name: 'match_threshold', label: 'Face match strictness (0.30 - 0.70)', type: 'number', step: '0.01', min: 0.3, max: 0.7, required: true, hint: 'Lower = stricter. 0.50 is a good start; 0.45 if look-alikes get mixed up' },
    { name: 'min_face_confidence', label: 'Face detection confidence (0.20 - 0.95)', type: 'number', step: '0.05', min: 0.2, max: 0.95, required: true, hint: 'Lower finds more back-row faces' },
    { name: 'queue_threshold', label: 'Queue above this many submissions per minute', type: 'number', min: 1, required: true },
    { name: 'queue_deadline_minutes', label: 'Queue deadline (minutes)', type: 'number', min: 1, max: 55, required: true, hint: 'Queued attendance older than this is saved even during peak' },
  ], { values: s, submitLabel: 'Save settings', onSubmit: async (d) => { await api('/api/super/settings', { method: 'PUT', body: d }); toast('Settings saved', 'ok'); } })));
}

async function auditLog(main) {
  main.append(h('div', { class: 'card' }, table([
    { label: 'When', render: (a) => fmtDateTime(a.at) }, { label: 'Who', render: (a) => (a.user_name ? `${a.user_name} (${a.role})` : '-') }, { label: 'Action', key: 'action' },
    { label: 'Detail', render: (a) => h('span', { class: 'small muted', text: a.detail ? JSON.stringify(a.detail).slice(0, 140) : '' }) },
  ], await api('/api/super/audit'))));
}

const views = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview', render: dashboard },
  { id: 'students', label: 'Students', icon: 'students', group: 'People', render: students },
  { id: 'faculty', label: 'Faculty', icon: 'teacher', group: 'People', render: faculty },
  { id: 'faces', label: 'Face enrolment', icon: 'scan', group: 'People', render: faces },
  { id: 'timetable', label: 'Lecture allotment', icon: 'calendar', group: 'Academics', render: timetable },
  { id: 'classes', label: 'Classes', icon: 'layers', group: 'Academics', render: classes },
  { id: 'subjects', label: 'Subjects', icon: 'book', group: 'Academics', render: subjects },
  { id: 'rooms', label: 'Rooms and cameras', icon: 'door', group: 'Academics', render: rooms },
  { id: 'departments', label: 'Departments', icon: 'building', group: 'Academics', render: departments },
  { id: 'records', label: 'Attendance records', icon: 'checkbox', group: 'Attendance', render: records },
  { id: 'reports', label: 'Reports', icon: 'chart', group: 'Attendance', render: reports },
];
const superViews = [
  { id: 'monitor', label: 'Live monitor', icon: 'activity', group: 'Super admin', render: monitor },
  { id: 'admins', label: 'Admins', icon: 'shield', group: 'Super admin', render: admins },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Super admin', render: settings },
  { id: 'audit', label: 'Audit log', icon: 'log', group: 'Super admin', render: auditLog },
];

const me = await api('/api/me').catch(() => null);
startApp(['admin', 'super_admin'], me?.role === 'super_admin' ? [...views, ...superViews] : views);
