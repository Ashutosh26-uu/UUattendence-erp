// List / create / update / delete for simple master tables.
// `fields` maps column -> validator(value, body, req); only those columns are ever written.
const { query, one, audit } = require('./db');
const { HttpError, int } = require('./http');

function readFields(fields, body, req) {
  const data = {};
  for (const [col, validate] of Object.entries(fields)) data[col] = validate(body?.[col], body || {}, req);
  return data;
}

function crud(router, { path, table, fields, listSql, label, afterChange, check }) {
  router.get(path, async (req, res) => res.json(await query(listSql)));

  router.post(path, async (req, res) => {
    const data = readFields(fields, req.body, req);
    if (check) check(data);
    const cols = Object.keys(data);
    const r = await one(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, cols.map((c) => data[c]));
    audit(req.user.id, `${table}_created`, { id: r.id, ...data });
    afterChange?.(data);
    res.status(201).json({ id: r.id });
  });

  router.put(`${path}/:id`, async (req, res) => {
    const id = int(req.params.id, 'Id', { required: true });
    const data = readFields(fields, req.body, req);
    if (check) check(data);
    const cols = Object.keys(data);
    const r = await one(`UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`, [id, ...cols.map((c) => data[c])]);
    if (!r) throw new HttpError(404, `${label} not found`);
    audit(req.user.id, `${table}_updated`, { id, ...data });
    afterChange?.(data);
    res.json({ ok: true });
  });

  router.delete(`${path}/:id`, async (req, res) => {
    const id = int(req.params.id, 'Id', { required: true });
    const r = await one(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    if (!r) throw new HttpError(404, `${label} not found`);
    audit(req.user.id, `${table}_deleted`, { id });
    afterChange?.({});
    res.json({ ok: true });
  });
}

module.exports = { crud };
