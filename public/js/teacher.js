import {
  h, api, toast, busy, confirmBox, table, startApp, icon, statCard, cardTitle, DAYS, fmtDate, fmtTime, initials,
} from './common.js';

const statusBadge = (s, present, total) => {
  if (!s) return h('span', { class: 'badge', text: 'Not taken' });
  const map = { scanning: ['red', 'Scanning'], review: ['warn', 'Waiting for submit'], queued: ['navy', 'Saving (queued)'], saved: ['ok', `Saved ${present ?? ''}${total ? `/${total}` : ''}`], cancelled: ['', 'Cancelled'] };
  const [k, t] = map[s] || ['', s];
  return h('span', { class: `badge ${k}`, text: t });
};

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

// ---- My lectures: today's classes + weekly allotment ----
async function lecturesView(main, ctx) {
  const d = await api('/api/attendance/lectures');
  const todays = d.lectures.filter((l) => l.day === d.today);
  const now = nowHHMM();
  const p = ctx.me.profile || {};

  main.append(h('div', { class: 'stats' },
    statCard('calendar', "Today's lectures", todays.length, DAYS[d.today]),
    statCard('checkbox', 'Attendance done today', todays.filter((l) => l.session_status === 'saved' || l.session_status === 'queued').length, `of ${todays.length}`, 'ok'),
    statCard('book', 'Lectures per week', d.lectures.length, `${new Set(d.lectures.map((l) => l.class_id)).size} classes`),
    statCard('teacher', 'Employee ID', p.employee_no || '-', [p.designation, p.department].filter(Boolean).join(' · '))));

  main.append(h('div', { class: 'card' }, cardTitle('clock', `Today, ${DAYS[d.today]} ${fmtDate(d.date)}`),
    todays.length ? h('div', { class: 'lectures' }, todays.map((l) => lectureCard(l, now, ctx))) : h('div', { class: 'empty', text: 'No lecture is allotted to you today.' })));

  const byDay = [1, 2, 3, 4, 5, 6, 7].map((day) => [day, d.lectures.filter((l) => l.day === day)]).filter(([, list]) => list.length);
  main.append(h('div', { class: 'card' }, cardTitle('calendar', 'My weekly allotment'),
    table([
      { label: 'Day', render: (l) => h('strong', { text: DAYS[l.day] }) },
      { label: 'Time', render: (l) => `${l.start_time} - ${l.end_time}` },
      { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (l) => `${l.subject_code} ${l.subject_name}` },
      { label: 'Room', render: (l) => [l.room_name, l.building].filter(Boolean).join(', ') || '-' },
      { label: 'Students', class: 'num', key: 'registered' },
    ], byDay.flatMap(([, list]) => list), 'No lectures allotted yet. Ask the admin.')));
}

function lectureCard(l, now, ctx) {
  const isNow = l.start_time <= now && now < l.end_time;
  const done = l.session_status === 'saved' || l.session_status === 'queued';
  const open = l.session_status === 'scanning' || l.session_status === 'review';
  return h('div', { class: `lecture ${isNow ? 'now' : ''} ${done ? 'done' : ''}` },
    h('div', { class: 'between' }, h('span', { class: 'time', text: `${l.start_time} - ${l.end_time}` }), isNow ? h('span', { class: 'badge red', text: 'Now' }) : statusBadge(l.session_status, l.present_count, l.registered)),
    h('div', null, h('div', { class: 'subject', text: l.subject_name }), h('div', { class: 'muted small', text: l.subject_code })),
    h('div', { class: 'meta' },
      h('span', null, icon('students', 15), l.class_name),
      h('span', null, icon('pin', 15), l.room_name || 'No room'),
      h('span', null, icon('users', 15), `${l.registered} registered`),
      h('span', null, icon('scan', 15), `${l.enrolled} face enrolled`)),
    l.enrolled < l.registered ? h('div', { class: 'small muted', text: `${l.registered - l.enrolled} students have no face photo; mark them by hand.` }) : null,
    h('div', { class: 'actions' },
      h('span', { class: 'small muted', text: l.has_camera ? 'Classroom camera ready' : 'No room camera: use this computer\'s camera' }),
      done ? h('a', { class: 'btn sm', href: `#attendance/${l.session_id}`, text: 'View' })
        : h('button', {
          class: open ? 'primary' : 'red', onclick: busy(async () => {
            const r = await api('/api/attendance/start', { method: 'POST', body: { lecture_id: l.id } });
            ctx.go(`attendance/${r.session.id}`);
          }),
        }, icon(open ? 'play' : 'scan', 16), open ? 'Continue' : 'Start attendance')));
}

