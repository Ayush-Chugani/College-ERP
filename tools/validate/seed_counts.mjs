// Seed equivalence (R-P1-20): counts the rows each plain INSERT ... VALUES statement of the MySQL source carries, applies the migrations to an
// embedded PostgreSQL and compares row counts per table. Statements of the form INSERT ... SELECT are reported, not counted.
//   node tools/validate/seed_counts.mjs [--json]
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const source = fs.readFileSync('SIMS-DatabaseWithoutLessonPlan.sql', 'utf8');

/** Number of top-level (...) tuples in a VALUES list starting at `from`, and where the statement ends. */
function countTuples(text, from) {
  let depth = 0, inStr = false, n = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === "'") { if (text[i + 1] === "'") i++; else inStr = false; }
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; }
    else if (c === '(') { if (depth === 0) n++; depth++; }
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) return { n, end: i };
  }
  return { n, end: text.length };
}

const expected = new Map();
const skipped = [];
const re = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*(?:\([^)]*\))?\s*(VALUES|SELECT)/gi;
for (let m; (m = re.exec(source)); ) {
  if (m[2].toUpperCase() === 'SELECT') { skipped.push(m[1]); continue; }
  const { n, end } = countTuples(source, m.index + m[0].length);
  expected.set(m[1], (expected.get(m[1]) ?? 0) + n);
  re.lastIndex = end;
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync('tests/db/supabase-stub.ts', 'utf8').split('`')[1]);
for (const f of fs.readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));

// Differences that are understood and expected. Anything else fails the check.
const EXPLAINED = {
  role: { source: 40, migrated: 39, why: "FINANCE_OFFICER is inserted twice in the source (lines 1669 and 2990); the unique key keeps the first row in MySQL and in PostgreSQL (ON CONFLICT DO NOTHING)." },
};
const rows = [];
for (const [table, n] of [...expected].sort()) {
  let got = null;
  try { got = Number((await db.query(`select count(*)::int n from public."${table}"`)).rows[0].n); } catch { got = null; }
  const ex = EXPLAINED[table];
  rows.push({ table, source: n, migrated: got, same: got === n, explained: !!ex && ex.source === n && ex.migrated === got, why: ex?.why });
}
const bad = rows.filter((r) => !r.same && !r.explained);
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, skipped }, null, 1));
else {
  const explained = rows.filter((r) => !r.same && r.explained);
  console.log(`${rows.length} seeded tables compared, ${rows.filter((r) => r.same).length} identical, ${explained.length} explained, ${bad.length} different, ${skipped.length} INSERT..SELECT statement(s) not counted${skipped.length ? ` (${[...new Set(skipped)].join(', ')})` : ''}`);
  for (const r of explained) console.log(`EXPLAINED ${r.table}: source ${r.source}, migrated ${r.migrated} - ${r.why}`);
  for (const r of bad) console.log(`DIFF ${r.table}: source ${r.source}, migrated ${r.migrated}`);
}
process.exit(bad.length ? 1 : 0);
