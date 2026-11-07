// Shared helpers: API calls, DOM building, tables, forms, dialogs, charts, preloader, app shell.
import { icon } from './icons.js';

export { icon };

// ---- Preloader: the logo stays on screen for at least 1.5 s from page start ----
const PRELOAD_MS = 1500;
export function hidePreloader() {
  const el = document.getElementById('preloader');
  if (!el || el.classList.contains('done')) return;
  setTimeout(() => {
    el.classList.add('done');
    setTimeout(() => el.remove(), 400);
  }, Math.max(0, PRELOAD_MS - performance.now()));
}
setTimeout(hidePreloader, 8000); // never let it block the page

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
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  if (value !== undefined) el.value = value;
  return el;
}

export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const fmtDate = (s) => (s ? new Date(String(s).length === 10 ? `${s}T00:00:00` : s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtTime = (s) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const initials = (name) => String(name || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(dr|prof|mr|mrs|ms)\.?$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export const pctKind = (p) => (p == null ? '' : p >= 75 ? 'ok' : p >= 60 ? 'warn' : 'bad');

// ---- Toasts and dialogs ----
let toastBox;
export function toast(message, kind = '') {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${kind}`, text: message });
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6500 : 4000);
}
export const showError = (err) => toast(err?.message || String(err), 'error');

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
  return modal(h('div', null, title && h('h2', { text: title }), h('p', { class: 'pre', text: message })),
    [{ label: 'Cancel', value: false }, { label: ok, value: true, class: danger ? 'danger' : 'primary' }]).then(Boolean);
}

export function showSecret(title, label, secret) {
  return modal(h('div', null, h('h2', { text: title }), h('p', { class: 'muted', text: label }), h('div', { class: 'secret', text: secret }),
    h('p', { class: 'muted small', text: 'Shown only once. It must be changed at the first login.' })), [{ label: 'Done', value: true, class: 'primary' }]);
}

// Disables the clicked button while the async handler runs and reports errors.
export function busy(fn) {
  return async (e) => {
    const btn = e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn) btn.disabled = true;
    try { await fn(e); } catch (err) { showError(err); } finally { if (btn) btn.disabled = false; }
  };
}

// ---- Tables, forms ----
export function table(columns, rows, empty = 'Nothing here yet.') {
  if (!rows.length) return h('div', { class: 'empty', text: empty });
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.class || '', text: c.label })))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return h('td', { class: c.class || '' }, v == null || v === '' ? '-' : v);
    }))))));
}

// fields: [{ name, label, type, options: [{value,label}], required, full, placeholder, min, max, step, hint, default }]
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
  const form = h('form', null, grid, h('div', { class: 'form-actions' }, onCancel && h('button', { type: 'button', text: 'Cancel', onclick: onCancel }), submit));
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

export function selectEl(options, { value = '', placeholder = 'Choose...', onchange, label } = {}) {
  return h('select', { onchange, value: String(value), 'aria-label': label || placeholder }, h('option', { value: '', text: placeholder }),
    options.map((o) => h('option', { value: String(o.value), text: o.label })));
}

// ---- Visual blocks ----
export function statCard(iconName, label, value, sub, kind = '') {
  return h('div', { class: 'stat' }, h('div', { class: `stat-icon ${kind}` }, icon(iconName, 20)),
    h('div', null, h('div', { class: 'label', text: label }), h('div', { class: `value ${String(value ?? '').length > 8 ? 'long' : ''}`, text: value ?? '-' }), sub && h('div', { class: 'sub', text: sub })));
}

export function cardTitle(iconName, title, ...right) {
  return h('div', { class: 'between' }, h('div', { class: 'card-title' }, icon(iconName), h('h2', { text: title })), right.filter(Boolean).length ? h('div', { class: 'row' }, right) : null);
}

export function bars(rows) {
  if (!rows.length) return h('div', { class: 'empty', text: 'No data yet.' });
  return h('div', { class: 'bars' }, rows.map((r) => {
    const p = r.max ? (r.value / r.max) * 100 : 0;
    const fill = h('div', { class: `bar-fill ${pctKind(p)}` });
    fill.style.width = `${Math.max(0, Math.min(100, p))}%`;
    return h('div', { class: 'bar-row' }, h('span', { class: 'name', title: r.label, text: r.label }), h('div', { class: 'bar-track' }, fill), h('span', { class: 'num', text: r.max ? `${Math.round(p)}%` : '-' }));
  }));
}

export function columns(points) {
  if (!points.length) return h('div', { class: 'empty', text: 'No data yet.' });
  return h('div', { class: 'colchart' }, points.map((p) => {
    const bar = h('div', { class: 'colbar', title: `${p.label}: ${p.value}%` });
    bar.style.height = `${Math.max(1, p.value)}%`;
    return h('div', { class: 'col' }, h('span', { class: 'colval', text: `${p.value}%` }), bar, h('span', { class: 'collabel', text: p.label }));
  }));
}

// ---- Password page (shared) ----
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
        toast('Password changed', 'ok');
        if (me.must_change_pw) location.href = location.pathname;
      },
    })));
  };
}

// ---- Notifications bell (polled; cheap query, every 20 s) ----
function notificationsBell() {
  const dot = h('span', { class: 'dot hidden' });
  const btn = h('button', { class: 'icon-btn bell', 'aria-label': 'Notifications', title: 'Notifications' }, icon('bell'), dot);
  let panel = null;
  let last = null;
  // silent: the caller already told the user (e.g. right after submitting).
  async function refresh(silent = false) {
    try {
      const d = await api('/api/notifications');
      if (!silent && last && d.list[0] && d.list[0].id !== last && !d.list[0].read) toast(d.list[0].title, 'ok');
      last = d.list[0]?.id ?? last;
      dot.textContent = d.unread;
      dot.classList.toggle('hidden', !d.unread);
      if (panel) render(d);
    } catch { /* offline for a moment */ }
  }
  function render(d) {
    panel.replaceChildren(h('div', { class: 'head' }, h('strong', { text: 'Notifications' }),
      h('button', { class: 'sm', text: 'Mark all read', onclick: busy(async () => { await api('/api/notifications/read', { method: 'POST' }); await refresh(); }) })),
    d.list.length ? d.list.map((n) => h('a', { class: `notif ${n.read ? '' : 'unread'}`, href: n.link || '#', onclick: () => { api('/api/notifications/read', { method: 'POST', body: { id: n.id } }).then(refresh); close(); } },
      h('strong', { text: n.title }), h('span', { text: `${n.body || ''} · ${fmtDateTime(n.created_at)}` })))
      : h('div', { class: 'empty', text: 'No notifications.' }));
  }
  function close() { panel?.remove(); panel = null; }
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (panel) return close();
    panel = h('div', { class: 'notif-panel' });
    panel.addEventListener('click', (ev) => ev.stopPropagation());
    document.body.append(panel);
    render((await api('/api/notifications')));
  });
  document.addEventListener('click', close);
  refresh(true);
  setInterval(() => refresh(), 20000);
  return { el: btn, refresh };
}

// ---- App shell ----
// views: [{ id, label, icon, group, render(main, ctx) }]; roles: who may open this page.
export async function startApp(roles, views) {
  let me;
  try { me = await api('/api/me'); } catch { return; }
  if (!roles.includes(me.role)) { location.href = me.role === 'teacher' ? '/teacher' : '/admin'; return; }
  const all = [...views, { id: 'password', label: 'Change password', icon: 'key', group: 'Account', render: passwordView(me) }];
  const nav = h('nav', { 'aria-label': 'Main' });
  const main = h('main', { class: 'main' });
  const bell = notificationsBell();
  const roleName = { super_admin: 'Super admin', admin: 'Administrator', teacher: me.profile?.designation || 'Faculty' }[me.role];
  document.title = `${me.university_name} - ERP`;
  document.getElementById('app').replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#' }, h('img', { src: '/img/logo.png', alt: me.university_name })),
      nav,
      h('div', { class: 'me' }, h('span', { class: 'avatar', text: initials(me.name) }), h('div', null, h('strong', { text: me.name }), h('span', { text: roleName })))),
    h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'content' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
        h('span', { class: 'date', text: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }),
        h('span', { class: 'spacer' }), bell.el,
        h('button', { class: 'sm', onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/login'; } }, icon('logout', 16), 'Log out')),
      main)));

  const ctx = { me, go: (id) => { location.hash = id; }, refreshNotifications: bell.refresh };
  let current = all[0];
  function renderNav() {
    const groups = [];
    for (const v of all) {
      let g = groups.find((x) => x.name === (v.group || ''));
      if (!g) groups.push(g = { name: v.group || '', items: [] });
      g.items.push(v);
    }
    nav.replaceChildren(...groups.flatMap((g) => [g.name && h('div', { class: 'nav-title', text: g.name }),
      ...g.items.map((v) => h('a', { href: `#${v.id}`, class: v.id === current.id ? 'active' : '', 'aria-current': v.id === current.id ? 'page' : null }, icon(v.icon || 'list'), h('span', { text: v.label })))]));
  }

  let token = 0;
  async function route() {
    let id = location.hash.slice(1).split('/')[0] || all[0].id;
    if (me.must_change_pw) id = 'password';
    current = all.find((v) => v.id === id) || all[0];
    document.body.classList.remove('nav-open');
    renderNav();
    ctx.cleanup?.();
    ctx.cleanup = null;
    const mine = ++token;
    // A fresh element per visit: a slow page that finishes late writes into a detached node.
    const page = h('div', null, h('div', { class: 'page-head' }, h('div', null,
      h('div', { class: 'crumbs', text: [current.group, current.label].filter(Boolean).join(' / ') }), h('h1', { text: current.label }))));
    main.replaceChildren(page);
    window.scrollTo(0, 0);
    try { await current.render(page, ctx); } catch (err) {
      if (mine === token) page.append(h('div', { class: 'notice bad', text: err.message }));
    }
    hidePreloader();
  }
  window.addEventListener('hashchange', route);
  await route();
  return ctx;
}
