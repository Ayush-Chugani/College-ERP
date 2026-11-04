"""Generate supabase/migrations/018_rls_policies.sql and docs/RLS_POLICY_MAP.md.

Inputs (committed): tools/rls/fk_edges.json (FK edge list), tools/rls/table_module.json (data-dictionary module per table).
Model: see docs/RLS_SECURITY_MODEL.md. Every public table gets explicit policies for role `authenticated`; `anon` gets nothing.
Tenancy of a row is derived from the shortest FK path from the table to an *anchor* entity
(institution / campus / department / programme / student / employee / user_account). Actor columns
(created_by, approved_by, verified_by ...) are not ownership and are ignored; only user_account.user_id counts.
Tables with no derivable anchor are treated as reference/config data (see below) - never as tenant data.
"""
import json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = json.load(open(os.path.join(ROOT, 'tools', 'rls', 'fk_edges.json')))
MOD = json.load(open(os.path.join(ROOT, 'tools', 'rls', 'table_module.json')))
TABLES, EDGES = E['tables'], E['edges']

ANCH = {'institution': 'institution_id', 'campus': 'campus_id', 'department': 'department_id', 'programme': 'programme_id',
        'student': 'student_id', 'employee': 'employee_id', 'user_account': 'user_id'}

# dictionary module -> access_module.module_code used in permission codes
ACCESS = {'PLATFORM': 'IAM', 'FINANCE': 'FEES', 'STUDENT_ACTIVITY': 'STUDENT'}

# preferred anchor order per dictionary module (first reachable wins)
STUDENT_FIRST = ['student', 'programme', 'department', 'campus', 'institution', 'employee', 'user_account']
ORG_FIRST = ['programme', 'department', 'campus', 'institution', 'student', 'employee', 'user_account']
EMP_FIRST = ['employee', 'department', 'campus', 'institution', 'programme', 'student', 'user_account']
PREF = collections.defaultdict(lambda: ORG_FIRST)
for m in ('STUDENT', 'STUDENT_ACTIVITY', 'ADMISSION', 'REGISTRATION', 'ATTENDANCE', 'ASSESSMENT', 'RESULT', 'MENTORING', 'GRIEVANCE', 'DOCUMENT', 'FINANCE', 'FEEDBACK'):
    PREF[m] = STUDENT_FIRST
for m in ('EMPLOYEE', 'STAFF_PROFILE'):
    PREF[m] = EMP_FIRST

# tables whose writes are never granted to clients (server-side RPC / service role only)
NO_CLIENT_WRITE_MODULES = {'FINANCE', 'IAM', 'AUDIT'}
NO_CLIENT_WRITE_TABLES = {'file_object'}
# reference tables that are sensitive: SELECT needs a GLOBAL grant for (module, resource)
SENSITIVE_REFERENCE = {'admission_applicant': ('ADMISSION', 'ALL'), 'financial_ledger_account': ('FEES', 'FEE_REPORT')}
IAM_CATALOG = {'access_action', 'access_module', 'access_resource', 'permission', 'role', 'role_permission'}
# hand-written policies (user-owned / identity tables)
IAM_OWN = {'user_account': 'user_id', 'login_audit': 'user_id', 'password_history': 'user_id', 'role_delegation': None,
           'user_permission_override': 'user_id', 'user_role_assignment': 'user_id',
           'employee_user_account': 'user_id', 'student_user_account': 'user_id', 'activity_audit': 'user_id'}
ORG_PARENT = {'institution': None, 'campus': ('institution', 'institution_id'), 'department': ('campus', 'campus_id'), 'programme': ('department', 'department_id')}
EXCLUDED_COLUMN_RE = '(ciphertext|password_hash)'

# manual anchor overrides: table -> list of FK steps [(table, col, parent, parent_col)] ; filled after review of docs/RLS_POLICY_MAP.md
OVERRIDES = {}


