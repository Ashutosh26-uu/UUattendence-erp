// Shared helpers for every page: API calls, DOM building, tables, forms, dialogs, app shell.

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== '/api/login') {
    location.href = '/login';
    throw new Error('Please log in');
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['checked', 'disabled', 'selected', 'required', 'multiple'].includes(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) el.value = value;
  return el;
}

export const fmtDate = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : `${s.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtDateTime = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const pctText = (p) => (p == null ? '-' : `${p}%`);
export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function pctBadge(p) {
  if (p == null) return h('span', { class: 'badge', text: 'No classes yet' });
  return h('span', { class: `badge ${p >= 75 ? 'ok' : p >= 60 ? 'warn' : 'bad'}`, text: `${p}%` });
}

// ---- Toasts and dialogs ----
let toastBox;
export function toast(message, kind = 'ok') {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}`, text: message });
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

export function showError(err) { toast(err?.message || String(err), 'error'); }

export function modal(content, buttons) {
  return new Promise((resolve) => {
    const dlg = h('dialog', null, content, h('div', { class: 'form-actions' },
      buttons.map((b) => h('button', { class: b.class || '', text: b.label, onclick: () => { dlg.close(); resolve(b.value); } }))));
    dlg.addEventListener('cancel', () => resolve(undefined));
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmBox(message, { ok = 'Yes', danger = false, title } = {}) {
  return modal(h('div', null, title && h('h2', { text: title }), h('p', { class: 'pre', text: message })), [
    { label: 'Cancel', value: false },
    { label: ok, value: true, class: danger ? 'danger' : 'primary' },
  ]).then(Boolean);
}

export function showSecret(title, label, secret) {
  return modal(h('div', null, h('h2', { text: title }), h('p', { class: 'muted', text: label }), h('div', { class: 'secret', text: secret }),
    h('p', { class: 'muted small', text: 'It is shown only once. They must change it after logging in.' })), [{ label: 'Done', value: true, class: 'primary' }]);
}

// Wraps an async click handler: disables the button while it runs and reports errors.
export function busy(fn) {
  return async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try { await fn(e); } catch (err) { showError(err); } finally { if (btn) btn.disabled = false; }
  };
}

// ---- Tables ----
export function table(columns, rows, empty = 'Nothing here yet.') {
  if (!rows.length) return h('div', { class: 'empty', text: empty });
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.class || '', text: c.label })))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return h('td', { class: c.class || '' }, v == null || v === '' ? '-' : v);
    }))))));
}

// ---- Forms ----
// fields: [{ name, label, type, options: [{value,label}], required, full, placeholder, min, max, step }]
export function buildForm(fields, { values = {}, submitLabel = 'Save', onSubmit, onCancel } = {}) {
  const inputs = {};
  const grid = h('div', { class: 'form-grid' }, fields.map((f) => {
    const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
    const v = values[f.name] ?? f.default ?? '';
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name, required: f.required, value: v == null ? '' : String(v) },
        h('option', { value: '', text: f.placeholder || (f.required ? 'Choose...' : '(none)') }),
        f.options.map((o) => h('option', { value: String(o.value), text: o.label })));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, required: f.required, placeholder: f.placeholder, value: v });
    } else {
      input = h('input', { id, name: f.name, type: f.type || 'text', required: f.required, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, autocomplete: f.autocomplete || 'off', value: v });
    }
    inputs[f.name] = input;
    return h('div', { class: `field ${f.full ? 'full' : ''}` }, h('label', { for: id, text: f.label + (f.required ? ' *' : '') }), input, f.hint && h('span', { class: 'muted small', text: f.hint }));
  }));
  const submit = h('button', { class: 'primary', type: 'submit', text: submitLabel });
  const form = h('form', { novalidate: false }, grid, h('div', { class: 'form-actions' },
    onCancel && h('button', { type: 'button', text: 'Cancel', onclick: onCancel }), submit));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const [k, el] of Object.entries(inputs)) data[k] = el.value.trim() === '' ? null : el.value.trim();
    submit.disabled = true;
    try { await onSubmit(data, form); } catch (err) { showError(err); } finally { submit.disabled = false; }
  });
  form.inputs = inputs;
  return form;
}

