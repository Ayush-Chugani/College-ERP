"""MySQL 8 -> PostgreSQL translator for SIMS-DatabaseWithoutLessonPlan.sql.

Statement-based and order-preserving. Triggers are NOT auto-translated (extracted for hand porting).
Output: tools/work/pg_statements.json  -> list of {line, kind, sql, name}
        tools/work/triggers_mysql.sql  -> raw MySQL trigger block
        tools/work/translation_notes.json -> updated_at columns, identity columns, enum columns, unsigned usage
"""
import re, json, os, collections

SRC = r'D:\Sims_2\SIMS-DatabaseWithoutLessonPlan.sql'
OUT = r'D:\Sims_2\tools\work'
os.makedirs(OUT, exist_ok=True)
text = open(SRC, encoding='utf-8').read()


def split_statements(text):
    """Yield (start_line, statement_text) honouring quotes/comments. DELIMITER blocks returned as ('TRIGGERS', raw)."""
    out, i, n, line = [], 0, len(text), 1
    buf, start_line, in_delim_block = [], None, False
    while i < n:
        ch = text[i]
        if not buf and text.startswith('DELIMITER $$', i):
            end = text.index('DELIMITER ;', i)
            out.append((line, 'DELIMITER_BLOCK', text[i:end + len('DELIMITER ;')]))
            line += text[i:end + len('DELIMITER ;')].count('\n')
            i = end + len('DELIMITER ;')
            continue
        if ch == '-' and text.startswith('--', i):
            j = text.find('\n', i)
            j = n if j < 0 else j
            i = j
            continue
        if ch == "'":
            j = i + 1
            while True:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == "'":
                    if text[j + 1:j + 2] == "'":
                        j += 2
                        continue
                    break
                j += 1
            seg = text[i:j + 1]
            if start_line is None:
                start_line = line
            buf.append(seg)
            line += seg.count('\n')
            i = j + 1
            continue
        if ch == ';':
            stmt = ''.join(buf).strip()
            if stmt:
                out.append((start_line, 'STMT', stmt))
            buf, start_line = [], None
            i += 1
            continue
        if ch == '\n':
            line += 1
        if not buf and ch.isspace():
            i += 1
            continue
        if start_line is None:
            start_line = line
        buf.append(ch)
        i += 1
    return out


def split_top(s, sep=','):
    parts, depth, cur, i = [], 0, [], 0
    while i < len(s):
        c = s[i]
        if c == "'":
            j = i + 1
            while True:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == "'":
                    if s[j + 1:j + 2] == "'":
                        j += 2
                        continue
                    break
                j += 1
            cur.append(s[i:j + 1])
            i = j + 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if c == sep and depth == 0:
            parts.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    if ''.join(cur).strip():
        parts.append(''.join(cur).strip())
    return parts


def balanced(s, start):
    """s[start]=='(' ; return index of matching ')' honouring quotes."""
    depth, i = 0, start
    while i < len(s):
        c = s[i]
        if c == "'":
            i += 1
            while not (s[i] == "'" and s[i + 1:i + 2] != "'"):
                i += 2 if (s[i] == "'" or s[i] == '\\') else 1
            i += 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError('unbalanced')


table_cols = {}
notes = dict(updated_at=[], identity=[], enums={}, unsigned=collections.Counter(), types=collections.Counter(), comments=[], year_cols=[], unhandled=[], source_defects=[], prefix_indexes=[])

UINT = {'TINYINT': 'u8', 'SMALLINT': 'u16', 'INT': 'u32', 'INTEGER': 'u32', 'BIGINT': 'u64', 'MEDIUMINT': 'u24'}
SINT = {'TINYINT': 'smallint', 'SMALLINT': 'smallint', 'MEDIUMINT': 'integer', 'INT': 'integer', 'INTEGER': 'integer', 'BIGINT': 'bigint'}
# identity columns cannot use domains; use the narrowest plain integer type that holds the unsigned range
IDENT_BASE = {'u8': 'smallint', 'u16': 'integer', 'u24': 'integer', 'u32': 'bigint', 'u64': 'bigint'}