def resource_for(t, m):
    if m == 'EMPLOYEE':
        if t == 'employee_bank_account': return 'BANK_ACCOUNT'
        if t == 'employee_aadhaar': return 'AADHAAR'
        if t == 'employee_pan': return 'PAN'
        if t.startswith('employee_document') or t == 'employee_sensitive_access_audit': return 'EMPLOYEE_DOCUMENT'
        if t == 'employee_qualification': return 'QUALIFICATION'
        if t == 'employee_previous_employment': return 'EXPERIENCE'
        return 'ALL'
    if m == 'FINANCE':
        if t.startswith('payment_') or t in ('fee_receipt', 'admission_payment'): return 'FEE_PAYMENT'
        if t in ('refund_request', 'fee_refund'): return 'FEE_REFUND'
        if t in ('fee_assessment_benefit', 'student_fee_concession', 'student_scholarship', 'student_sponsorship'): return 'FEE_BENEFIT'
        if t.startswith('fee_structure'): return 'FEE_STRUCTURE'
        if t.endswith('_audit'): return 'FEE_REPORT'
        return 'FEE_ASSESSMENT'
    if m == 'STAFF_PROFILE':
        if t.startswith('evidence'): return 'STAFF_EVIDENCE'
        if t in ('funded_research_project', 'research_proposal', 'research_supervision', 'research_project_financial_utilization', 'consultancy_project'): return 'STAFF_RESEARCH'
        return 'STAFF_ACTIVITY'
    if m == 'STUDENT_ACTIVITY':
        return 'STUDENT_ACTIVITY_EVIDENCE' if 'evidence' in t else 'STUDENT_ACTIVITY'
    return 'ALL'


def fk_steps(t):
    """Usable ownership edges from t: (child_col, parent, parent_col). Actor columns to user_account are dropped."""
    out = []
    for e in EDGES.get(t, []):
        p = e['parent']
        if p == t:
            continue
        i = 0
        if len(e['cols']) > 1:
            pk = ANCH.get(p, p + '_id')
            i = e['pcols'].index(pk) if pk in e['pcols'] else 0
        col, pcol = e['cols'][i], e['pcols'][i]
        if p == 'user_account' and col != 'user_id':
            continue
        out.append((col, p, pcol))
    return out


def find_paths(t, maxdepth=6):
    """Shortest FK path to each anchor kind reachable from t."""
    best = {}
    frontier, seen = [(t, [])], {t}
    for _ in range(maxdepth):
        nxt = []
        for cur, path in frontier:
            for col, p, pcol in fk_steps(cur):
                step = (cur, col, p, pcol)
                if p in ANCH:
                    best.setdefault(p, path + [step])
                elif p not in seen:
                    seen.add(p)
                    nxt.append((p, path + [step]))
        frontier = nxt
    return best


def anchor_expr(t, path):
    """SQL expression (usable in a policy on t) for the anchor id along the FK path."""
    cur_expr = f'{t}.{path[0][1]}'
    for i, (ct, col, p, pcol) in enumerate(path[1:], start=1):
        prev_t, prev_col, prev_parent, prev_pcol = path[i - 1]
        cur_expr = f'(SELECT _p{i}.{col} FROM {prev_parent} _p{i} WHERE _p{i}.{prev_pcol} = {cur_expr})'
    return cur_expr


def codes(m, r, act):
    return f"ARRAY['{m}.{r}.{act}']::text[]"


plan = {}
for t in TABLES:
    dm = MOD.get(t, '?')
    am = ACCESS.get(dm, dm)
    res = resource_for(t, dm)
    entry = dict(table=t, dict_module=dm, access_module=am, resource=res, writes=False)
    if t in IAM_OWN:
        entry.update(kind='iam_own', col=IAM_OWN[t])
    elif t == 'file_object':
        entry.update(kind='file_object')
    elif t in ORG_PARENT:
        entry.update(kind='org', parent=ORG_PARENT[t], writes=True)
    elif t in ('student', 'employee'):
        entry.update(kind='anchor_self', anchor=t, expr=f'{t}.{ANCH[t]}', writes=dm not in NO_CLIENT_WRITE_MODULES)
    else:
        paths = find_paths(t)
        if t in OVERRIDES:
            pth = OVERRIDES[t]
            a = pth[-1][2]
            paths = {a: pth}
        chosen = next((a for a in PREF[dm] if a in paths), None)
        if chosen is None:
            entry.update(kind='reference')
            entry['writes'] = dm not in NO_CLIENT_WRITE_MODULES and t not in IAM_CATALOG and t not in SENSITIVE_REFERENCE
        else:
            entry.update(kind='anchored', anchor=chosen, path=paths[chosen], expr=anchor_expr(t, paths[chosen]))
            entry['writes'] = dm not in NO_CLIENT_WRITE_MODULES and t not in NO_CLIENT_WRITE_TABLES
    plan[t] = entry


