// Shared helpers for every page: API calls, DOM building, tables, forms, dialogs, charts, app shell.
import { icon } from './icons.js';

export { icon };

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

// ---- Visual building blocks ----
const initials = (name) => String(name || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function avatar(name, photo, cls = '') {
  return h('span', { class: `avatar ${cls}` }, photo ? h('img', { src: photo, alt: '' }) : initials(name));
}

export function statCard(iconName, label, value, sub, kind = '') {
  return h('div', { class: 'stat' }, h('div', { class: `stat-icon ${kind}` }, icon(iconName, 20)),
    h('div', null, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value ?? '-' }), sub && h('div', { class: 'sub', text: sub })));
}

export function cardTitle(iconName, title, ...right) {
  return h('div', { class: 'between' }, h('div', { class: 'card-title' }, icon(iconName), h('h2', { text: title })), right.length ? h('div', { class: 'row' }, right) : null);
}

const kindFor = (p) => (p == null ? '' : p >= 75 ? 'ok' : p >= 60 ? 'warn' : 'bad');

// Ring chart for one percentage.
export function donut(pct, label, kind = kindFor(pct)) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  const circle = (cls, dash) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '21'); c.setAttribute('cy', '21'); c.setAttribute('r', '15.915');
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5'); c.setAttribute('class', cls);
    if (dash != null) { c.setAttribute('stroke-dasharray', `${dash} ${100 - dash}`); c.setAttribute('stroke-linecap', 'round'); }
    return c;
  };
  svg.append(circle('track'));
  if (pct) svg.append(circle(`val ${kind}`, Math.max(0, Math.min(100, pct))));
  return h('div', { class: 'donut' }, svg, h('div', { class: 'center' }, h('div', null, h('strong', { text: pct == null ? '-' : `${Math.round(pct)}%` }), h('span', { text: label }))));
}

// Horizontal bars: rows [{ label, value, max, text }]
export function bars(rows, { pctKind = false } = {}) {
  if (!rows.length) return h('div', { class: 'empty', text: 'No data yet.' });
  return h('div', { class: 'bars' }, rows.map((r) => {
    const p = r.max ? (r.value / r.max) * 100 : 0;
    const fill = h('div', { class: `bar-fill ${pctKind ? kindFor(p) : ''}` });
    fill.style.width = `${Math.max(0, Math.min(100, p))}%`;
    return h('div', { class: 'bar-row' }, h('span', { class: 'name', title: r.label, text: r.label }), h('div', { class: 'bar-track' }, fill), h('span', { class: 'num', text: r.text ?? r.value }));
  }));
}

// Vertical columns: points [{ label, value, text }], value 0..max
export function columns(points, max = 100) {
  if (!points.length) return h('div', { class: 'empty', text: 'No data yet.' });
  return h('div', { class: 'colchart' }, points.map((p) => {
    const bar = h('div', { class: 'colbar', title: `${p.label}: ${p.text ?? p.value}` });
    bar.style.height = `${Math.max(1, (p.value / (max || 1)) * 100)}%`;
    return h('div', { class: 'col' }, h('span', { class: 'colval', text: p.text ?? p.value }), bar, h('span', { class: 'collabel', text: p.label }));
  }));
}

export function dateChip(d) {
  const dt = new Date(`${d}T00:00:00`);
  return h('div', { class: 'date-chip' }, h('strong', { text: dt.getDate() }), h('span', { text: dt.toLocaleString('en', { month: 'short' }) }));
}

export function printButton(label = 'Print') {
  return h('button', { class: 'no-print', onclick: () => window.print() }, icon('printer', 16), label);
}

