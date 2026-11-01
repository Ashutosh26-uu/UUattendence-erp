// Screens shared by more than one role.
import { h, api, toast, busy, modal, table, buildForm, selectEl, fmtDate, fmtDateTime, cardTitle, bars, avatar, icon } from './common.js';

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const statusBadge = (s) => h('span', { class: `badge ${{ approved: 'ok', rejected: 'bad', pending: 'warn', resolved: 'ok', in_progress: 'primary', open: 'warn' }[s] || ''}`, text: s.replace('_', ' ') });
export { statusBadge };

// ---- Leave review (teacher of the class, or admin) ----
export async function leaveReview(main, ctx) {
  const listCard = h('div', { class: 'card' });
  const filter = selectEl([{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }],
    { placeholder: 'All', value: 'pending', onchange: () => load() });
  main.append(h('div', { class: 'row' }, h('strong', { text: 'Show' }), filter), h('br'), listCard);

  async function decide(l, status) {
    const remark = h('textarea', { placeholder: 'Remark (optional)', 'aria-label': 'Remark' });
    const ok = await modal(h('div', null, h('h2', { text: `${status === 'approved' ? 'Approve' : 'Reject'} leave of ${l.student_name}?` }),
      h('p', { class: 'muted', text: `${fmtDate(l.from_date)} to ${fmtDate(l.to_date)} · ${l.reason}` }), remark),
    [{ label: 'Cancel', value: false }, { label: status === 'approved' ? 'Approve' : 'Reject', value: true, class: status === 'approved' ? 'primary' : 'danger' }]);
    if (!ok) return;
    await api(`/api/leave/${l.id}`, { method: 'PUT', body: { status, remark: remark.value } });
    toast(`Leave ${status}`);
    await load();
  }

  async function load() {
    const rows = await api(`/api/leave${filter.value ? `?status=${filter.value}` : ''}`);
    if (filter.value === 'pending') ctx.setBadge?.('leave', rows.length);
    listCard.replaceChildren(table([
      { label: 'Student', render: (l) => h('div', null, h('div', { text: l.student_name }), h('div', { class: 'small muted', text: `${l.roll_no} · ${l.class_name}` })) },
      { label: 'Type', render: (l) => h('span', { class: 'badge', text: l.leave_type }) },
      { label: 'Dates', render: (l) => `${fmtDate(l.from_date)} - ${fmtDate(l.to_date)} (${days(l.from_date, l.to_date)} d)` },
      { label: 'Reason', render: (l) => h('span', { class: 'small', text: l.reason }) },
      { label: 'Status', render: (l) => h('div', null, statusBadge(l.status), l.reviewed_by_name && h('div', { class: 'small muted', text: `by ${l.reviewed_by_name}${l.remark ? `: ${l.remark}` : ''}` })) },
      { label: '', class: 'actions', render: (l) => l.status === 'pending' && h('span', { class: 'row end' },
        h('button', { class: 'sm ok', text: 'Approve', onclick: busy(() => decide(l, 'approved')) }),
        h('button', { class: 'sm danger', text: 'Reject', onclick: busy(() => decide(l, 'rejected')) })) },
    ], rows, 'No leave applications.'));
  }
  await load();
}

