// Teacher's camera attendance screen.
// Flow: choose class+subject -> Start attendance -> capture with the camera (as many times as needed)
// -> check the numbers (registered / counted by camera / recognised) -> fix by hand -> Submit.
import { h, api, toast, busy, confirmBox, fmtDate, fmtDateTime, table } from './common.js';

export async function attendanceView(main, ctx) {
  const sessionId = Number(location.hash.split('/')[1]);
  if (sessionId) return sessionScreen(main, ctx, sessionId);

  const list = await api('/api/teacher/assignments');
  main.append(h('p', { class: 'muted', text: 'Attendance is taken only after you press Start. You will see the registered strength and the camera headcount before anything is saved, and you can always mark students by hand.' }));
  if (!list.length) main.append(h('div', { class: 'card empty', text: 'You have not been assigned any class yet. Ask the admin.' }));
  main.append(h('div', { class: 'stats' }, list.map((a) => h('div', { class: `stat ${a.open_session_id ? 'warn' : ''}` },
    h('div', { class: 'label', text: a.class_name }),
    h('div', { text: `${a.subject_code} ${a.subject_name}` }),
    h('div', { class: 'sub', text: `${a.registered} registered · ${a.enrolled} face enrolled${a.has_camera ? ' · camera ready' : ''}` }),
    h('div', { class: 'row' }, h('button', {
      class: 'primary sm', text: a.open_session_id ? 'Resume attendance' : 'Start attendance',
      onclick: busy(async () => {
        const st = await api('/api/attendance/sessions', { method: 'POST', body: { class_id: a.class_id, subject_id: a.subject_id } });
        if (st.submitted_today && st.counts.present + st.counts.absent === 0) toast(`Note: attendance for this subject was already submitted ${st.submitted_today} time(s) today`);
        location.hash = `attendance/${st.session.id}`;
      }),
    }))))));

  const history = await api('/api/teacher/sessions');
  main.append(h('div', { class: 'card' }, h('h2', { text: 'Recent attendance' }), table([
    { label: 'Date', render: (s) => fmtDate(s.date) },
    { label: 'Class', key: 'class_name' },
    { label: 'Subject', render: (s) => `${s.subject_code} ${s.subject_name}` },
    { label: 'Present', class: 'num', render: (s) => `${s.present} / ${s.registered_count}` },
    { label: 'Camera count', class: 'num', render: (s) => s.max_faces ?? '-' },
    { label: 'Status', render: (s) => h('span', { class: `badge ${s.status === 'submitted' ? 'ok' : 'warn'}`, text: s.status }) },
    { label: '', class: 'actions', render: (s) => h('a', { class: 'btn sm', href: `#attendance/${s.id}`, text: s.status === 'open' ? 'Continue' : 'View' }) },
  ], history, 'No attendance taken yet.')));
}

function statBox(label, value, sub, kind = '') {
  return h('div', { class: `stat ${kind}` }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value ?? '-' }), sub && h('div', { class: 'sub', text: sub }));
}

function statusBadge(s) {
  if (!s.status) return h('span', { class: 'badge', text: 'Not marked' });
  return h('span', { class: `badge ${s.status === 'present' ? 'ok' : 'bad'}`, text: s.status === 'present' ? 'Present' : 'Absent' });
}

const leaveBadge = (s) => (s.on_leave ? h('span', { class: 'badge primary', text: 'On approved leave' }) : null);

function sourceText(s) {
  if (s.source === 'camera') return `Camera (match ${Math.round((1 - s.distance) * 100)}%)`;
  if (s.source === 'manual') return 'Marked by hand';
  if (s.source === 'auto') return 'Not marked (absent)';
  return '';
}

