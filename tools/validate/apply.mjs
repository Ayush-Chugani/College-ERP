import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const dir = './supabase/migrations';
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync('tests/db/supabase-stub.ts', 'utf8').split('`')[1]); // Supabase auth schema / roles the migrations expect
let failed = false;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
  const t = Date.now();
  try { await db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8')); console.log('OK  ', f, Date.now() - t, 'ms'); }
  catch (e) { failed = true; console.log('FAIL', f, e.message); }
}
const q = async (s) => (await db.query(s)).rows;
console.log('tables', (await q("select count(*)::int n from pg_tables where schemaname='public'"))[0].n,
 'views', (await q("select count(*)::int n from pg_views where schemaname='public'"))[0].n,
 'triggers', (await q("select count(*)::int n from pg_trigger where not tgisinternal"))[0].n,
 'rls_on', (await q("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"))[0].n);
process.exit(failed ? 1 : 0);
