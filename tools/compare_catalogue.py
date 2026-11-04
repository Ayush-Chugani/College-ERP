"""Compare MySQL source constraints/indexes/views/triggers/seed against the Postgres catalogue produced by tools/validate/catalogue.mjs.
Writes tools/work/catalogue_comparison.json and prints a summary. Run translate.py + build_migrations.py + catalogue.mjs first."""
import json, re, sys, collections
sys.path.insert(0, r'D:\Sims_2\tools')
import translate as T

src = re.sub(r'(?m)^\s*--.*$', '', T.text)  # drop full-line comments
pg = json.load(open(r'D:\Sims_2\tools\work\pg_catalogue.json'))
stmts = json.load(open(r'D:\Sims_2\tools\work\pg_statements.json'))

counts = collections.defaultdict(lambda: collections.Counter())
named = collections.defaultdict(dict)  # table -> {name: type}
for m in re.finditer(r'^CREATE TABLE (\w+) \((.*?)\)\s*ENGINE', src, re.M | re.S):
    tbl = m.group(1)
    for ent in T.split_top(m.group(2)):
        u = ent.upper()
        mn = re.match(r'CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)', ent, re.I)
        head = re.match(r'(\w+)', ent).group(1).upper()
        if mn:
            ty = {'PRIMARY KEY': 'p', 'UNIQUE': 'u', 'FOREIGN KEY': 'f', 'CHECK': 'c'}[mn.group(2).upper()]
            named[tbl][mn.group(1)] = ty
            counts[tbl][ty] += 1
        elif head == 'PRIMARY':
            counts[tbl]['p'] += 1
        elif head == 'UNIQUE':
            counts[tbl]['u'] += 1
        elif head not in ('FOREIGN', 'CHECK', 'KEY', 'INDEX'):
            if re.search(r'\bPRIMARY KEY\b', ent, re.I):
                counts[tbl]['p'] += 1
            if re.search(r'\bUNIQUE\b', ent, re.I):
                counts[tbl]['u'] += 1
            if re.search(r'\bREFERENCES\b', ent, re.I):
                counts[tbl]['f'] += 1
for m in re.finditer(r'^ALTER TABLE (\w+)\s+ADD CONSTRAINT (\w+)\s+FOREIGN KEY', src, re.M):
    named[m.group(1)][m.group(2)] = 'f'
    counts[m.group(1)]['f'] += 1

pgc = collections.defaultdict(lambda: collections.Counter())
pgnamed = collections.defaultdict(dict)
for r in pg['cons']:
    if r['n'].startswith('enum_') and r['ty'] == 'c':
        continue
    pgc[r['t']][r['ty']] += 1
    pgnamed[r['t']][r['n']] = r['ty']

tables = [s['name'] for s in stmts if s['kind'] == 'TABLE']
diffs, missing_named = [], []
tot_src, tot_pg = collections.Counter(), collections.Counter()
for t in tables:
    for k in 'pfuc':
        tot_src[k] += counts[t][k]
        tot_pg[k] += pgc[t][k]
        if counts[t][k] != pgc[t][k]:
            diffs.append((t, k, counts[t][k], pgc[t][k]))
    for n, ty in named[t].items():
        if n not in pgnamed[t]:
            missing_named.append((t, n, ty))

src_idx = re.findall(r'^CREATE (?:UNIQUE )?INDEX (\w+)', src, re.M)
pg_idx = {r['n'] for r in pg['indexes']}
missing_idx = [i for i in src_idx if i not in pg_idx]

src_views = re.findall(r'^CREATE OR REPLACE VIEW (\w+)', src, re.M)
pg_views = {r['v'] for r in pg['views']}
src_trg = re.findall(r'^CREATE TRIGGER (\w+)', src, re.M)
pg_trg = {r['n'] for r in pg['triggers']}

seed_src = collections.Counter(s['name'] for s in stmts if s['kind'] == 'INSERT')
seed_tables_pg = {t: n for t, n in pg['seed'].items() if n}

res = dict(
    tables=dict(source=len(tables), pg=len(pg['seed'])),
    totals=dict(source=dict(tot_src), pg=dict(tot_pg)),
    count_diffs=diffs, missing_named_constraints=missing_named,
    indexes=dict(source_named=len(src_idx), pg_total=len(pg_idx), missing=missing_idx),
    views=dict(source=len(src_views), missing=sorted(set(src_views) - pg_views)),
    triggers=dict(source=len(src_trg), missing=sorted(set(src_trg) - pg_trg)),
    seed=dict(source_insert_statements=sum(seed_src.values()), source_seeded_tables=len(seed_src), pg_tables_with_rows=len(seed_tables_pg), pg_seed_rows=sum(pg['seed'].values()),
              tables_with_insert_but_no_rows=sorted(set(seed_src) - set(seed_tables_pg))),
)
json.dump(res, open(r'D:\Sims_2\tools\work\catalogue_comparison.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'missing_named_constraints'}, indent=1)[:3500])
print('missing named constraints:', len(missing_named), missing_named[:10])
print('count diffs:', len(diffs), diffs[:15])