def convert_type(tbl, col, rest):
    """rest begins at the type token. Returns (pg_type, remainder, enum_values|None, unsigned_domain|None)."""
    m = re.match(r'(\w+)', rest)
    base = m.group(1).upper()
    pos = m.end()
    args = None
    if rest[pos:pos + 1] == '(':
        e = balanced(rest, pos)
        args = rest[pos + 1:e]
        pos = e + 1
    rem = rest[pos:]
    unsigned = False
    mu = re.match(r'\s+UNSIGNED', rem, re.I)
    if mu:
        unsigned = True
        rem = rem[mu.end():]
    notes['types'][base] += 1
    enum_vals = None
    dom = None
    if base == 'ENUM':
        enum_vals = [v.strip().strip("'") for v in split_top(args)]
        t = 'text'
    elif base in ('TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT'):
        if unsigned:
            dom = UINT[base]
            t = dom
            notes['unsigned'][dom] += 1
        else:
            t = SINT[base]
    elif base in ('BOOLEAN', 'BOOL'):
        t = 'boolean'
    elif base == 'YEAR':
        t = 'u_year'
        notes['year_cols'].append(f'{tbl}.{col}')
    elif base == 'DATETIME':
        t = f'timestamptz({args})' if args else 'timestamptz'
    elif base == 'TIMESTAMP':
        t = f'timestamptz({args})' if args else 'timestamptz'
    elif base in ('TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT'):
        t = 'text'
    elif base == 'JSON':
        t = 'jsonb'
    elif base in ('VARBINARY', 'BINARY', 'BLOB', 'LONGBLOB', 'MEDIUMBLOB', 'TINYBLOB'):
        t = 'bytea'
    elif base in ('VARCHAR', 'CHAR', 'DECIMAL', 'NUMERIC', 'DATE', 'TIME', 'FLOAT', 'DOUBLE'):
        t = {'DOUBLE': 'double precision', 'FLOAT': 'real'}.get(base, base.lower())
        if args and base not in ('DOUBLE', 'FLOAT') or (args and base in ('DOUBLE', 'FLOAT') and False):
            t += f'({args})'
    else:
        notes['unhandled'].append(f'{tbl}.{col}: type {base}')
        t = base.lower()
    return t, rem, enum_vals, dom


def convert_attrs(rem):
    s = rem
    comment = None
    mc = re.search(r"\s+COMMENT\s+('(?:[^']|'')*')", s, re.I)
    if mc:
        comment = mc.group(1)
        s = s[:mc.start()] + s[mc.end():]
    s = re.sub(r'\s+CHARACTER\s+SET\s+\w+', '', s, flags=re.I)
    s = re.sub(r'\s+COLLATE\s+\w+', '', s, flags=re.I)
    upd = bool(re.search(r'\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\d*\))?', s, re.I))
    s = re.sub(r'\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\d*\))?', '', s, flags=re.I)
    auto = bool(re.search(r'\bAUTO_INCREMENT\b', s, re.I))
    s = re.sub(r'\s*\bAUTO_INCREMENT\b', '', s, flags=re.I)
    return s, comment, upd, auto


def rewrite_call(s, fname, fn):
    """Rewrite every FNAME(args) using balanced-paren argument splitting; fn(args_list) -> str."""
    pat = re.compile(r'\b' + fname + r'\s*\(', re.I)
    while True:
        m = pat.search(s)
        if not m:
            return s
        o = m.end() - 1
        e = balanced(s, o)
        args = split_top(s[o + 1:e])
        s = s[:m.start()] + fn(args) + s[e + 1:]


def _tsdiff(a):
    unit, d1, d2 = a[0].strip().upper(), a[1], a[2]
    if unit == 'YEAR':
        return f'CAST(EXTRACT(YEAR FROM age({d2}, {d1})) AS integer)'
    if unit == 'MONTH':
        return f'CAST(EXTRACT(YEAR FROM age({d2}, {d1})) * 12 + EXTRACT(MONTH FROM age({d2}, {d1})) AS integer)'
    raise ValueError('TIMESTAMPDIFF unit ' + unit)


