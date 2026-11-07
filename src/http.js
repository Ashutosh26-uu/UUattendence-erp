// Request helpers: errors, input validation, CSV.

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const blank = (v) => v == null || String(v).trim() === '';

function str(v, label, { required = false, max = 200 } = {}) {
  if (blank(v)) { if (required) throw new HttpError(400, `${label} is required`); return null; }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max})`);
  return s;
}

function int(v, label, { required = false, min = -2147483648, max = 2147483647 } = {}) {
  if (blank(v)) { if (required) throw new HttpError(400, `${label} is required`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
  return n;
}

function num(v, label, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (blank(v)) { if (required) throw new HttpError(400, `${label} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be a number from ${min} to ${max}`);
  return n;
}

function date(v, label, { required = false } = {}) {
  const s = str(v, label, { required, max: 10 });
  if (s != null && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
  return s;
}

function time(v, label, { required = false } = {}) {
  const s = str(v, label, { required, max: 8 });
  if (s != null && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s)) throw new HttpError(400, `${label} must be a time (HH:MM)`);
  return s && s.slice(0, 5);
}

function oneOf(v, label, options, { required = false } = {}) {
  if (blank(v)) { if (required) throw new HttpError(400, `${label} is required`); return null; }
  if (!options.includes(v)) throw new HttpError(400, `${label} must be one of: ${options.join(', ')}`);
  return v;
}

// Local calendar date (the university's timezone is the server's timezone; set TZ=Asia/Kolkata).
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const isoDay = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };

function csv(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

function sendCsv(res, filename, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`);
  res.send(`﻿${csv(rows)}`);
}

module.exports = { HttpError, str, int, num, date, time, oneOf, today, isoDay, csv, sendCsv };
