"""Source-to-dictionary reconciliation: SQL file vs Excel data dictionary. Writes docs/RECONCILIATION_DATA.json"""
import re, json, collections, openpyxl
SQL = r'D:\Sims_2\SIMS-DatabaseWithoutLessonPlan.sql'
XLS = r'D:\Sims_2\SIMS_GEC_Haveri_Data_Dictionary (1).xlsx'
sql = open(SQL, encoding='utf-8').read()
KW = ('CONSTRAINT','PRIMARY','UNIQUE','KEY','INDEX','CHECK','FOREIGN','FULLTEXT')
sql_tables = {}
for m in re.finditer(r'^CREATE TABLE (\w+) \(\n(.*?)\n\) ENGINE', sql, re.M|re.S):
    cols=[]
    for ln in m.group(2).split('\n'):
        mm = re.match(r'^    (\w+) ', ln)
        if mm and mm.group(1).upper() not in KW: cols.append(mm.group(1))
    sql_tables[m.group(1)] = cols
for m in re.finditer(r'^ALTER TABLE (\w+)\s+(ADD COLUMN.*?);', sql, re.M|re.S):
    for c in re.findall(r'ADD COLUMN (\w+) ', m.group(2)):
        if c not in sql_tables[m.group(1)]: sql_tables[m.group(1)].append(c)
sql_views = re.findall(r'^CREATE OR REPLACE VIEW (\w+)', sql, re.M)
sql_trigs = re.findall(r'^CREATE TRIGGER (\w+)', sql, re.M)
wb = openpyxl.load_workbook(XLS, read_only=True)
dd_tables, dd_views, dd_mod = {}, {}, {}
for ws in wb.worksheets:
    if ws.title in ('Modules','Table Index'): continue
    cur=None; kind=None
    rows=list(ws.iter_rows(values_only=True))
    for i,r in enumerate(rows):
        if r[1] in ('TABLE','VIEW') and r[0] and i+1<len(rows) and rows[i+1][0]=='Attribute':
            cur=r[0]; kind=r[1]; (dd_tables if kind=='TABLE' else dd_views)[cur]=[]; dd_mod[cur]=ws.title
        elif cur and r[0] and r[0] not in ('Attribute',) and r[1] and not (r[0].startswith('Module ')):
            (dd_tables if kind=='TABLE' else dd_views)[cur].append(r[0])
idx = list(wb['Table Index'].iter_rows(values_only=True))[1:]
idx_tables = {r[1]:r[0] for r in idx if r[2]=='Table'}
idx_views = {r[1]:r[0] for r in idx if r[2]=='View'}
S, D = set(sql_tables), set(dd_tables)
out = dict(
  counts=dict(sql_tables=len(S), sql_views=len(sql_views), sql_triggers=len(sql_trigs), dd_tables=len(D), dd_views=len(dd_views), idx_tables=len(idx_tables), idx_views=len(idx_views)),
  sql_only_tables=sorted(S-D), dict_only_tables=sorted(D-S),
  dict_only_by_module=collections.Counter(dd_mod[t] for t in D-S),
  sql_views=sql_views, dd_views=sorted(dd_views), views_sql_not_dict=sorted(set(sql_views)-set(dd_views)), views_dict_not_sql=sorted(set(dd_views)-set(sql_views)),
  triggers=sql_trigs, col_diffs={})
for t in sorted(S&D):
    a,b=set(sql_tables[t]),set(dd_tables[t])
    if a!=b: out['col_diffs'][t]=dict(sql_only=sorted(a-b), dict_only=sorted(b-a))
out['tables_by_module_sql']=collections.Counter(dd_mod.get(t,'(not in dictionary)') for t in S)
out['sql_columns_total']=sum(len(v) for v in sql_tables.values())
out['sql_tables']=sql_tables
json.dump(out, open(r'D:\Sims_2\tools\reconciliation.json','w'), indent=1, default=dict)
for k in ('counts','sql_only_tables','dict_only_by_module','views_sql_not_dict','views_dict_not_sql'): print(k, out[k])
print('tables w/ column diffs', len(out['col_diffs']), 'sql cols', out['sql_columns_total'])
print(list(out['col_diffs'].items())[:5])
print(len(out['dict_only_tables']), out['dict_only_tables'][:60])