export function selectEl(options, { value = '', placeholder = 'Choose...', onchange } = {}) {
  return h('select', { onchange, value: String(value) }, h('option', { value: '', text: placeholder }),
    options.map((o) => h('option', { value: String(o.value), text: o.label })));
}

// ---- Shared views ----
export function timetableView(entries, { showClass = false } = {}) {
  if (!entries.length) return h('div', { class: 'empty', text: 'No timetable has been set yet.' });
  const days = [...new Set(entries.map((e) => e.day))].sort();
  return h('div', null, days.map((d) => h('div', { class: 'tt-day' }, h('h3', { text: DAYS[d] }),
    table([
      { label: 'Time', render: (e) => `${e.start_time} - ${e.end_time}` },
      showClass && { label: 'Class', key: 'class_name' },
      { label: 'Subject', render: (e) => `${e.subject_code} ${e.subject_name}` },
      !showClass && { label: 'Teacher', key: 'teacher_name' },
      { label: 'Room', key: 'room' },
    ].filter(Boolean), entries.filter((e) => e.day === d)))));
}

export async function noticesView(main) {
  const list = await api('/api/notices');
  main.append(list.length ? h('div', null, list.map((n) => h('div', { class: 'card' },
    h('div', { class: 'between' }, h('h2', { text: n.title }), h('span', { class: 'muted small', text: `${fmtDate(n.created_at)}${n.author ? ` · ${n.author}` : ''}` })),
    h('p', { class: 'pre', text: n.body }))))
    : h('div', { class: 'card empty', text: 'No notices.' }));
}

function passwordView(me) {
  return async (main) => {
    if (me.must_change_pw) main.append(h('div', { class: 'notice warn', text: 'You are using a one-time password. Set your own password to continue.' }));
    main.append(h('div', { class: 'card' }, buildForm([
      { name: 'current', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'next', label: 'New password (min 8 characters)', type: 'password', required: true, autocomplete: 'new-password' },
      { name: 'again', label: 'New password again', type: 'password', required: true, autocomplete: 'new-password' },
    ], {
      submitLabel: 'Change password',
      onSubmit: async (d) => {
        if (d.next !== d.again) throw new Error('The two new passwords do not match');
        await api('/api/me/password', { method: 'POST', body: { current: d.current, next: d.next } });
        toast('Password changed');
        if (me.must_change_pw) location.href = location.pathname;
      },
    })));
  };
}

// ---- App shell ----
// views: [{ id, label, render(main, ctx) }]
export async function startApp(role, views) {
  const me = await api('/api/me');
  if (me.role !== role) { location.href = `/${me.role}`; return; }
  document.title = `${me.college_name} ERP`;
  const all = [...views, { id: 'password', label: 'Change password', render: passwordView(me) }];
  const nav = h('nav', { class: 'sidenav', 'aria-label': 'Main' });
  const main = h('main', { class: 'main' });
  const app = document.getElementById('app');
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('span', { class: 'brand', text: `${me.college_name} ERP` }), h('span', { class: 'spacer' }),
      h('span', { class: 'who', text: `${me.name} (${role})` }),
      h('button', { class: 'sm', text: 'Log out', onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/login'; } })),
    h('div', { class: 'layout' }, nav, main));

  const ctx = { me, go: (id) => { location.hash = id; } };
  let renderToken = 0;
  async function route() {
    let id = location.hash.slice(1).split('/')[0] || all[0].id;
    if (me.must_change_pw) id = 'password';
    const view = all.find((v) => v.id === id) || all[0];
    nav.replaceChildren(...all.map((v) => h('a', { href: `#${v.id}`, class: v.id === view.id ? 'active' : '', text: v.label, 'aria-current': v.id === view.id ? 'page' : null })));
    ctx.cleanup?.();
    ctx.cleanup = null;
    const token = ++renderToken;
    main.replaceChildren(h('h1', { text: view.title || view.label }));
    try { await view.render(main, ctx); } catch (err) {
      if (token === renderToken) main.append(h('div', { class: 'notice bad', text: err.message }));
    }
  }
  window.addEventListener('hashchange', route);
  route();
  return ctx;
}