// ---- Result marks entry: teacher = internal only, admin = internal + external ----
export async function resultsSheet(main, pairs) {
  const { scale, internal_max: IMAX, external_max: EMAX } = await api('/api/results/scale');
  const gradeOf = (t) => (t == null ? null : scale.find(([min]) => t >= min)[1]);
  const box = h('div');
  const sel = selectEl(pairs, { placeholder: 'Choose class and subject', onchange: busy(() => load()) });
  main.append(h('p', { class: 'muted', text: `Internal assessment is out of ${IMAX} (entered by the subject teacher) and the end-semester exam is out of ${EMAX} (entered by the exam cell). Grades: ${scale.map(([min, g]) => `${g} ${min}+`).join(', ')}.` }),
    h('div', { class: 'card row' }, h('strong', { text: 'Class / subject' }), sel), box);

  async function load() {
    if (!sel.value) return box.replaceChildren();
    const [classId, subjectId] = sel.value.split(':');
    const d = await api(`/api/results/sheet?classId=${classId}&subjectId=${subjectId}`);
    const inputs = new Map();
    const locked = d.published;
    const mk = (val, max, label) => h('input', { class: 'marks', type: 'number', min: 0, max, step: '0.5', value: val ?? '', disabled: locked, 'aria-label': label });
    box.replaceChildren(h('div', { class: 'card' },
      cardTitle('award', `Semester ${d.semester} marks`, locked ? h('span', { class: 'badge ok', text: 'Published - locked' }) : h('span', { class: 'badge warn', text: 'Not published' })),
      table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
        { label: `Internal (${IMAX})`, render: (s) => { const i = mk(s.internal, IMAX, `Internal for ${s.name}`); inputs.set(s.id, { i }); return i; } },
        { label: `External (${EMAX})`, render: (s) => (d.can_edit_external ? (inputs.get(s.id).e = mk(s.external, EMAX, `External for ${s.name}`)) : (s.external ?? 'Pending')) },
        { label: 'Total', class: 'num', render: (s) => { const t = h('span', { text: s.internal != null && s.external != null ? s.internal + s.external : '-' }); inputs.get(s.id).t = t; return t; } },
        { label: 'Grade', render: (s) => { const g = h('span', { class: `badge ${s.grade === 'F' ? 'bad' : s.grade ? 'ok' : ''}`, text: s.grade || '-' }); inputs.get(s.id).g = g; return g; } },
      ], d.students, 'No students.'),
      !locked && h('div', { class: 'form-actions' }, h('button', {
        class: 'primary', text: 'Save marks', onclick: busy(async () => {
          const entries = [...inputs].map(([student_id, x]) => ({ student_id, internal: x.i.value === '' ? null : x.i.value, ...(x.e ? { external: x.e.value === '' ? null : x.e.value } : {}) }));
          await api('/api/results/sheet', { method: 'PUT', body: { class_id: classId, subject_id: subjectId, entries } });
          toast('Marks saved');
          await load();
        }),
      }))));
    // Live total and grade while typing.
    for (const x of inputs.values()) {
      const update = () => {
        const i = x.i.value === '' ? null : Number(x.i.value);
        const e = x.e ? (x.e.value === '' ? null : Number(x.e.value)) : null;
        if (!x.e) return;
        const t = i != null && e != null ? i + e : null;
        x.t.textContent = t ?? '-';
        const g = gradeOf(t);
        x.g.textContent = g || '-';
        x.g.className = `badge ${g === 'F' ? 'bad' : g ? 'ok' : ''}`;
      };
      x.i.addEventListener('input', update);
      x.e?.addEventListener('input', update);
    }
  }
}

// ---- Feedback report (admin: everyone, teacher: own) ----
export async function feedbackSummary(main) {
  const d = await api('/api/support/feedback/summary');
  main.append(h('p', { class: 'muted', text: `Cycle: ${d.cycle}. Ratings are 1 (poor) to 5 (excellent). Students' names are never shown.` }));
  main.append(h('div', { class: 'grid2' },
    h('div', { class: 'card' }, cardTitle('star', 'Overall rating'), bars(d.rows.map((r) => ({ label: `${r.teacher_name} · ${r.code}`, value: r.overall, max: 5, text: r.overall })), { pctKind: true })),
    h('div', { class: 'card' }, cardTitle('message', 'Comments'), d.comments.length
      ? h('div', { class: 'list' }, d.comments.map((c) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { text: c.comment }), h('div', { class: 'small muted', text: `${c.code} · ${c.teacher_name}` })))))
      : h('div', { class: 'empty', text: 'No comments yet.' }))));
  main.append(h('div', { class: 'card' }, cardTitle('chart', 'Question-wise average'), table([
    { label: 'Teacher', key: 'teacher_name' }, { label: 'Subject', render: (r) => `${r.code} ${r.subject_name}` }, { label: 'Responses', key: 'responses', class: 'num' },
    ...d.questions.map((q, i) => ({ label: `Q${i + 1}`, class: 'num', render: (r) => h('span', { title: q, text: r[`q${i + 1}`] }) })),
    { label: 'Overall', class: 'num', render: (r) => h('strong', { text: r.overall }) },
  ], d.rows, 'No feedback yet.'), h('ol', { class: 'small muted' }, d.questions.map((q) => h('li', { text: q })))));
}

