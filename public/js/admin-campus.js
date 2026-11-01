// Admin screens for examination results and campus services.
import {
  h, api, toast, busy, confirmBox, modal, table, buildForm, selectEl, crudView, fmtDate, money,
  statCard, cardTitle, printButton,
} from './common.js';
import { idCard, gradeCard, statusBadge } from './modules.js';

const options = async (url, label) => (await api(url)).map((r) => ({ value: r.id, label: label(r) }));
const classOptions = () => options('/api/admin/classes', (c) => c.name);
const studentOptions = () => options('/api/admin/students', (s) => `${s.roll_no} - ${s.name} (${s.class_name})`);

// ---- Results: class result sheet, publish, grade cards ----
export async function resultsAdmin(main, ctx) {
  const classes = await api('/api/admin/classes');
  const box = h('div');
  const classSel = selectEl(classes.map((c) => ({ value: c.id, label: c.name })), { placeholder: 'Choose a class', onchange: () => { semInput.value = ''; load(); } });
  const semInput = h('input', { type: 'number', min: 1, max: 12, placeholder: 'Semester', 'aria-label': 'Semester' });
  semInput.addEventListener('change', () => load());
  main.append(h('div', { class: 'card row no-print' }, h('strong', { text: 'Class' }), classSel, h('strong', { text: 'Semester' }), semInput,
    h('a', { class: 'btn', href: '#marks-entry', text: 'Enter marks' })), box);

  async function showCard(st) {
    const d = await api(`/api/results/student/${st.id}`);
    box.replaceChildren(h('div', { class: 'row no-print' }, h('button', { text: 'Back to class result', onclick: () => load() }), printButton('Print grade card')), h('br'), gradeCard(d, d.student, ctx.me));
  }

  async function load() {
    if (!classSel.value) return box.replaceChildren();
    const d = await api(`/api/results/class?classId=${classSel.value}${semInput.value ? `&semester=${semInput.value}` : ''}`);
    semInput.value = d.semester;
    const done = d.students.filter((s) => s.sgpa != null);
    const pass = done.filter((s) => !s.backlogs).length;
    const avg = done.length ? (done.reduce((a, s) => a + s.sgpa, 0) / done.length).toFixed(2) : null;
    box.replaceChildren(
      h('div', { class: 'stats' },
        statCard('students', 'Students', d.students.length),
        statCard('check', 'Result complete', done.length, `${d.students.length - done.length} pending marks`),
        statCard('award', 'Pass', done.length ? `${Math.round((pass / done.length) * 100)}%` : '-', `${pass} of ${done.length}`, 'ok'),
        statCard('chart', 'Average SGPA', avg ?? '-')),
      h('div', { class: 'card' },
        cardTitle('award', `${d.class.name} · Semester ${d.semester}`,
          d.published ? h('span', { class: 'badge ok', text: 'Published' }) : h('span', { class: 'badge warn', text: 'Not published' }),
          h('button', {
            class: d.published ? 'danger' : 'primary', text: d.published ? 'Unpublish' : 'Publish result', onclick: busy(async () => {
              const msg = d.published ? 'Unpublish? Students will no longer see this result and marks can be edited again.' : `Publish semester ${d.semester} result? Students will see their grade cards and marks get locked.`;
              if (!await confirmBox(msg, { ok: d.published ? 'Unpublish' : 'Publish', danger: d.published })) return;
              await api('/api/results/publish', { method: 'POST', body: { class_id: d.class.id, semester: d.semester, published: !d.published } });
              toast(d.published ? 'Result unpublished' : 'Result published');
              await load();
            }),
          })),
        table([
          { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
          ...d.subjects.map((sub) => ({ label: sub.code, render: (st) => { const m = st.marks[sub.id]; return m.total == null ? h('span', { class: 'muted small', text: m.internal != null ? `${m.internal} + ?` : '-' }) : h('span', { class: m.grade === 'F' ? 'badge bad' : '', text: `${m.total} ${m.grade}` }); } })),
          { label: 'SGPA', class: 'num', render: (st) => h('strong', { text: st.sgpa ?? '-' }) },
          { label: 'Result', render: (st) => h('span', { class: `badge ${st.status === 'Pass' ? 'ok' : st.status === 'Back' ? 'bad' : ''}`, text: st.status }) },
          { label: '', class: 'actions', render: (st) => h('button', { class: 'sm', text: 'Grade card', onclick: busy(() => showCard(st)) }) },
        ], d.students, 'No students.')));
  }
}

// ---- Library ----
export async function library(main) {
  const issueCard = h('div', { class: 'card' });
  const activeCard = h('div', { class: 'card' });
  const catalog = h('div');
  main.append(h('div', { class: 'grid2' }, issueCard, activeCard), h('h2', { text: 'Book catalogue' }), catalog);

  async function loadIssue() {
    const books = (await api('/api/library/admin/books')).filter((b) => b.available > 0);
    issueCard.replaceChildren(cardTitle('upload', 'Issue a book'), buildForm([
      { name: 'book_id', label: 'Book', type: 'select', required: true, full: true, options: books.map((b) => ({ value: b.id, label: `${b.accession_no} · ${b.title} (${b.available} left)` })) },
      { name: 'username', label: 'Student roll no / username', required: true, full: true },
    ], {
      submitLabel: 'Issue',
      onSubmit: async (d) => {
        const r = await api('/api/library/admin/issues', { method: 'POST', body: d });
        toast(`Issued. Due back on ${fmtDate(r.due_on)}`);
        await Promise.all([loadIssue(), loadActive()]);
      },
    }));
  }

  async function loadActive() {
    const list = await api('/api/library/admin/issues');
    activeCard.replaceChildren(cardTitle('library', `Books out (${list.length})`), table([
      { label: 'Book', render: (i) => h('div', null, h('div', { text: i.title }), h('div', { class: 'small muted', text: i.accession_no })) },
      { label: 'Issued to', render: (i) => `${i.user_name} (${i.username})` },
      { label: 'Due', render: (i) => h('span', { class: i.overdue ? 'badge bad' : '', text: fmtDate(i.due_on) }) },
      { label: 'Fine', class: 'num', render: (i) => (i.fine ? money(i.fine) : '-') },
      {
        label: '', class: 'actions', render: (i) => h('button', {
          class: 'sm primary', text: 'Return', onclick: busy(async () => {
            if (!await confirmBox(`Return "${i.title}" from ${i.user_name}?${i.fine ? `\nCollect late fine: ${money(i.fine)}` : ''}`, { ok: 'Return' })) return;
            await api(`/api/library/admin/issues/${i.id}/return`, { method: 'POST' });
            toast('Book returned');
            await Promise.all([loadIssue(), loadActive()]);
          }),
        }),
      },
    ], list, 'No books are out.'));
  }

  await Promise.all([loadIssue(), loadActive(), crudView({
    endpoint: '/api/library/admin/books',
    fields: async () => [
      { name: 'accession_no', label: 'Accession no', required: true }, { name: 'title', label: 'Title', required: true },
      { name: 'author', label: 'Author' }, { name: 'isbn', label: 'ISBN' }, { name: 'category', label: 'Category' },
      { name: 'copies', label: 'Copies', type: 'number', min: 0, required: true, default: 1 }, { name: 'shelf', label: 'Shelf' },
    ],
    columns: [
      { label: 'Acc no', key: 'accession_no' }, { label: 'Title', key: 'title' }, { label: 'Author', key: 'author' }, { label: 'Category', key: 'category' },
      { label: 'Shelf', key: 'shelf' }, { label: 'Available', class: 'num', render: (b) => h('span', { class: `badge ${b.available ? 'ok' : 'bad'}`, text: `${b.available} / ${b.copies}` }) },
    ],
  })(catalog)]);
}

// ---- Hostel ----
export async function hostel(main) {
  const allotCard = h('div', { class: 'card' });
  const hostelsBox = h('div');
  const roomsBox = h('div');
  main.append(allotCard, h('h2', { text: 'Hostels' }), hostelsBox, h('h2', { text: 'Rooms' }), roomsBox);

  async function loadAllot() {
    const [students, rooms, list] = await Promise.all([studentOptions(), api('/api/campus/admin/rooms'), api('/api/campus/admin/hostel-allotments')]);
    allotCard.replaceChildren(cardTitle('home', 'Room allotment'), buildForm([
      { name: 'student_id', label: 'Student', type: 'select', required: true, options: students },
      { name: 'room_id', label: 'Room', type: 'select', required: true, options: rooms.map((r) => ({ value: r.id, label: `${r.hostel_name} · Room ${r.room_no} (${r.occupied}/${r.capacity})` })) },
    ], {
      submitLabel: 'Allot room',
      onSubmit: async (d) => { await api('/api/campus/admin/hostel-allotments', { method: 'POST', body: d }); toast('Room allotted'); await loadAllot(); },
    }), h('br'), table([
      { label: 'Hostel', key: 'hostel_name' }, { label: 'Room', key: 'room_no' }, { label: 'Student', render: (a) => `${a.name} (${a.roll_no})` },
      { label: 'Class', key: 'class_name' }, { label: 'Since', render: (a) => fmtDate(a.allotted_on) },
      { label: '', class: 'actions', render: (a) => h('button', { class: 'sm danger', text: 'Vacate', onclick: busy(async () => { if (!await confirmBox(`Vacate ${a.name} from room ${a.room_no}?`, { ok: 'Vacate', danger: true })) return; await api(`/api/campus/admin/hostel-allotments/${a.student_id}`, { method: 'DELETE' }); await loadAllot(); }) }) },
    ], list, 'No one is allotted yet.'));
  }

  await Promise.all([loadAllot(),
    crudView({
      endpoint: '/api/campus/admin/hostels',
      fields: async () => [{ name: 'name', label: 'Name', required: true }, { name: 'type', label: 'Type', type: 'select', required: true, default: 'boys', options: [{ value: 'boys', label: 'Boys' }, { value: 'girls', label: 'Girls' }] },
        { name: 'warden_name', label: 'Warden' }, { name: 'warden_phone', label: 'Warden phone' }],
      columns: [{ label: 'Hostel', key: 'name' }, { label: 'Type', key: 'type' }, { label: 'Warden', key: 'warden_name' }, { label: 'Phone', key: 'warden_phone' },
        { label: 'Rooms', key: 'rooms', class: 'num' }, { label: 'Occupied', class: 'num', render: (x) => `${x.occupied} / ${x.beds}` }],
    })(hostelsBox),
    crudView({
      endpoint: '/api/campus/admin/rooms',
      fields: async () => [{ name: 'hostel_id', label: 'Hostel', type: 'select', required: true, options: await options('/api/campus/admin/hostels', (x) => x.name) },
        { name: 'room_no', label: 'Room no', required: true }, { name: 'capacity', label: 'Beds', type: 'number', min: 1, required: true, default: 2 }],
      columns: [{ label: 'Hostel', key: 'hostel_name' }, { label: 'Room', key: 'room_no' },
        { label: 'Occupancy', render: (r) => h('span', { class: `badge ${r.occupied >= r.capacity ? 'bad' : 'ok'}`, text: `${r.occupied} / ${r.capacity}` }) }],
    })(roomsBox)]);
}

// ---- Transport ----
export async function transport(main) {
  const allotCard = h('div', { class: 'card' });
  const routesBox = h('div');
  main.append(allotCard, h('h2', { text: 'Bus routes' }), routesBox);

  async function loadAllot() {
    const [students, routes, list] = await Promise.all([studentOptions(), options('/api/campus/admin/routes', (r) => `${r.name} (${r.bus_no || 'no bus'})`), api('/api/campus/admin/transport-allotments')]);
    allotCard.replaceChildren(cardTitle('bus', 'Bus pass allotment'), buildForm([
      { name: 'student_id', label: 'Student', type: 'select', required: true, options: students },
      { name: 'route_id', label: 'Route', type: 'select', required: true, options: routes },
      { name: 'stop', label: 'Pick-up stop' },
    ], {
      submitLabel: 'Allot',
      onSubmit: async (d) => { await api('/api/campus/admin/transport-allotments', { method: 'POST', body: d }); toast('Bus pass allotted'); await loadAllot(); },
    }), h('br'), table([
      { label: 'Route', key: 'route_name' }, { label: 'Bus', key: 'bus_no' }, { label: 'Student', render: (a) => `${a.name} (${a.roll_no})` },
      { label: 'Class', key: 'class_name' }, { label: 'Stop', key: 'stop' },
      { label: '', class: 'actions', render: (a) => h('button', { class: 'sm danger', text: 'Remove', onclick: busy(async () => { await api(`/api/campus/admin/transport-allotments/${a.student_id}`, { method: 'DELETE' }); await loadAllot(); }) }) },
    ], list, 'No bus passes yet.'));
  }

  await Promise.all([loadAllot(), crudView({
    endpoint: '/api/campus/admin/routes',
    fields: async () => [{ name: 'name', label: 'Route name', required: true }, { name: 'bus_no', label: 'Bus no' }, { name: 'departure_time', label: 'Departure', type: 'time' },
      { name: 'driver_name', label: 'Driver' }, { name: 'driver_phone', label: 'Driver phone' }, { name: 'stops', label: 'Stops (in order, comma separated)', type: 'textarea', full: true }],
    columns: [{ label: 'Route', key: 'name' }, { label: 'Bus', key: 'bus_no' }, { label: 'Departs', key: 'departure_time' }, { label: 'Driver', render: (r) => [r.driver_name, r.driver_phone].filter(Boolean).join(' · ') },
      { label: 'Stops', render: (r) => h('span', { class: 'small', text: r.stops || '-' }) }, { label: 'Riders', key: 'riders', class: 'num' }],
  })(routesBox)]);
}

// ---- Grievances ----
export async function grievances(main, ctx) {
  const listCard = h('div', { class: 'card' });
  main.append(listCard);
  async function respond(g) {
    const status = selectEl([{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }], { value: g.status, placeholder: 'Status' });
    const response = h('textarea', { placeholder: 'Response to the person', value: g.response || '', 'aria-label': 'Response' });
    const ok = await modal(h('div', null, h('h2', { text: g.subject }), h('p', { class: 'muted small', text: `${g.user_name} (${g.roll_no || g.role}) · ${g.category} · ${fmtDate(g.created_at)}` }),
      h('p', { class: 'pre', text: g.description }), h('div', { class: 'field' }, h('label', { text: 'Status' }), status), h('br'), response),
    [{ label: 'Cancel', value: false }, { label: 'Save', value: true, class: 'primary' }]);
    if (!ok) return;
    await api(`/api/support/grievances/${g.id}`, { method: 'PUT', body: { status: status.value, response: response.value } });
    toast('Updated');
    await load();
  }
  async function load() {
    const list = await api('/api/support/grievances');
    ctx.setBadge('grievances', list.filter((g) => g.status !== 'resolved').length);
    listCard.replaceChildren(table([
      { label: 'Ticket', render: (g) => `GRV-${String(g.id).padStart(5, '0')}` }, { label: 'Date', render: (g) => fmtDate(g.created_at) },
      { label: 'From', render: (g) => h('div', null, h('div', { text: g.user_name }), h('div', { class: 'small muted', text: g.roll_no || g.role })) },
      { label: 'Category', key: 'category' }, { label: 'Subject', key: 'subject' }, { label: 'Status', render: (g) => statusBadge(g.status) },
      { label: '', class: 'actions', render: (g) => h('button', { class: 'sm primary', text: 'Respond', onclick: busy(() => respond(g)) }) },
    ], list, 'No grievances.'));
  }
  await load();
}

// ---- ID cards ----
export async function idCards(main, ctx) {
  const box = h('div', { class: 'idcards' });
  const sel = selectEl(await classOptions(), {
    placeholder: 'Choose a class',
    onchange: busy(async () => {
      if (!sel.value) return box.replaceChildren();
      const list = await api(`/api/admin/id-cards?classId=${sel.value}`);
      box.replaceChildren(...list.map((st) => idCard(st, ctx.me)));
    }),
  });
  main.append(h('div', { class: 'card row no-print' }, h('strong', { text: 'Class' }), sel, printButton('Print cards'),
    h('span', { class: 'muted small', text: 'The photo is the first face-enrolment photo of each student.' })), box);
}
