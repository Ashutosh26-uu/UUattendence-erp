import { h, api, buildForm } from './common.js';

const app = document.getElementById('app');
const info = await api('/api/public-info').catch(() => ({ college_name: 'College' }));
document.title = `${info.college_name} ERP - Log in`;

const error = h('div', { class: 'notice bad hidden', role: 'alert' });
const form = buildForm([
  { name: 'username', label: 'Username', required: true, autocomplete: 'username', full: true },
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

app.append(h('div', { class: 'login-wrap' }, h('div', { class: 'card login-card' },
  h('h1', { text: `${info.college_name} ERP` }),
  h('p', { class: 'muted', text: 'Log in with the username given by the college office.' }),
  error, form)));
form.inputs.username.focus();
