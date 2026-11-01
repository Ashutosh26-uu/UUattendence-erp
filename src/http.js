// Small request helpers shared by the routes: errors and input validation.

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function str(value, label, { required = false, max = 200 } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max})`);
  return s;
}

function int(value, label, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}`);
  return n;
}

function num(value, label, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be a number from ${min} to ${max}`);
  return n;
}

function date(value, label, { required = false } = {}) {
  const s = str(value, label, { required, max: 10 });
  if (s == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
  return s;
}

function time(value, label, { required = false } = {}) {
  const s = str(value, label, { required, max: 5 });
  if (s == null) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HttpError(400, `${label} must be a time (HH:MM)`);
  return s;
}

function oneOf(value, label, options, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (!options.includes(value)) throw new HttpError(400, `${label} must be one of: ${options.join(', ')}`);
  return value;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function csv(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

module.exports = { HttpError, str, int, num, date, time, oneOf, today, csv };
