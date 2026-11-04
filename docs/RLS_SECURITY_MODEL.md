# RLS Security Model

Generated policies: `supabase/migrations/018_rls_policies.sql` (by `tools/build_rls.py`); per-table review map: [RLS_POLICY_MAP.md](RLS_POLICY_MAP.md). Helpers: `017_identity_map_and_rbac_helpers.sql`. Baseline: `016` (RLS on everywhere).

## Principles
1. Deny by default: RLS on for all 213 tables; policies only for role `authenticated`; `anon` has no grants. `service_role` bypasses RLS and must stay server-side.
2. Authority is derived in the database from the verified JWT subject through the identity map and the RBAC tables (see AUTHENTICATION_AND_RBAC.md). The frontend never supplies a role, permission or institution.
3. Tenancy is derived structurally: each table's *anchor* (institution / campus / department / programme / student / employee / user) is the shortest FK path to one of those entities (`tools/build_rls.py`; actor columns such as `created_by` are ignored). A row is visible/writable iff the caller holds the required permission at a scope covering the anchor.
4. **Direct writes are limited.** Client writes exist only for 164 tables, only with a non-SELF scoped grant. No client writes at all for: financial (`FINANCE`), IAM, audit tables and `file_object`. Those need server-side RPCs (not yet built).
5. Column privileges: `password_hash` and `*_ciphertext` columns are not readable by clients. On `user_account` and the 3 ciphertext tables clients must list columns explicitly (`select=*` errors).
6. Views are `security_invoker`, so they inherit table policies. All 10 views are granted `SELECT` to `authenticated`.

## Policy classes
| Class | Tables | SELECT | Writes |
|---|---|---|---|
| Reference / config (no anchor) | 91 | any active mapped user | global `MODULE.ALL.CONFIGURE` (none for FEES) |
| Sensitive reference | `admission_applicant`, `financial_ledger_account`, IAM catalogue (`role`, `permission`, …) | global grant | none for IAM catalogue |
| Organisation | `institution`, `campus`, `department`, `programme` | any active mapped user (directory) | scope of the parent entity; `institution` service-role only |
| Anchored | 106 | scope-containing grant | same, non-SELF, where allowed |
| Identity/IAM | 9 (own rows or global IAM read) | own or global | none |
| `file_object` | 1 | uploader or global DOCUMENT read | none (storage RPC, later) |

## Tested (`npm run test:db`; 69 tests incl. finance RPCs)
anon denied · unmapped JWT sees nothing · DISABLED account sees nothing · student sees only own rows and cannot write them · institution registrar limited to own institution (students, employees) · department faculty limited to own department · DENY override beats ALLOW · super admin sees all · scoped write checks (announcement, campus) · no direct payment writes · no role-assignment/override/identity writes or reads of the map · `password_hash` unreadable · every table has RLS+policy · `anon` has zero grants · no write grants on financial/IAM/audit tables.

## Known limitations (see KNOWN_ISSUES.md)
- **Anchors are heuristic.** Only representative tables are tested; review RLS_POLICY_MAP.md before go-live. Wrong anchors usually fail closed but can over-grant when a non-ownership FK is treated as ownership.
- **Workflow guards (migration 020, generated from `tools/rls/workflow_guards.json`)**: transitions into/out of approved/verified/published states and approver/verifier metadata on 20 writable tables need `APPROVE`/`VERIFY`/`PUBLISH` at the row scope, and actor columns must equal the acting user. Enforced for the `authenticated` role only (RPCs/service role must authorise themselves). The column list is curated, not exhaustive: a workflow column not in the config is unguarded.
- `admission_applicant` has no tenant column, so only global `ADMISSION` grants can read it; institution admissions staff and applicants cannot yet. Needs a source-of-truth decision.
- Students and applicants currently cannot write anything (SELF writes require RPCs that do not exist yet).
- Staff scope for a student is evaluated through `student_programme_enrolment`; students without an enrolment are visible only to global grants and themselves.
- Reference and organisation tables are readable by every active user (directory data), including other institutions' names.
- Performance: helpers run per row; not yet profiled (`EXPLAIN ANALYZE` pending).
- Tests run on embedded Postgres with a stub of Supabase auth; PostgREST/JWT handling is not exercised.

## Update: anchor resolution (migration 029)
Multi-hop anchors are resolved through `SECURITY DEFINER` lookup functions (`sims_private.nx_*`), not caller-side subqueries, so a writer's access no longer depends on their read access to unrelated modules. The permission check still runs against the resolved anchor with the caller's identity. Tables whose policies were replaced by hand-written migrations (e.g. `admission_application`, 027) are excluded from regeneration (`SUPERSEDED` in `tools/build_rls.py`).