async function sessionScreen(main, ctx, id) {
  let state = await api(`/api/attendance/sessions/${id}`);
  const s = state.session;
  main.querySelector('.page-head h1').textContent = `Attendance: ${s.class_name}`;
  main.append(h('div', { class: 'between' },
    h('div', null, h('div', { text: `${s.subject_code} ${s.subject_name}` }), h('div', { class: 'muted small', text: `${fmtDate(s.date)} · started ${fmtDateTime(s.started_at)}` })),
    h('a', { class: 'btn', href: '#attendance', text: 'Back' })));

  const statsBox = h('div', { class: 'stats' });
  const warnBox = h('div');
  const listBox = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search name or roll no', 'aria-label': 'Search students' });
  search.addEventListener('input', () => renderList());
  main.append(statsBox, warnBox);

  const open = s.status === 'open';
  let panel = null;
  if (open) {
    // face-api.js is large, so it loads only when a camera screen is opened.
    const { cameraPanel, detectFaces, drawResult } = await import('./camera.js');
    panel = cameraPanel({ classId: s.class_id, hasCamera: !!s.has_camera });
    ctx.cleanup = () => panel.stop();
    const resultCanvas = h('canvas', { class: 'result-canvas hidden' });
    const lastLog = h('div', { class: 'cam-status' });
    const captureBtn = h('button', { class: 'primary big', text: 'Capture and recognise' });
    captureBtn.addEventListener('click', busy(async () => {
      const frame = await panel.grab();
      panel.setStatus('Finding faces...');
      const faces = await detectFaces(frame, ctx.me.min_face_confidence);
      panel.setStatus(`Found ${faces.length} face(s). Matching with enrolled students...`);
      const r = await api(`/api/attendance/sessions/${id}/recognize`, { method: 'POST', body: { faces: faces.map((f) => f.descriptor) } });
      const byFace = new Map(r.matches.map((m) => [m.faceIndex, m]));
      drawResult(resultCanvas, frame, faces, faces.map((f, i) => {
        const m = byFace.get(i);
        return m ? { text: `${m.roll_no} ${m.name}`, kind: 'ok' } : { text: 'Not recognised', kind: 'warn' };
      }));
      resultCanvas.classList.remove('hidden');
      const kept = r.matches.filter((m) => m.kept_manual).length;
      lastLog.textContent = `Capture ${r.counts.captures}: ${faces.length} face(s) counted, ${r.matches.length} recognised, ${r.unknown} not recognised.${kept ? ` ${kept} already marked by hand (kept your mark).` : ''}`;
      panel.setStatus('');
      state = r;
      render();
    }));
    main.append(h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', { text: 'Classroom camera' }),
        h('p', { class: 'muted small', text: 'Point the camera at the whole class and capture. Capture again from another angle if some students were hidden; already recognised students stay present.' }),
        panel.el, h('div', { class: 'row' }, captureBtn), lastLog, resultCanvas),
      h('div', { class: 'card' }, h('div', { class: 'between' }, h('h2', { text: 'Students' }), search), listBox)));

    const bar = h('div', { class: 'sticky-bar' },
      h('button', { class: 'ok', text: 'Mark remaining present', onclick: busy(() => markRest('present')) }),
      h('button', { text: 'Mark remaining absent', onclick: busy(() => markRest('absent')) }),
      h('button', { class: 'danger', text: 'Cancel attendance', onclick: busy(cancel) }),
      h('button', { class: 'primary', text: 'Submit attendance', onclick: busy(submit) }));
    main.append(bar);
  } else {
    main.append(h('div', { class: 'card' }, h('div', { class: 'between' }, h('h2', { text: 'Students' }), search), listBox));
  }

  async function markRest(status) {
    if (!state.counts.unmarked) { toast('Every student is already marked'); return; }
    if (!await confirmBox(`Mark the ${state.counts.unmarked} unmarked student(s) as ${status}?`, { ok: `Mark ${status}` })) return;
    state = await api(`/api/attendance/sessions/${id}/mark-rest`, { method: 'POST', body: { status } });
    render();
  }

  async function cancel() {
    if (!await confirmBox('Cancel this attendance? Nothing will be saved.', { ok: 'Cancel attendance', danger: true })) return;
    await api(`/api/attendance/sessions/${id}/cancel`, { method: 'POST' });
    toast('Attendance cancelled');
    location.hash = 'attendance';
  }

  async function submit() {
    const c = state.counts;
    const msg = [
      `Registered in class: ${c.registered}`,
      `Counted by camera: ${c.faces_max ?? 'no capture taken'}`,
      `Present: ${c.present} (camera ${c.recognised}, by hand ${c.manual_present})`,
      `Absent: ${c.absent}`,
      c.unmarked ? `Not marked: ${c.unmarked} (will be saved as absent)` : null,
      '',
      'After submitting you cannot change it. Only the admin can correct a record.',
    ].filter((x) => x != null).join('\n');
    if (!await confirmBox(msg, { ok: 'Submit attendance', title: 'Submit attendance?' })) return;
    await api(`/api/attendance/sessions/${id}/submit`, { method: 'POST' });
    toast('Attendance submitted');
    panel?.stop();
    location.hash = `attendance/${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  async function mark(studentId, status) {
    state = await api(`/api/attendance/sessions/${id}/marks`, { method: 'PUT', body: { student_id: studentId, status } });
    render();
  }

  function renderStats() {
    const c = state.counts;
    statsBox.replaceChildren(
      statBox('Registered in class', c.registered, 'Official strength', 'primary'),
      statBox('Counted by camera', c.faces_last ?? '-', c.captures ? `Highest ${c.faces_max} · ${c.captures} capture(s)` : 'No capture yet'),
      statBox('Recognised by camera', c.recognised),
      statBox('Present', c.present, c.manual_present ? `${c.manual_present} marked by hand` : null, 'ok'),
      statBox('Absent', c.absent),
      open && statBox('Not marked', c.unmarked, null, c.unmarked ? 'warn' : ''));
  }

  function renderWarnings() {
    const c = state.counts;
    const notes = [];
    if (open && c.enrolled < c.registered) notes.push(['warn', `${c.registered - c.enrolled} student(s) have no face photo, so the camera cannot recognise them. Mark them by hand, or enrol their faces.`]);
    if (c.faces_last != null && c.faces_last > c.recognised + c.manual_present && open) notes.push(['warn', `The camera counted ${c.faces_last} people but only ${c.recognised} were recognised. Check the list and mark the rest by hand.`]);
    if (c.faces_max != null && c.present > c.faces_max) notes.push(['bad', `${c.present} students are marked present but the camera counted at most ${c.faces_max} people in class. Please double-check.`]);
    if (!open) notes.push([s.status === 'submitted' ? 'ok' : 'warn', s.status === 'submitted' ? `Submitted ${fmtDateTime(state.session.submitted_at)}.` : `This attendance was ${s.status}.`]);
    warnBox.replaceChildren(...notes.map(([k, t]) => h('div', { class: `notice ${k}`, text: t })));
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const rows = state.students.filter((st) => !q || st.name.toLowerCase().includes(q) || st.roll_no.toLowerCase().includes(q));
    listBox.replaceChildren(table([
      { label: 'Roll no', key: 'roll_no' },
      { label: 'Name', render: (st) => h('span', { class: 'row' }, st.name, open && !st.face_samples ? h('span', { class: 'badge warn', text: 'no face photo' }) : null, leaveBadge(st)) },
      { label: 'Status', render: statusBadge },
      { label: 'How', render: (st) => h('span', { class: 'small muted', text: sourceText(st) }) },
      open && { label: '', class: 'actions', render: (st) => h('span', { class: 'row' },
        h('button', { class: `sm ok ${st.status === 'present' && st.source === 'manual' ? 'on' : ''}`, text: 'Present', onclick: busy(() => mark(st.id, 'present')) }),
        h('button', { class: `sm danger ${st.status === 'absent' ? 'on' : ''}`, text: 'Absent', onclick: busy(() => mark(st.id, 'absent')) }),
        st.status && h('button', { class: 'sm', text: 'Clear', onclick: busy(() => mark(st.id, null)) })) },
    ].filter(Boolean), rows, q ? 'No student matches.' : 'No students.'));
  }

  function render() {
    renderStats();
    renderWarnings();
    renderList();
  }
  render();
}