// ---- Grievances raised by a student or teacher ----
export async function myGrievances(main) {
  const categories = await api('/api/support/grievances/categories');
  const listCard = h('div', { class: 'card' });
  main.append(h('div', { class: 'card' }, cardTitle('alert', 'Raise a grievance'),
    h('p', { class: 'muted small', text: 'Your complaint goes to the college administration. Ragging or harassment complaints are handled confidentially.' }),
    buildForm([
      { name: 'category', label: 'Category', type: 'select', required: true, options: categories.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
      { name: 'subject', label: 'Subject', required: true },
      { name: 'description', label: 'Describe the problem', type: 'textarea', required: true, full: true },
    ], {
      submitLabel: 'Submit grievance',
      onSubmit: async (d, form) => {
        const r = await api('/api/support/grievances', { method: 'POST', body: d });
        toast(`Submitted. Ticket ${r.ticket}`);
        form.reset();
        await load();
      },
    })), listCard);
  async function load() {
    listCard.replaceChildren(cardTitle('list', 'My tickets'), table([
      { label: 'Ticket', render: (g) => `GRV-${String(g.id).padStart(5, '0')}` }, { label: 'Date', render: (g) => fmtDate(g.created_at) },
      { label: 'Category', key: 'category' }, { label: 'Subject', key: 'subject' }, { label: 'Status', render: (g) => statusBadge(g.status) },
      { label: 'Response', render: (g) => h('span', { class: 'small', text: g.response || '-' }) },
    ], await api('/api/support/grievances/mine'), 'No tickets yet.'));
  }
  await load();
}

// ---- Printable ID card ----
export function idCard(st, me) {
  const year = Number(st.admission_year) || new Date().getFullYear();
  return h('div', { class: 'idcard' },
    h('div', { class: 'id-head' }, h('span', { class: 'logo', text: me.college_short || 'UU' }),
      h('div', null, h('strong', { text: me.college_name }), h('span', { text: 'Student Identity Card' }))),
    h('div', { class: 'id-body' },
      h('div', { class: 'id-photo' }, st.photo ? h('img', { src: st.photo, alt: '' }) : avatar(st.name).textContent),
      h('div', null, h('div', { class: 'id-name', text: st.name }), h('dl', null,
        h('dt', { text: 'Roll no' }), h('dd', { text: st.roll_no }),
        h('dt', { text: 'Course' }), h('dd', { text: st.class_name }),
        h('dt', { text: 'Dept' }), h('dd', { text: st.department || '-' }),
        h('dt', { text: 'DOB' }), h('dd', { text: st.dob ? fmtDate(st.dob) : '-' }),
        h('dt', { text: 'Blood' }), h('dd', { text: st.blood_group || '-' }),
        h('dt', { text: 'Emergency' }), h('dd', { text: st.guardian_phone || '-' })))),
    h('div', { class: 'id-foot' }, h('span', { text: `Valid till ${year + 3}` }), h('span', { text: 'If found, please return to the college office' })));
}

// ---- Grade card (one block per semester) ----
export function gradeCard(card, student, me) {
  if (!card.semesters.length) return h('div', { class: 'card empty', text: 'No result has been published yet.' });
  return h('div', null, card.semesters.map((sem) => h('div', { class: 'gradecard card' },
    h('div', { class: 'gc-head' }, h('span', { class: 'logo', text: me.college_short || 'UU' }),
      h('div', null, h('h2', { text: me.college_name }), h('div', { class: 'small', text: `Grade card · Semester ${sem.semester}${sem.published_at ? ` · Declared ${fmtDate(sem.published_at)}` : ' · Not published'}` }))),
    student && h('div', { class: 'gc-sum' }, h('span', null, 'Name: ', h('strong', { text: student.name })), h('span', null, 'Roll no: ', h('strong', { text: student.roll_no })), h('span', null, 'Course: ', h('strong', { text: student.class_name }))),
    h('br'),
    table([
      { label: 'Code', key: 'code' }, { label: 'Subject', key: 'name' }, { label: 'Credits', key: 'credits', class: 'num' },
      { label: 'Internal', key: 'internal', class: 'num' }, { label: 'External', key: 'external', class: 'num' }, { label: 'Total', key: 'total', class: 'num' },
      { label: 'Grade', render: (s) => h('strong', { class: s.grade === 'F' ? 'bad-text' : '', text: s.grade || '-' }) }, { label: 'Points', key: 'points', class: 'num' },
    ], sem.subjects),
    h('div', { class: 'gc-sum' },
      h('span', null, 'Credits: ', h('strong', { text: `${sem.earned} / ${sem.credits}` })),
      h('span', null, 'SGPA: ', h('strong', { text: sem.sgpa ?? 'Pending' })),
      h('span', null, 'Result: ', h('strong', { text: sem.sgpa == null ? 'Pending' : sem.backlogs ? `Back in ${sem.backlogs}` : 'Pass' }))))),
  h('div', { class: 'card gc-sum' }, h('span', null, 'CGPA: ', h('strong', { text: card.cgpa ?? '-' })), h('span', null, 'Equivalent %: ', h('strong', { text: card.percentage ?? '-' })),
    h('span', { class: 'muted small', text: '% = CGPA x 9.5' })));
}

export { icon, fmtDateTime };