def expr_fix(s):
    """Expression-level MySQL -> PG substitutions (CHECK, generated columns, views)."""
    s = s.replace('`', '"')
    s = re.sub(r'\bREGEXP\b', '~', s)
    s = rewrite_call(s, 'TIMESTAMPDIFF', _tsdiff)
    s = rewrite_call(s, 'DATEDIFF', lambda a: f'(CAST({a[0]} AS date) - CAST({a[1]} AS date))')
    s = re.sub(r'\bIFNULL\(', 'COALESCE(', s, flags=re.I)
    s = re.sub(r'\bCURDATE\(\)', 'CURRENT_DATE', s, flags=re.I)
    s = re.sub(r'\bNOW\(\)', 'CURRENT_TIMESTAMP', s, flags=re.I)
    s = re.sub(r'\bDATE\(([^()]+)\)', r'CAST(\1 AS date)', s)
    return s


def tx_create_table(stmt, line):
    m = re.match(r'CREATE TABLE (\w+) \((.*)\)\s*ENGINE=.*$', stmt, re.S)
    tbl, body = m.group(1), m.group(2)
    entries = split_top(body)
    out, comments = [], []
    for ent in entries:
        mm = re.match(r'(\w+)\s+(.*)$', ent, re.S)
        head = mm.group(1).upper()
        if head in ('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'KEY', 'INDEX', 'FULLTEXT'):
            if head in ('KEY', 'INDEX', 'FULLTEXT'):
                notes['unhandled'].append(f'{tbl}: inline index {ent[:60]}')
            out.append('    ' + expr_fix(ent))
            continue
        col = mm.group(1)
        table_cols.setdefault(tbl, set()).add(col)
        typ, rem, enum_vals, dom = convert_type(tbl, col, mm.group(2))
        attrs, comment, upd, auto = convert_attrs(rem)
        attrs = expr_fix(attrs)
        if comment:
            comments.append((col, comment))
        if upd:
            notes['updated_at'].append((tbl, col))
        extra = ''
        if auto:
            notes['identity'].append((tbl, col))
            typ = IDENT_BASE.get(dom, typ) if dom else typ
            extra = ' GENERATED BY DEFAULT AS IDENTITY'
        if enum_vals is not None:
            notes['enums'][f'{tbl}.{col}'] = enum_vals
            vals = ','.join("'" + v + "'" for v in enum_vals)
            attrs = attrs + f' CONSTRAINT enum_{col} CHECK ({col} IN ({vals}))'
        out.append(f'    {col} {typ}{extra}{attrs}')
    sql = f'CREATE TABLE {tbl} (\n' + ',\n'.join(out) + '\n);'
    for col, c in comments:
        sql += f'\nCOMMENT ON COLUMN {tbl}.{col} IS {c};'
    return tbl, sql


def strip_prefix(sql, orig):
    new = re.sub(r'(\w+)\(\d+\)(?=[,)])', r'\1', sql)
    if new != sql:
        notes['prefix_indexes'].append(re.search(r'INDEX (\w+)', orig).group(1))
    return new


def tx_alter(stmt):
    m = re.match(r'ALTER TABLE (\w+)\s+(.*)$', stmt, re.S)
    tbl, body = m.group(1), m.group(2)
    if not re.match(r'ADD COLUMN', body, re.I):
        return stmt + ';'
    adds, extra = [], []
    for ent in split_top(body):
        mm = re.match(r'ADD COLUMN (\w+)\s+(.*?)(\s+AFTER\s+\w+)?$', ent, re.S | re.I)
        col = mm.group(1)
        if col in table_cols.get(tbl, ()):
            notes['source_defects'].append(f'SD-1 {tbl}.{col}: ALTER ADD COLUMN duplicates a column already in CREATE TABLE (MySQL would abort); skipped')
            continue
        table_cols.setdefault(tbl, set()).add(col)
        typ, rem, enum_vals, dom = convert_type(tbl, col, mm.group(2))
        attrs, comment, upd, auto = convert_attrs(rem)
        if upd or auto:
            notes['unhandled'].append(f'{tbl}.{col}: ALTER ADD COLUMN with ON UPDATE/AUTO_INCREMENT')
        if enum_vals is not None:
            notes['enums'][f'{tbl}.{col}'] = enum_vals
            vals = ','.join("'" + v + "'" for v in enum_vals)
            attrs += f' CONSTRAINT enum_{col} CHECK ({col} IN ({vals}))'
        adds.append(f'ADD COLUMN {col} {typ}{expr_fix(attrs)}')
    return f'ALTER TABLE {tbl}\n    ' + ',\n    '.join(adds) + ';'


def tx_insert(stmt):
    ignore = bool(re.match(r'INSERT\s+IGNORE', stmt, re.I))
    s = re.sub(r'^INSERT\s+IGNORE', 'INSERT', stmt, flags=re.I)
    s = s.replace('`', '"')
    odku = re.search(r'\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.*)$', s, re.S | re.I)
    if odku:
        notes['unhandled'].append('ON DUPLICATE KEY UPDATE: ' + s[:80])
    if '\\' in s:
        notes['unhandled'].append('backslash in insert: ' + s[:80])
    s = expr_fix(s) if 'SELECT' in s.upper()[:400] and not s.upper().lstrip().startswith('INSERT INTO') else s
    if ignore:
        s += ' ON CONFLICT DO NOTHING'
    return s + ';'


def tx_view(stmt):
    s = expr_fix(stmt)
    s = re.sub(r'^CREATE OR REPLACE VIEW (\w+) AS', r'CREATE OR REPLACE VIEW \1 WITH (security_invoker = true) AS', s)
    return s + ';'


def main():
    stmts = split_statements(text)
    res = []
    for line, kind, st in stmts:
        if kind == 'DELIMITER_BLOCK':
            open(os.path.join(OUT, 'triggers_mysql.sql'), 'w', encoding='utf-8').write(st)
            res.append(dict(line=line, kind='TRIGGER_BLOCK', name='(16 triggers)', sql=''))
            continue
        u = st.upper()
        if u.startswith('SET '):
            res.append(dict(line=line, kind='SKIP', name=st[:40], sql=''))
        elif u.startswith('CREATE TABLE'):
            tbl, sql = tx_create_table(st, line)
            res.append(dict(line=line, kind='TABLE', name=tbl, sql=sql))
        elif u.startswith('CREATE INDEX') or u.startswith('CREATE UNIQUE INDEX'):
            res.append(dict(line=line, kind='INDEX', name=re.search(r'INDEX (\w+)', st).group(1), sql=strip_prefix(expr_fix(st), st) + ';'))
        elif u.startswith('ALTER TABLE'):
            res.append(dict(line=line, kind='ALTER', name=re.search(r'ALTER TABLE (\w+)', st).group(1), sql=tx_alter(st)))
        elif u.startswith('INSERT'):
            res.append(dict(line=line, kind='INSERT', name=re.search(r'INTO (\w+)', st).group(1), sql=tx_insert(st)))
        elif u.startswith('CREATE OR REPLACE VIEW'):
            res.append(dict(line=line, kind='VIEW', name=re.search(r'VIEW (\w+)', st).group(1), sql=tx_view(st)))
        else:
            res.append(dict(line=line, kind='UNKNOWN', name=st[:60], sql=''))
    json.dump(res, open(os.path.join(OUT, 'pg_statements.json'), 'w'), indent=1)
    notes['unsigned'] = dict(notes['unsigned'])
    notes['types'] = dict(notes['types'])
    json.dump(notes, open(os.path.join(OUT, 'translation_notes.json'), 'w'), indent=1)
    c = collections.Counter(r['kind'] for r in res)
    print(dict(c))
    print('unhandled:', notes['unhandled'][:20])
    print('updated_at cols:', collections.Counter(c for _, c in notes['updated_at']))
    print('identity:', len(notes['identity']), 'enums:', len(notes['enums']))


if __name__ == '__main__':
    main()