// Generic list + add/edit form for one master table (admin pages).
export function crudView({ endpoint, columns: cols, fields, intro, toValues, onCreated, rowActions, filter, canDelete = true, extra }) {
  return async (main) => {
    const fieldList = await fields();
    const formCard = h('div', { class: 'card hidden' });
    const listCard = h('div', { class: 'card' });
    let filterEl = null;
    if (filter) filterEl = selectEl(await filter.options(), { placeholder: filter.placeholder, onchange: () => load() });
    main.append(
      h('div', { class: 'between' }, h('p', { class: 'muted', text: intro || '' }),
        h('div', { class: 'row' }, filterEl, extra?.(load), h('button', { class: 'primary', text: 'Add new', onclick: () => openForm(null) }))),
      formCard, listCard);

    function openForm(row) {
      formCard.replaceChildren(h('h2', { text: row ? 'Edit' : 'Add new' }), buildForm(fieldList.filter((f) => !(row && f.createOnly)), {
        values: row ? (toValues ? toValues(row) : row) : (filterEl?.value ? { [filter.param]: filterEl.value } : {}),
        submitLabel: row ? 'Save changes' : 'Add',
        onCancel: () => formCard.classList.add('hidden'),
        onSubmit: async (d) => {
          if (row) {
            await api(`${endpoint}/${row.id}`, { method: 'PUT', body: d });
            toast('Saved');
          } else {
            const r = await api(endpoint, { method: 'POST', body: d });
            toast('Added');
            if (onCreated) await onCreated(r, d);
          }
          formCard.classList.add('hidden');
          await load();
        },
      }));
      formCard.classList.remove('hidden');
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function load() {
      const rows = await api(filterEl?.value ? `${endpoint}?${filter.param}=${filterEl.value}` : endpoint);
      listCard.replaceChildren(table([...cols, {
        label: '', class: 'actions', render: (r) => h('span', { class: 'row end' },
          h('button', { class: 'sm', text: 'Edit', onclick: () => openForm(r) }),
          rowActions?.(r, load),
          canDelete && h('button', {
            class: 'sm danger', text: 'Delete', onclick: busy(async () => {
              if (!await confirmBox('Delete this record?', { ok: 'Delete', danger: true })) return;
              await api(`${endpoint}/${r.id}`, { method: 'DELETE' });
              toast('Deleted');
              await load();
            }),
          })),
      }], rows));
    }
    await load();
  };
}

// ---- App shell ----
// views: [{ id, label, icon, group, render(main, ctx), badge?: () => number }]
export async function startApp(role, views) {
  const me = await api('/api/me');
  if (me.role !== role) { location.href = `/${me.role}`; return; }
  document.title = `${me.college_name} ERP`;
  const all = [...views, { id: 'password', label: 'Change password', icon: 'key', group: 'Account', render: passwordView(me) }];
  const nav = h('nav', { class: 'sidenav', 'aria-label': 'Main' });
  const main = h('main', { class: 'main' });
  const photo = me.profile?.photo;
  const logout = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/login'; };
  document.getElementById('app').replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'menu-btn icon-btn', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
      h('span', { class: 'logo', text: me.college_short || 'UU' }),
      h('div', { class: 'brand-text' }, h('strong', { text: me.college_name }), h('span', { text: 'Campus ERP' })),
      h('span', { class: 'spacer' }),
      h('span', { class: 'session-pill', text: `Session ${me.academic_session}` }),
      h('a', { class: 'btn icon-btn', href: '#notices', title: 'Notices', 'aria-label': 'Notices' }, icon('bell')),
      h('div', { class: 'user-chip' }, avatar(me.name, photo), h('div', { class: 'who' }, h('strong', { text: me.name }), h('span', { text: me.profile?.roll_no ? `${role} · ${me.profile.roll_no}` : role })),
        h('button', { class: 'icon-btn', title: 'Log out', 'aria-label': 'Log out', onclick: logout }, icon('logout')))),
    h('div', { class: 'layout' }, nav, h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }), main));

  const ctx = { me, go: (id) => { location.hash = id; }, refreshNav: () => renderNav() };
  let current = all[0];
  const badges = {};

  function renderNav() {
    const groups = [];
    for (const v of all) {
      let g = groups.find((x) => x.name === (v.group || ''));
      if (!g) groups.push(g = { name: v.group || '', items: [] });
      g.items.push(v);
    }
    nav.replaceChildren(...groups.map((g) => h('div', { class: 'nav-group' }, g.name && h('div', { class: 'nav-group-title', text: g.name }),
      g.items.map((v) => h('a', { href: `#${v.id}`, class: v.id === current.id ? 'active' : '', 'aria-current': v.id === current.id ? 'page' : null },
        icon(v.icon || 'list'), h('span', { text: v.label }), badges[v.id] ? h('span', { class: 'count', text: badges[v.id] }) : null)))));
  }

  // Counters next to menu items (pending leaves, open tickets, ...).
  ctx.setBadge = (id, n) => { badges[id] = n || 0; renderNav(); };

  let renderToken = 0;
  async function route() {
    let id = location.hash.slice(1).split('/')[0] || all[0].id;
    if (me.must_change_pw) id = 'password';
    current = all.find((v) => v.id === id) || all[0];
    document.body.classList.remove('nav-open');
    renderNav();
    ctx.cleanup?.();
    ctx.cleanup = null;
    const token = ++renderToken;
    // Each visit renders into its own element, so a slow page that finishes after the
    // user has moved on writes into a detached element instead of the new page.
    const page = h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null,
      h('div', { class: 'crumbs', text: [current.group, current.label].filter(Boolean).join(' / ') }), h('h1', { text: current.title || current.label }))));
    main.replaceChildren(page);
    try { await current.render(page, ctx); } catch (err) {
      if (token === renderToken) page.append(h('div', { class: 'notice bad', text: err.message }));
    }
  }
  window.addEventListener('hashchange', route);
  route();
  return ctx;
}