// ---- Attendance: history list, or one session (#attendance/<id>) ----
async function attendanceView(main, ctx) {
  const id = Number(location.hash.split('/')[1]);
  if (id) return sessionView(main, ctx, id);
  const list = await api('/api/attendance/history');
  main.append(h('div', { class: 'card' }, table([
    { label: 'Date', render: (s) => fmtDate(s.date) }, { label: 'Class', key: 'class_name' }, { label: 'Subject', render: (s) => `${s.subject_code} ${s.subject_name}` },
    { label: 'Registered', class: 'num', key: 'registered_count' }, { label: 'In class (camera)', class: 'num', key: 'max_faces' },
    { label: 'Recognised', class: 'num', key: 'recognised_count' }, { label: 'Present', class: 'num', render: (s) => s.present_count ?? '-' },
    { label: 'Status', render: (s) => statusBadge(s.status, s.present_count, s.registered_count) },
    { label: '', class: 'actions', render: (s) => h('a', { class: 'btn sm', href: `#attendance/${s.id}`, text: ['scanning', 'review'].includes(s.status) ? 'Continue' : 'View' }) },
  ], list, 'No attendance taken yet.')));
}

function ring(secondsLeft, total) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  const c = (cls) => { const e = document.createElementNS(NS, 'circle'); for (const [k, v] of Object.entries({ cx: 21, cy: 21, r: 15.915, fill: 'none', 'stroke-width': 4, class: cls })) e.setAttribute(k, v); return e; };
  const track = c('track');
  const val = c('val');
  svg.append(track, val);
  const label = h('div', { class: 'center' });
  const set = (s) => {
    const pct = Math.max(0, Math.min(100, (s / total) * 100));
    val.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
    label.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  set(secondsLeft);
  return { el: h('div', { class: 'ring' }, svg, label), set };
}

async function sessionView(main, ctx, id) {
  const state = await api(`/api/attendance/${id}`);
  const s = state.session;
  main.querySelector('.page-head h1').textContent = `${s.subject_name} · ${s.class_name}`;
  main.querySelector('.page-head').append(h('a', { class: 'btn', href: '#lectures' }, 'Back to lectures'));
  main.append(h('p', { class: 'muted' }, `${fmtDate(s.date)} · ${s.start_time} - ${s.end_time} · Room ${s.room_name || '-'} · ${s.subject_code}`));
  if (s.status === 'scanning') return scanScreen(main, ctx, state);
  if (s.status === 'review') return reviewScreen(main, ctx, state);
  return doneScreen(main, state);
}