def fn(anchor):
    return 'sims_private.can_' + {'user_account': 'user'}.get(anchor, anchor)


sql = ['-- Generated by tools/build_rls.py (do not edit by hand). Model: docs/RLS_SECURITY_MODEL.md; per-table map: docs/RLS_POLICY_MAP.md',
       '-- Policies apply to role `authenticated` only. `anon` has no grants. service_role bypasses RLS (server-side code only).',
       '-- Rule: SELF-scope grants are READ-ONLY through direct table access; self-service writes must go through RPCs.', '']
def policy_clauses(t, p, expr):
    """(select, insert, update, delete) policy expressions for table t using `expr` as the anchor-id expression."""
    k = p['kind']
    am, res = p['access_module'], p['resource']
    R, C, U, D = codes(am, res, 'READ'), codes(am, res, 'CREATE'), codes(am, res, 'UPDATE'), codes(am, res, 'DELETE')
    sel = ins = upd = dele = None
    if k == 'iam_own':
        col = p['col']
        own = f'{t}.{col} = sims_private.current_user_id() OR ' if col else ''
        sel = f"{own}sims_private.can_global(ARRAY['IAM.ALL.READ']::text[])"
    elif k == 'file_object':
        sel = f"file_object.uploaded_by_user_id = sims_private.current_user_id() OR sims_private.can_global(ARRAY['DOCUMENT.ALL.READ']::text[])"
    elif k == 'org':
        sel = 'sims_private.is_active_member()'
        par = p['parent']
        if par is None:
            ins = upd = dele = None  # institutions are created by global admins via service role only
            sel = 'sims_private.is_active_member()'
            p['writes'] = False
        else:
            pf, pc = fn(par[0]), par[1]
            ins = f'{pf}({C}, {t}.{pc})'
            upd = f'{pf}({U}, {t}.{pc})'
            dele = f'{pf}({D}, {t}.{pc})'
    elif k == 'anchor_self':
        f = fn(p['anchor'])
        sel = f'{f}({R}, {expr}, false)'
        if p['writes']:
            ins, upd, dele = (f'{f}({X}, {expr}, true)' for X in (C, U, D))
    elif k == 'anchored':
        a = p['anchor']
        f = fn(a)
        extra = ', false' if a in ('student', 'employee', 'user_account') else ''
        extraw = ', true' if a in ('student', 'employee', 'user_account') else ''
        sel = f'{f}({R}, {expr}{extra})'
        if p['writes']:
            ins, upd, dele = (f'{f}({X}, {expr}{extraw})' for X in (C, U, D))
    elif k == 'reference':
        if t in IAM_CATALOG:
            sel = "sims_private.can_global(ARRAY['IAM.ALL.READ']::text[])"
        elif t in SENSITIVE_REFERENCE:
            m2, r2 = SENSITIVE_REFERENCE[t]
            sel = f"sims_private.can_global({codes(m2, r2, 'READ')})"
        else:
            sel = 'sims_private.is_active_member()'
        if p['writes']:
            cfg = codes(am, 'ALL', 'CONFIGURE')
            ins = upd = dele = f'sims_private.can_global({cfg})'
    return sel, ins, upd, dele


write_tables = []
for t in TABLES:
    p = plan[t]
    k = p['kind']
    sel, ins, upd, dele = policy_clauses(t, p, p.get('expr'))
    sql.append(f'-- {t}: {k}' + (f' -> {p.get("anchor")}' if k in ('anchored', 'anchor_self') else ''))
    sql.append(f'CREATE POLICY {t}_select ON {t} FOR SELECT TO authenticated USING ({sel});')
    if ins:
        sql.append(f'CREATE POLICY {t}_insert ON {t} FOR INSERT TO authenticated WITH CHECK ({ins});')
        sql.append(f'CREATE POLICY {t}_update ON {t} FOR UPDATE TO authenticated USING ({upd}) WITH CHECK ({upd});')
        sql.append(f'CREATE POLICY {t}_delete ON {t} FOR DELETE TO authenticated USING ({dele});')
        write_tables.append(t)
    sql.append('')

