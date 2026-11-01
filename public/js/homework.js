// Assignments: teacher side (post, see submissions, grade) and student side (submit).
import { h, api, toast, busy, confirmBox, table, buildForm, fmtDate, fmtDateTime, cardTitle, icon } from './common.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function homeworkTeacher(main) {
  const pairs = (await api('/api/teacher/assignments')).map((a) => ({ value: `${a.class_id}:${a.subject_id}`, label: `${a.class_name} - ${a.subject_code} ${a.subject_name}` }));
  const detail = h('div', { class: 'card hidden' });
  const listCard = h('div', { class: 'card' });
  main.append(h('div', { class: 'card' }, cardTitle('clipboard', 'Post an assignment'), buildForm([
    { name: 'pair', label: 'Class and subject', type: 'select', required: true, options: pairs },
    { name: 'title', label: 'Title', required: true },
    { name: 'due_date', label: 'Due date', type: 'date', required: true },
    { name: 'max_marks', label: 'Max marks', type: 'number', min: 1, required: true, default: 10 },
    { name: 'description', label: 'Instructions', type: 'textarea', full: true },
  ], {
    submitLabel: 'Post',
    onSubmit: async (d, form) => {
      const [class_id, subject_id] = d.pair.split(':');
      await api('/api/homework', { method: 'POST', body: { ...d, class_id, subject_id } });
      toast('Assignment posted');
      form.reset();
      await load();
    },
  })), detail, listCard);

  async function open(hw) {
    const d = await api(`/api/homework/${hw.id}/submissions`);
    const submitted = d.students.filter((s) => s.submitted_at);
    detail.replaceChildren(cardTitle('clipboard', `${hw.title} · ${hw.class_name}`, h('button', { class: 'sm', text: 'Close', onclick: () => detail.classList.add('hidden') })),
      h('p', { class: 'muted', text: `Due ${fmtDate(hw.due_date)} · out of ${hw.max_marks} · ${submitted.length} of ${d.students.length} submitted` }),
      table([
        { label: 'Roll no', key: 'roll_no' }, { label: 'Name', key: 'name' },
        { label: 'Submitted', render: (s) => (s.submitted_at ? h('div', null, fmtDateTime(s.submitted_at), s.late ? h('span', { class: 'badge warn', text: 'late' }) : null) : h('span', { class: 'badge bad', text: 'Not submitted' })) },
        { label: 'Answer', render: (s) => h('div', null, s.answer && h('div', { class: 'small pre', text: s.answer.length > 160 ? `${s.answer.slice(0, 160)}...` : s.answer, title: s.answer }),
          s.file_name && h('a', { href: `/api/homework/${hw.id}/file/${s.id}`, class: 'small', text: s.file_name })) },
        {
          label: 'Grade', render: (s) => {
            if (!s.submitted_at) return '-';
            const marks = h('input', { class: 'marks', type: 'number', min: 0, max: hw.max_marks, step: '0.5', value: s.marks ?? '', 'aria-label': `Marks for ${s.name}` });
            const fb = h('input', { placeholder: 'Feedback', value: s.feedback ?? '', 'aria-label': `Feedback for ${s.name}` });
            return h('div', { class: 'row' }, marks, fb, h('button', {
              class: 'sm primary', text: 'Save', onclick: busy(async () => {
                await api(`/api/homework/${hw.id}/submissions/${s.id}`, { method: 'PUT', body: { marks: marks.value, feedback: fb.value } });
                toast(`Graded ${s.name}`);
              }),
            }));
          },
        },
      ], d.students));
    detail.classList.remove('hidden');
    detail.scrollIntoView({ behavior: 'smooth' });
  }

  async function load() {
    listCard.replaceChildren(cardTitle('list', 'My assignments'), table([
      { label: 'Due', render: (x) => h('span', { class: x.due_date < today() ? 'muted' : '', text: fmtDate(x.due_date) }) },
      { label: 'Title', key: 'title' }, { label: 'Class', key: 'class_name' }, { label: 'Subject', key: 'subject_code' },
      { label: 'Submitted', class: 'num', render: (x) => `${x.submitted} / ${x.class_size}` },
      { label: 'To grade', class: 'num', render: (x) => (x.to_grade ? h('span', { class: 'badge warn', text: x.to_grade }) : '0') },
      {
        label: '', class: 'actions', render: (x) => h('span', { class: 'row end' },
          h('button', { class: 'sm primary', text: 'Submissions', onclick: busy(() => open(x)) }),
          h('button', { class: 'sm danger', text: 'Delete', onclick: busy(async () => { if (!await confirmBox(`Delete "${x.title}" and all submissions?`, { ok: 'Delete', danger: true })) return; await api(`/api/homework/${x.id}`, { method: 'DELETE' }); await load(); }) })),
      },
    ], await api('/api/homework/teacher'), 'No assignments yet.'));
  }
  await load();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export async function homeworkStudent(main, ctx) {
  const box = h('div');
  main.append(box);
  async function load() {
    const list = await api('/api/homework/student');
    const pending = list.filter((x) => !x.submitted_at);
    box.replaceChildren(
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-icon warn' }, icon('clipboard', 20)), h('div', null, h('div', { class: 'label', text: 'Pending' }), h('div', { class: 'value', text: pending.length }))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-icon ok' }, icon('check', 20)), h('div', null, h('div', { class: 'label', text: 'Submitted' }), h('div', { class: 'value', text: list.length - pending.length })))),
      ...(list.length ? list.map(card) : [h('div', { class: 'card empty', text: 'No assignments yet.' })]));
  }

  function card(x) {
    const late = !x.submitted_at && x.due_date < today();
    const status = x.marks != null ? h('span', { class: 'badge ok', text: `Graded ${x.marks}/${x.max_marks}` })
      : x.submitted_at ? h('span', { class: 'badge primary', text: 'Submitted' })
        : h('span', { class: `badge ${late ? 'bad' : 'warn'}`, text: late ? 'Overdue' : 'Pending' });
    const c = h('div', { class: 'card' },
      h('div', { class: 'between' }, h('div', null, h('h2', { text: x.title }), h('div', { class: 'small muted', text: `${x.subject_code} ${x.subject_name} · ${x.teacher_name} · due ${fmtDate(x.due_date)} · ${x.max_marks} marks` })), status),
      x.description && h('p', { class: 'pre', text: x.description }),
      x.submitted_at && h('p', { class: 'small muted' }, `Submitted ${fmtDateTime(x.submitted_at)}`, x.file_name ? ' · ' : '', x.file_name && h('a', { href: `/api/homework/${x.id}/file/${ctx.me.id}`, text: x.file_name })),
      x.feedback && h('div', { class: 'notice info', text: `Teacher's feedback: ${x.feedback}` }));
    if (x.marks == null) {
      const form = buildForm([
        { name: 'answer', label: 'Your answer', type: 'textarea', full: true },
        { name: 'file', label: 'Attach file (PDF, Word, PPT, JPG, PNG; max 2 MB)', type: 'file', full: true },
      ], {
        values: { answer: x.answer || '' },
        submitLabel: x.submitted_at ? 'Submit again' : 'Submit',
        onSubmit: async (d, f) => {
          const file = f.inputs.file.files[0];
          if (file && file.size > 2 * 1024 * 1024) throw new Error('File must be under 2 MB');
          const body = { answer: d.answer };
          if (file) body.file = { name: file.name, type: file.type, data: await readFile(file) };
          await api(`/api/homework/${x.id}/submit`, { method: 'POST', body });
          toast('Submitted');
          await load();
        },
      });
      c.append(form);
    }
    return c;
  }
  await load();
}