// ---- 1. Live scan: camera frames for N minutes, recognised students appear as they are seen ----
async function scanScreen(main, ctx, state) {
  const { cameraPanel, detectFaces, drawOverlay } = await import('./camera.js');
  const s = state.session;
  const total = ctx.me.scan_minutes * 60;
  const interval = Math.max(1, ctx.me.frame_interval_seconds) * 1000;
  const panel = cameraPanel({ roomSnapshotUrl: s.has_camera ? `/api/attendance/${s.id}/camera` : null, allowUpload: true });
  const timer = ring(s.seconds_left, total);
  const counts = { reg: h('strong', { text: state.counts.registered }), now: h('strong', { text: 0 }), rec: h('strong', { text: state.counts.recognised }) };
  const list = h('div', { class: 'recog-list' });
  const recTitle = h('h2', { text: `Recognised (${state.scan.recognised.length})` });
  const log = h('div', { class: 'small muted' });
  let stopped = false;

  const addRow = (r, fresh) => list.prepend(h('div', { class: `recog ${fresh ? 'fresh' : ''}` }, h('span', { class: 'avatar', text: initials(r.name) }),
    h('div', { class: 'grow' }, h('div', { text: r.name }), h('div', { class: 'small muted', text: r.roll_no })),
    h('span', { class: 'badge ok', text: `${Math.round(r.confidence * 100)}%` })));
  state.scan.recognised.forEach((r) => addRow(r, false));
  if (!state.scan.recognised.length) list.append(h('div', { class: 'empty', text: 'Recognised students will appear here.' }));

  if (state.counts.enrolled === 0) main.append(h('div', { class: 'notice warn', text: 'No student of this class has a face photo yet, so the camera cannot recognise anyone. You can still mark everyone by hand after the scan.' }));
  main.append(h('div', { class: 'scan-layout' },
    h('div', { class: 'card' }, cardTitle('camera', 'Classroom camera'), panel.el),
    h('div', null,
      h('div', { class: 'card' }, h('div', { class: 'countdown' }, timer.el, h('div', { class: 'big-counts' },
        h('div', null, counts.reg, h('span', { text: 'Registered' })), h('div', null, counts.now, h('span', { text: 'In class (camera)' })), h('div', null, counts.rec, h('span', { text: 'Recognised' })))),
      h('br'), log,
      h('div', { class: 'row end' }, h('button', { class: 'danger sm', text: 'Cancel', onclick: busy(cancel) }), h('button', { class: 'primary', onclick: busy(() => finish(true)) }, icon('stop', 16), 'Stop scan and review'))),
      h('div', { class: 'card' }, recTitle, list))));

  async function cancel() {
    if (!await confirmBox('Cancel this attendance? Nothing will be saved.', { ok: 'Cancel attendance', danger: true })) return;
    stopped = true;
    panel.stop();
    await api(`/api/attendance/${s.id}/cancel`, { method: 'POST' });
    ctx.go('lectures');
  }

  async function finish(early) {
    if (stopped) return;
    if (early && !await confirmBox('Stop scanning now and go to the review list?', { ok: 'Stop scan' })) return;
    stopped = true;
    panel.stop();
    await api(`/api/attendance/${s.id}/finish`, { method: 'POST' });
    toast('Scan complete. Check the list and submit.', 'ok');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  ctx.cleanup = () => { stopped = true; panel.stop(); };
  panel.setLive(true);
  let secondsLeft = s.seconds_left;
  const tick = setInterval(() => { secondsLeft = Math.max(0, secondsLeft - 1); timer.set(secondsLeft); if (!secondsLeft) { clearInterval(tick); finish(false).catch(() => {}); } if (stopped) clearInterval(tick); }, 1000);

  // Capture loop: grab, detect locally, send descriptors, show results; then wait.
  (async function loop() {
    while (!stopped && secondsLeft > 0) {
      const t0 = Date.now();
      try {
        const frame = await panel.grab();
        const faces = await detectFaces(frame, ctx.me.min_face_confidence);
        if (stopped) break;
        const r = await api(`/api/attendance/${s.id}/frame`, { method: 'POST', body: { faces: faces.map((f) => f.descriptor) } });
        const byFace = new Map(r.matches.map((m) => [m.faceIndex, m.roll_no]));
        drawOverlay(panel.overlay, frame.width, frame.height, faces, faces.map((_, i) => byFace.get(i)));
        counts.now.textContent = r.faces;
        counts.rec.textContent = r.recognised;
        recTitle.textContent = `Recognised (${r.recognised})`;
        if (r.fresh.length && list.querySelector('.empty')) list.replaceChildren();
        r.fresh.forEach((x) => addRow(x, true));
        secondsLeft = r.seconds_left;
        log.textContent = `Frame ${r.frames}: ${r.faces} face(s) in view, highest so far ${r.max_faces}.`;
        panel.setStatus('');
      } catch (err) {
        if (err.status === 409) { await finish(false).catch(() => {}); break; }
        panel.setStatus(err.message);
      }
      await new Promise((res) => setTimeout(res, Math.max(200, interval - (Date.now() - t0))));
    }
  })();
}

// ---- 2. Review: everyone in the class, camera result pre-filled, teacher corrects, submits ----
function reviewScreen(main, ctx, state) {
  const s = state.session;
  const camera = new Map(state.scan.recognised.map((r) => [Number(r.student_id), r]));
  const marks = new Map(state.roster.map((st) => [st.id, camera.has(st.id) ? 'P' : 'A']));
  const headcount = state.scan.maxFaces || 0;
  const statsBox = h('div', { class: 'stats' });
  const warnBox = h('div');
  const listBox = h('div');
  const summary = h('span', { class: 'grow' });
  const search = h('input', { type: 'search', placeholder: 'Search name or roll no', 'aria-label': 'Search students' });
  const onlyMissing = h('input', { type: 'checkbox', id: 'only-missing' });
  search.addEventListener('input', () => renderList());
  onlyMissing.addEventListener('change', () => renderList());

  main.append(statsBox, warnBox, h('div', { class: 'card' },
    cardTitle('usercheck', 'Mark attendance', h('label', { class: 'row small', for: 'only-missing' }, onlyMissing, 'Show only not recognised'), search,
      h('button', { class: 'sm ok', text: 'Mark all present', onclick: () => { for (const k of marks.keys()) marks.set(k, 'P'); render(); } })),
    h('p', { class: 'muted small', text: 'Students recognised by the camera are already marked present. Mark anyone the camera missed by hand.' }),
    listBox),
  h('div', { class: 'sticky-bar' }, summary,
    h('button', { class: 'danger', text: 'Cancel attendance', onclick: busy(async () => {
      if (!await confirmBox('Cancel this attendance? Nothing will be saved.', { ok: 'Cancel attendance', danger: true })) return;
      await api(`/api/attendance/${s.id}/cancel`, { method: 'POST' });
      ctx.go('lectures');
    }) }),
    h('button', { class: 'red big', onclick: busy(submit) }, icon('check', 18), 'Submit attendance')));

  function counts() {
    const present = [...marks.values()].filter((m) => m === 'P').length;
    return { present, absent: marks.size - present, manualPresent: [...marks].filter(([k, m]) => m === 'P' && !camera.has(k)).length };
  }

  function render() {
    const c = counts();
    statsBox.replaceChildren(
      statCard('users', 'Registered in class', state.counts.registered, 'official strength'),
      statCard('scan', 'In class (camera count)', headcount, `${state.scan.frames} frames scanned`, 'red'),
      statCard('usercheck', 'Recognised by camera', camera.size, null, 'ok'),
      statCard('checkbox', 'Present (final)', c.present, c.manualPresent ? `${c.manualPresent} marked by hand` : null, 'ok'),
      statCard('x', 'Absent', c.absent, null, 'warn'));
    const notes = [];
    if (headcount > camera.size) notes.push(['warn', `The camera counted ${headcount} people but recognised only ${camera.size}. ${headcount - camera.size} could not be matched; check the list and mark them by hand.`]);
    if (c.present > headcount && headcount > 0) notes.push(['bad', `${c.present} students are marked present but the camera counted at most ${headcount} people in the room. Please double-check (possible proxy).`]);
    warnBox.replaceChildren(...notes.map(([k, t]) => h('div', { class: `notice ${k}`, text: t })));
    summary.textContent = `${c.present} present · ${c.absent} absent · ${state.counts.registered} registered`;
    renderList();
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const rows = state.roster.filter((st) => (!q || st.name.toLowerCase().includes(q) || st.roll_no.toLowerCase().includes(q)) && (!onlyMissing.checked || !camera.has(st.id)));
    listBox.replaceChildren(table([
      { label: 'Roll no', key: 'roll_no' },
      { label: 'Name', key: 'name' },
      { label: 'Camera', render: (st) => (camera.has(st.id) ? h('span', { class: 'badge ok', text: `Recognised ${Math.round(camera.get(st.id).confidence * 100)}%` }) : st.enrolled ? h('span', { class: 'badge', text: 'Not seen' }) : h('span', { class: 'badge warn', text: 'No face photo' })) },
      {
        label: 'Attendance', class: 'actions', render: (st) => {
          const m = marks.get(st.id);
          return h('div', { class: 'seg', role: 'group', 'aria-label': `Attendance for ${st.name}` },
            h('button', { class: m === 'P' ? 'on-p' : '', text: 'Present', 'aria-pressed': String(m === 'P'), onclick: () => { marks.set(st.id, 'P'); render(); } }),
            h('button', { class: m === 'A' ? 'on-a' : '', text: 'Absent', 'aria-pressed': String(m === 'A'), onclick: () => { marks.set(st.id, 'A'); render(); } }));
        },
      },
    ], rows, 'No student matches.'));
  }

  async function submit() {
    const c = counts();
    const msg = `Registered: ${state.counts.registered}\nIn class (camera count): ${headcount}\nRecognised by camera: ${camera.size}\nPresent: ${c.present}${c.manualPresent ? ` (${c.manualPresent} by hand)` : ''}\nAbsent: ${c.absent}\n\nAfter submitting, only the admin can change it.`;
    if (!await confirmBox(msg, { ok: 'Submit attendance', title: 'Submit attendance?' })) return;
    // Only send marks that differ from what the camera decided.
    const manual = {};
    for (const [k, m] of marks) if (m !== (camera.has(k) ? 'P' : 'A')) manual[k] = m;
    const r = await api(`/api/attendance/${s.id}/submit`, { method: 'POST', body: { manual } });
    if (r.mode === 'direct') toast(`Attendance saved: ${r.present} of ${r.total} present`, 'ok');
    else toast(`Attendance received (${r.present} of ${r.total} present). It is queued and will be saved shortly; you will get a notification.`, 'ok');
    ctx.refreshNotifications(true);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  render();
}

// ---- 3. Submitted ----
function doneScreen(main, state) {
  const s = state.session;
  const recs = new Map((state.records || []).map((r) => [r.student_id, r]));
  if (s.status === 'queued') main.append(h('div', { class: 'notice info', text: 'Submitted. Many classes are submitting right now, so this attendance is in the save queue. You will get a notification as soon as it is saved (well before the next lecture).' }));
  if (s.status === 'cancelled') main.append(h('div', { class: 'notice warn', text: 'This attendance was cancelled.' }));
  main.append(h('div', { class: 'stats' },
    statCard('users', 'Registered', s.registered_count),
    statCard('scan', 'In class (camera count)', s.max_faces, null, 'red'),
    statCard('usercheck', 'Recognised by camera', s.recognised_count, null, 'ok'),
    statCard('checkbox', 'Present', s.present_count ?? '-', s.saved_at ? `saved ${fmtTime(s.saved_at)}` : 'saving...', 'ok')));
  if (state.records) {
    main.append(h('div', { class: 'card' }, table([
      { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
      { label: 'Status', render: (st) => { const r = recs.get(st.id); return r ? h('span', { class: `badge ${r.status === 'P' ? 'ok' : 'bad'}`, text: r.status === 'P' ? 'Present' : 'Absent' }) : '-'; } },
      { label: 'Marked by', render: (st) => ({ camera: 'Camera', manual: 'Teacher', auto: 'Not seen' }[recs.get(st.id)?.source] || '-') },
    ], state.roster)));
  }
}

startApp(['teacher'], [
  { id: 'lectures', label: 'My lectures', icon: 'calendar', group: 'Teaching', render: lecturesView },
  { id: 'attendance', label: 'Attendance', icon: 'checkbox', group: 'Teaching', render: attendanceView },
]);