sql.append(f"""-- ---------------------------------------------------------------
-- Table privileges: SELECT on all tables (minus secret columns), write privileges only where a write policy exists.
-- Columns matching {EXCLUDED_COLUMN_RE} are never client-readable (clients must name columns explicitly on those tables).
-- ---------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
DO $$
DECLARE r record; cols text;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = r.tablename AND column_name !~ '{EXCLUDED_COLUMN_RE}';
        EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', cols, r.tablename);
    END LOOP;
END $$;
GRANT INSERT, UPDATE, DELETE ON {', '.join(write_tables)} TO authenticated;
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.viewname);
    END LOOP;
END $$;
""")
open(os.path.join(ROOT, 'supabase', 'migrations', '018_rls_policies.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(sql))

# ---- human-reviewable map
L = ['# RLS Policy Map (generated)', '', 'Generated by `tools/build_rls.py`. **Anchors are derived by heuristic from FK paths; this table is the review surface.** A wrong anchor fails safe in most cases (global-scope holders only) but can over-grant when a non-owning FK is mistaken for ownership.', '',
     f'Tables: {len(plan)}. Client-writable: {len(write_tables)}.', '', '| Table | Dict. module | Permission | Kind | Anchor (FK path) | Client writes |', '|---|---|---|---|---|---|']
for t in TABLES:
    p = plan[t]
    path = ''
    if p['kind'] == 'anchored':
        path = ' → '.join([p['path'][0][0]] + [f'{s[2]}' for s in p['path']]) + f' (via {", ".join(s[1] for s in p["path"])})'
    elif p['kind'] == 'anchor_self':
        path = 'self'
    L.append(f"| `{t}` | {p['dict_module']} | {p['access_module']}.{p['resource']} | {p['kind']} | {p.get('anchor', '')} {path} | {'yes' if t in write_tables else 'no'} |")
open(os.path.join(ROOT, 'docs', 'RLS_POLICY_MAP.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(collections.Counter(p['kind'] for p in plan.values()), 'writes', len(write_tables))
print(collections.Counter(p.get('anchor') for p in plan.values() if p['kind'] == 'anchored'))


# =====================================================================
# Workflow guards -> supabase/migrations/020_workflow_guards.sql
# Applies only while executing as the end-user role (`authenticated`). SECURITY DEFINER RPCs, service_role and
# migrations run as other roles and are not guarded here: they must perform their own authorization.
# =====================================================================
import re as _re

G = json.load(open(os.path.join(ROOT, 'tools', 'rls', 'workflow_guards.json')))
COLS = E['columns']
guards = collections.defaultdict(list)  # table -> list of dict(col, action, cond_new, cond_old|None, kind)

for g in G['value_guards']:
    vals = ', '.join(f"'{v}'" for v in g['values'])
    guards[g['table']].append(dict(col=g['column'], action=g['action'], kind='value', vals=vals))
for g in G['lookup_guards']:
    vals = ', '.join(f"'{v}'" for v in g['values'])
    for t in g['tables']:
        guards[t].append(dict(col=g['column'], action=g['action'], kind='lookup', vals=vals, lookup=g['lookup'], pk=g['lookup_pk'], code=g['lookup_code']))
for action, names in G['any_guards'].items():
    for t in TABLES:
        for n in names:
            if n in COLS.get(t, []):
                guards[t].append(dict(col=n, action=action, kind='any'))

gsql = ['-- Generated by tools/build_rls.py (do not edit by hand). Config: tools/rls/workflow_guards.json',
        '-- Privileged workflow transitions (APPROVE / VERIFY / PUBLISH) need the matching permission at the row scope, enforced',
        '-- for the end-user role only. Actor columns (approved_by..., verified_by...) must equal the acting user.', '']
def guard_function_sql(t, anchor_expr_text=None):
    """CREATE FUNCTION text for table t's workflow guard (None if t is not guarded). anchor_expr_text overrides the stored anchor expression."""
    if t not in guards or t not in write_tables:
        return None
    p = plan[t]
    if p['kind'] == 'anchored' or p['kind'] == 'anchor_self':
        a = p['anchor']
        expr = _re.sub(rf'\b{t}\.', 'NEW.', anchor_expr_text if anchor_expr_text is not None else p['expr'])
        tail = ', true' if a in ('student', 'employee', 'user_account') else ''
        can = lambda act: f"{fn(a)}({codes(p['access_module'], p['resource'], act)}, {expr}{tail})"
    elif p['kind'] == 'reference':
        can = lambda act: f"sims_private.can_global({codes(p['access_module'], 'ALL', act)})"
    else:
        return None
    body = []
    seen = set()
    for g in guards[t]:
        col = g['col']
        if (col, g['action']) in seen:
            continue
        seen.add((col, g['action']))
        if g['kind'] == 'any':
            changed = f'CASE WHEN TG_OP = \'UPDATE\' THEN NEW.{col} IS DISTINCT FROM OLD.{col} ELSE NEW.{col} IS NOT NULL END'
        elif g['kind'] == 'value':
            changed = (f"CASE WHEN TG_OP = 'UPDATE' THEN (NEW.{col} IS DISTINCT FROM OLD.{col} AND (NEW.{col} IN ({g['vals']}) OR OLD.{col} IN ({g['vals']}))) "
                       f"ELSE NEW.{col} IN ({g['vals']}) END")
        else:
            look = lambda ref: f"(SELECT l.{g['code']} FROM {g['lookup']} l WHERE l.{g['pk']} = {ref}.{col})"
            changed = (f"CASE WHEN TG_OP = 'UPDATE' THEN (NEW.{col} IS DISTINCT FROM OLD.{col} AND ({look('NEW')} IN ({g['vals']}) OR {look('OLD')} IN ({g['vals']}))) "
                       f"ELSE {look('NEW')} IN ({g['vals']}) END")
        body.append(f"    IF ({changed}) THEN\n        IF NOT {can(g['action'])} THEN\n"
                    f"            RAISE EXCEPTION 'Not authorised to {g['action']} ({t}.{col})' USING ERRCODE = '42501';\n        END IF;\n    END IF;")
    for col in G['actor_columns']:
        if col in COLS.get(t, []):
            body.append(f"    IF ((CASE WHEN TG_OP = 'UPDATE' THEN NEW.{col} IS DISTINCT FROM OLD.{col} ELSE NEW.{col} IS NOT NULL END)\n"
                        f"       AND NEW.{col} IS NOT NULL AND NEW.{col} IS DISTINCT FROM sims_private.current_user_id()) THEN\n"
                        f"        RAISE EXCEPTION '{t}.{col} must be the acting user' USING ERRCODE = '42501';\n    END IF;")
    return (f"CREATE FUNCTION sims_guard_{t}() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$\nBEGIN\n"
            f"    IF current_user <> 'authenticated' THEN RETURN NEW; END IF;\n" + '\n'.join(body) + "\n    RETURN NEW;\nEND $$;"), len(seen)


n_guarded = 0
guarded_tables = []
for t in TABLES:
    res = guard_function_sql(t)
    if res is None:
        continue
    fsql, n = res
    gsql.append(fsql)
    gsql.append(f"CREATE TRIGGER trg_{t}_workflow_guard BEFORE INSERT OR UPDATE ON {t} FOR EACH ROW EXECUTE FUNCTION sims_guard_{t}();\n")
    n_guarded += n
    guarded_tables.append(t)
open(os.path.join(ROOT, 'supabase', 'migrations', '020_workflow_guards.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(gsql))
print('workflow guards:', len(guarded_tables), 'tables,', n_guarded, 'guarded columns')


# =====================================================================
# 029: resolve multi-hop anchors through SECURITY DEFINER lookup functions.
# Migration 018/020 resolve each hop with a subquery that runs as the CALLER, so a user who may write a row but cannot read an
# intermediate table (another module) saw NULL and was silently denied. Each hop becomes sims_private.nx_<parent>_<pk>_<target>(id).
# =====================================================================
import hashlib

_steps = {}


def step_fn(parent, pkcol, target):
    key = (parent, pkcol, target)
    if key not in _steps:
        base = f'nx_{parent}_{pkcol}_{target}'
        _steps[key] = base if len(base) <= 60 else base[:49] + '_' + hashlib.md5(base.encode()).hexdigest()[:10]
    return 'sims_private.' + _steps[key]


def anchor_expr_fn(t, path):
    e = f'{t}.{path[0][1]}'
    for i, (ct, col, par, pcol) in enumerate(path[1:], start=1):
        e = f'{step_fn(path[i - 1][2], path[i - 1][3], col)}({e})'
    return e


# policies replaced by hand-written migrations (027) must not be regenerated from the heuristic anchor
SUPERSEDED = {'admission_application'}
nested = [t for t in TABLES if plan[t]['kind'] == 'anchored' and len(plan[t]['path']) >= 2 and t not in SUPERSEDED]
body29 = []
for t in nested:
    p = plan[t]
    ex = anchor_expr_fn(t, p['path'])
    sel, ins, upd, dele = policy_clauses(t, p, ex)
    body29.append(f'-- {t}')
    body29.append(f'DROP POLICY IF EXISTS {t}_select ON {t};')
    body29.append(f'CREATE POLICY {t}_select ON {t} FOR SELECT TO authenticated USING ({sel});')
    if ins:
        body29.append(f'DROP POLICY IF EXISTS {t}_insert ON {t};\nDROP POLICY IF EXISTS {t}_update ON {t};\nDROP POLICY IF EXISTS {t}_delete ON {t};')
        body29.append(f'CREATE POLICY {t}_insert ON {t} FOR INSERT TO authenticated WITH CHECK ({ins});')
        body29.append(f'CREATE POLICY {t}_update ON {t} FOR UPDATE TO authenticated USING ({upd}) WITH CHECK ({upd});')
        body29.append(f'CREATE POLICY {t}_delete ON {t} FOR DELETE TO authenticated USING ({dele});')
    g = guard_function_sql(t, ex)
    if g:
        body29.append(g[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1))
    body29.append('')

fn29 = []
for (par, pk, tgt), name in sorted(_steps.items(), key=lambda x: x[1]):
    fn29.append(f"CREATE FUNCTION sims_private.{name}(p_id bigint) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$\n"
                f"    SELECT {tgt}::bigint FROM public.{par} WHERE {pk} = p_id\n$$;")
head29 = ['-- Generated by tools/build_rls.py (do not edit by hand).',
          '-- Fixes a flaw in migrations 018/020: multi-hop anchor subqueries ran as the caller under RLS, so a writer without read access to an',
          '-- intermediate table (typically in another module) was silently denied. Every hop is now a SECURITY DEFINER lookup, which reads the',
          '-- row regardless of the caller\'s own read access. Authorisation is unchanged: the permission check still runs against the resolved',
          '-- anchor with the caller\'s identity.',
          f'-- Affects {len(nested)} tables and {len(fn29)} lookup functions.', '']
tail29 = ['REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sims_private FROM PUBLIC, anon;',
          'DO $$\nDECLARE r record;\nBEGIN\n    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = \'sims_private\' AND p.proname LIKE \'nx\_%\' LOOP\n'
          '        EXECUTE format(\'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role\', r.sig);\n    END LOOP;\nEND $$;']
# NOTE: REVOKE ... ALL FUNCTIONS above would also strip grants given in 017/021; re-grant is handled below by only touching nx_ functions.
tail29 = [t for t in tail29 if not t.startswith('REVOKE ALL ON ALL')]
tail29.insert(0, "DO $$\nDECLARE r record;\nBEGIN\n    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sims_private' AND p.proname LIKE 'nx\_%' LOOP\n        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);\n    END LOOP;\nEND $$;")
open(os.path.join(ROOT, 'supabase', 'migrations', '029_definer_anchor_lookups.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(head29 + fn29 + [''] + body29 + tail29) + '\n')
print('029:', len(nested), 'tables,', len(fn29), 'lookup functions')
