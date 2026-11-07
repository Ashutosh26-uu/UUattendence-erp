import { h, api, icon, hidePreloader } from './common.js';

const ROLES = [
  { id: 'teacher', label: 'Teacher', icon: 'teacher', user: 'Employee ID or username', hint: 'Use the employee ID given by the university.' },
  { id: 'admin', label: 'Admin', icon: 'building', user: 'Admin username', hint: 'University office administrators.' },
  { id: 'super_admin', label: 'Super Admin', icon: 'shield', user: 'Super admin username', hint: 'System owner: admins, settings and monitoring.' },
];
let role = ROLES[0];

const info = await api('/api/public-info').catch(() => ({ university_name: 'United University, Prayagraj' }));
document.title = `${info.university_name} - ERP Login`;

const userInput = h('input', { id: 'u', name: 'username', autocomplete: 'username', required: true });
const passInput = h('input', { id: 'p', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
const userLabel = h('label', { for: 'u' });
const hint = h('p', { class: 'muted small' });
const error = h('div', { class: 'notice bad hidden', role: 'alert' });
const submit = h('button', { class: 'primary', type: 'submit' });
const tabs = h('div', { class: 'role-tabs', role: 'tablist', 'aria-label': 'Login as' });

function selectRole(r) {
  role = r;
  tabs.replaceChildren(...ROLES.map((x) => h('button', {
    type: 'button', role: 'tab', class: x.id === r.id ? 'active' : '', 'aria-selected': String(x.id === r.id), onclick: () => selectRole(x),
  }, icon(x.icon, 18), x.label)));
  userLabel.textContent = r.user;
  hint.textContent = r.hint;
  submit.textContent = `Sign in as ${r.label}`;
  error.classList.add('hidden');
}

const form = h('form', null,
  h('div', { class: 'field' }, userLabel, userInput),
  h('div', { class: 'field' }, h('label', { for: 'p', text: 'Password' }), passInput),
  error, submit);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submit.disabled = true;
  error.classList.add('hidden');
  try {
    const r = await api('/api/login', { method: 'POST', body: { username: userInput.value.trim(), password: passInput.value, role: role.id } });
    location.href = r.role === 'teacher' ? '/teacher' : '/admin';
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('hidden');
    submit.disabled = false;
  }
});

const feature = (ic, text) => h('li', null, icon(ic, 20), text);
document.getElementById('app').append(h('div', { class: 'login-page' },
  h('section', { class: 'login-hero' },
    h('div', null,
      h('div', { class: 'logo-plate' }, h('img', { src: '/img/logo.png', alt: info.university_name })),
      h('h1', { text: 'Smart Attendance and Academic ERP' }),
      h('p', { text: 'Classroom cameras recognise students in the first five minutes of every lecture. Teachers confirm, correct and submit in one place.' })),
    h('ul', null,
      feature('scan', 'Face-recognition attendance from the classroom camera'),
      feature('users', 'Registered strength vs students actually in class'),
      feature('checkbox', 'Manual marking for anyone the camera missed'),
      feature('activity', 'Built for thousands of users at once')),
    h('p', { class: 'small', text: `© ${new Date().getFullYear()} ${info.university_name}` })),
  h('section', { class: 'login-side' }, h('div', { class: 'login-card' },
    h('img', { class: 'logo-small', src: '/img/logo.png', alt: info.university_name }),
    h('h2', { text: 'Sign in to ERP' }),
    h('p', { class: 'muted', text: 'Choose who you are, then enter your login details.' }),
    tabs, hint, form,
    h('p', { class: 'muted small', text: 'Forgot your password? Contact the university ERP office.' })))));
selectRole(ROLES[0]);
userInput.focus();
hidePreloader();
