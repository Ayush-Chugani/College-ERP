// Inspect the schema as built by the local migrations (embedded Postgres; no network). Usage: node tools/validate/inspect.mjs "<module codes comma separated>" 
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const stub = fs.readFileSync('tests/db/supabase-stub.ts', 'utf8').split('`')[1];
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(stub);
for (const f of fs.readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) await db.exec(fs.readFileSync('supabase/migrations/' + f, 'utf8'));
const mods = (process.argv[2] || '').split(',');
const map = JSON.parse(fs.readFileSync('tools/rls/table_module.json', 'utf8'));
const tabs = Object.entries(map).filter(([, m]) => mods.includes(m)).map(([t]) => t).sort();
console.log('TABLES', tabs.join(' '));
const q = async (s, p) => (await db.query(s, p)).rows;
for (const t of tabs) {
  console.log('==', t);
  for (const r of await q("select column_name c, coalesce(domain_name,data_type) t, is_nullable n, column_default d, character_maximum_length l, numeric_precision p, numeric_scale s from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t]))
    console.log('  ', r.c, r.t, r.l ?? '', r.t === 'numeric' ? `(${r.p},${r.s})` : '', r.n === 'YES' ? 'NULL' : 'NN', (r.d ?? '').slice(0, 24));
}
for (const r of await q("select c.relname t, k.conname n, pg_get_constraintdef(k.oid) d from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname = any($1) and k.contype in ('c','u','f') and k.conname not like 'enum_%' order by 1,2", [tabs])) console.log(r.t, r.n, r.d.slice(0, 230));
for (const r of await q("select c.relname t, pg_get_constraintdef(k.oid) d from pg_constraint k join pg_class c on c.oid=k.conrelid where k.conname like 'enum_%' and c.relname = any($1)", [tabs])) console.log('ENUM', r.t, r.d.slice(0, 230));
const codes = mods.map((m) => `'${m}.ALL.%'`).join(' or p.permission_code like ');
for (const r of await q(`select split_part(p.permission_code,'.',1) m, ro.role_code, ro.role_level, string_agg(split_part(p.permission_code,'.',3),',' order by p.permission_code) a from role ro join role_permission rp using(role_id) join permission p using(permission_id) where p.permission_code like ${codes} group by 1,2,3 order by 1,3,2`)) console.log('PERM', r.m, r.role_code, r.role_level, r.a);
for (const t of tabs) console.log('ROWS', t, (await q(`select count(*)::int n from public."${t}"`))[0].n);
