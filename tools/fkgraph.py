"""Dump the FK edge list of the public schema (read-only) to tools/rls/fk_edges.json.
build_rls.py derives anchors from it offline. Needs SUPABASE_DB_PASSWORD in .env.local (live project) or edit the DSN."""
import psycopg2, re, json, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pw = re.search(r'SUPABASE_DB_PASSWORD=(.*)', open(os.path.join(ROOT, '.env.local')).read()).group(1).strip()
c = psycopg2.connect(host='db.khqqfgqvwdxlqkncwtmh.supabase.co', user='postgres', password=pw, dbname='postgres', port=5432, sslmode='require')
cur = c.cursor()
cur.execute("""select c.relname, k.conname, a.attname, rc.relname, ra.attname
from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class rc on rc.oid=k.confrelid
join pg_namespace n on n.oid=c.relnamespace
join lateral unnest(k.conkey, k.confkey) with ordinality u(l,r,o) on true
join pg_attribute a on a.attrelid=k.conrelid and a.attnum=u.l
join pg_attribute ra on ra.attrelid=k.confrelid and ra.attnum=u.r
where k.contype='f' and n.nspname='public' order by c.relname,k.conname,u.o""")
fks = collections.defaultdict(lambda: collections.defaultdict(list))
for t, cn, col, pt, pcol in cur.fetchall():
    fks[t][(cn, pt)].append((col, pcol))
edges = {}
for t, d in fks.items():
    edges[t] = [dict(cols=[p[0] for p in pairs], parent=pt, pcols=[p[1] for p in pairs]) for (cn, pt), pairs in d.items()]
cur.execute("select tablename from pg_tables where schemaname='public' order by 1")
tables = [r[0] for r in cur.fetchall()]
cur.execute("select table_name, column_name from information_schema.columns where table_schema='public' order by table_name, ordinal_position")
columns = collections.defaultdict(list)
for t, col in cur.fetchall():
    columns[t].append(col)
json.dump(dict(tables=tables, edges=edges, columns=columns), open(os.path.join(ROOT, 'tools', 'rls', 'fk_edges.json'), 'w'), indent=0)
print('edges for', len(edges), 'tables;', sum(len(v) for v in edges.values()), 'fk edges')
