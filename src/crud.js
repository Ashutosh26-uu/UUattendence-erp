// List / create / update / delete for simple master tables.
// `fields` maps column -> validator(value, body) so only whitelisted columns are written.
const { one, all, run, audit } = require('./db');
const { HttpError, int } = require('./http');

function readFields(fields, body, req) {
  const data = {};
  for (const [col, validate] of Object.entries(fields)) data[col] = validate(body?.[col], body || {}, req);
  return data;
}

function crud(router, { path, table, fields, listSql, label, afterValidate }) {
  router.get(path, (req, res) => res.json(all(listSql)));

  router.post(path, (req, res) => {
    const data = readFields(fields, req.body, req);
    if (afterValidate) afterValidate(data);
    const cols = Object.keys(data);
    const r = run(`INSERT INTO ${table}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => data[c]));
    audit(req.user.id, `${table}_created`, { id: Number(r.lastInsertRowid), ...data });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  router.put(`${path}/:id`, (req, res) => {
    const id = int(req.params.id, 'Id', { required: true });
    if (!one(`SELECT 1 FROM ${table} WHERE id = ?`, id)) throw new HttpError(404, `${label} not found`);
    const data = readFields(fields, req.body, req);
    if (afterValidate) afterValidate(data);
    const cols = Object.keys(data);
    run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => data[c]), id);
    audit(req.user.id, `${table}_updated`, { id, ...data });
    res.json({ ok: true });
  });

  router.delete(`${path}/:id`, (req, res) => {
    const id = int(req.params.id, 'Id', { required: true });
    const r = run(`DELETE FROM ${table} WHERE id = ?`, id);
    if (!r.changes) throw new HttpError(404, `${label} not found`);
    audit(req.user.id, `${table}_deleted`, { id });
    res.json({ ok: true });
  });
}

module.exports = { crud };
