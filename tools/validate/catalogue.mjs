import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const dir = './supabase/migrations';
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync('tests/db/supabase-stub.ts', 'utf8').split('`')[1]); // Supabase auth schema / roles the migrations expect
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8'));
const q = async (s) => (await db.query(s)).rows;
const out = {
  columns: await q("select table_name t, column_name c from information_schema.columns where table_schema='public' and table_name in (select tablename from pg_tables where schemaname='public')"),
  cons: await q("select c.relname t, k.contype ty, k.conname n from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and k.contype in ('p','f','u','c')"),
  indexes: await q("select tablename t, indexname n from pg_indexes where schemaname='public'"),
  views: await q("select viewname v from pg_views where schemaname='public'"),
  triggers: await q("select tgname n, c.relname t from pg_trigger g join pg_class c on c.oid=g.tgrelid where not g.tgisinternal"),
  seed: Object.fromEntries(await Promise.all((await q("select tablename t from pg_tables where schemaname='public'")).map(async r => [r.t, (await q(`select count(*)::int n from public."${r.t}"`))[0].n]))),
};
fs.writeFileSync('./tools/work/pg_catalogue.json', JSON.stringify(out));
console.log('catalogue written', out.columns.length, out.cons.length, out.indexes.length);
