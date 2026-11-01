import { h, api, buildForm, icon } from './common.js';

const app = document.getElementById('app');
const info = await api('/api/public-info').catch(() => ({ college_name: 'College', college_short: 'UU', academic_session: '' }));
document.title = `${info.college_name} ERP - Log in`;

const error = h('div', { class: 'notice bad hidden', role: 'alert' });
const form = buildForm([
  { name: 'username', label: 'Username / Roll no', required: true, autocomplete: 'username', full: true },
  { name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password', full: true },
], {
  submitLabel: 'Log in',
  onSubmit: async (d) => {
    error.classList.add('hidden');
    try {
      const r = await api('/api/login', { method: 'POST', body: d });
      location.href = `/${r.role}`;
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
    }
  },
});

const feature = (ic, text) => h('li', null, icon(ic, 20), text);

app.append(h('div', { class: 'login-split' },
  h('section', { class: 'login-brand' },
    h('div', null,
      h('span', { class: 'logo', text: info.college_short || 'UU' }),
      h('h1', { text: info.college_name }),
      h('p', { text: `Campus ERP${info.academic_session ? ` · Session ${info.academic_session}` : ''}. One login for students, faculty and administration.` })),
    h('ul', null,
      feature('scan', 'Classroom camera attendance with face recognition'),
      feature('award', 'Results, grade cards, SGPA and CGPA'),
      feature('wallet', 'Fees, receipts and dues'),
      feature('library', 'Library, hostel and transport'),
      feature('clipboard', 'Assignments, leave and feedback')),
    h('p', { class: 'small', text: 'Forgot your password? Contact the college office.' })),
  h('section', { class: 'login-form' }, h('div', { class: 'card login-card' },
    h('h2', { text: 'Sign in' }),
    h('p', { class: 'muted', text: 'Use the username or roll number given by the college.' }),
    error, form))));
form.inputs.username.focus();
