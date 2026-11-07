// Builds assets/empty-pgdata.tar.gz: a freshly initialised embedded PostgreSQL (PGlite) data
// directory. Starting from it instead of running initdb cuts first-start memory from ~550 MB to
// ~150 MB, which keeps the app inside small hosts (Render free: 512 MB).
// Re-run after upgrading @electric-sql/pglite:  node scripts/make-empty-db.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-empty-'));
const pg = new PGlite(dir);
await pg.waitReady;
await pg.query('SELECT 1');
const blob = await pg.dumpDataDir('gzip');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'empty-pgdata.tar.gz');
fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
await pg.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
