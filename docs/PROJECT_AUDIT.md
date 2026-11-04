# SIMS – Project Audit (Phase 0)

Audit date: 2026-11-03. Working directory: `D:\Sims_2`.

## 1. Current architecture
There is none. `D:\Sims_2` is a greenfield directory containing only the two source files:

| File | Size | Role |
|---|---|---|
| `SIMS-DatabaseWithoutLessonPlan.sql` | 318 KB, 5,647 lines | MySQL 8.0.16+ schema, v6.5.1 review candidate (authoritative) |
| `SIMS_GEC_Haveri_Data_Dictionary (1).xlsx` | 204 KB | Data dictionary, 24 module sheets + index (reference only) |

Not a git repository. No `package.json`, no frontend, no backend, no `.env`, no deployment config.

## 2. Existing functionality / defects / debt / security
Nothing to review in this directory, so nothing can be overwritten. Security posture of the *source SQL* is in section 9.

Sibling directories exist outside this project (`D:\ERP`, `D:\SIMS-Django-Project`, holding older MySQL dumps and `M6..M9_SCHEMA_REVIEW.md`). They were **not** treated as part of this repository and were not modified. `SIMS_schema_review.md` (named by the SQL header) was **not found** on `D:\` (searched `*.md` to depth 3); see blockers.

## 3. Toolchain on this machine
| Tool | State |
|---|---|
| Node 22.17 / npm 10.9 | available |
| git 2.49 | available |
| Python 3.13 (psycopg2, pandas; openpyxl installed for this audit) | available |
| Docker 29.6 CLI | installed, **daemon not running** |
| Supabase CLI | **not installed** |
| psql / local PostgreSQL | **not installed** |
| MySQL 9.3 client/server binaries | on PATH (can baseline the source SQL if a server is started) |
| Supabase project URL / keys | **none provided** |

## 4. Recommended architecture
Per the brief: Next.js (App Router, strict TS) + Supabase (Postgres, Auth, RLS, Storage, Edge Functions). Business rules live in Postgres (constraints, triggers, `SECURITY DEFINER` RPCs); the Next.js layer is thin (validation, calling RPCs, rendering). Identity: `auth.users.id` (uuid) maps to a new table `auth_identity_map(auth_user_id uuid PK, user_id bigint FK user_account)`, writable only by privileged code; `user_account` links to employee/student through trusted DB relationships, never user-editable metadata.

## 5. Source schema facts (measured)
- 213 tables, 2,096 columns, 503 foreign-key clauses, 109 CHECK matches, 16 triggers, 10 views, 103 INSERT statements (seed data). The 6 `EVENT` text hits are seed strings; there is no MySQL `CREATE EVENT`.
- No stored functions or procedures. Triggers use `SIGNAL SQLSTATE '45000'` (26 uses) inside one `DELIMITER $$` block (lines 3070–3353).
- 13 `GENERATED ALWAYS AS ... STORED` columns (nullable-uniqueness keys such as `COALESCE(x,0)` and "current primary" keys).
- 118 `ENUM` columns, 775 `UNSIGNED`, 190 `AUTO_INCREMENT`, 37 `ON UPDATE CURRENT_TIMESTAMP`, 9 `JSON`, 3 `VARBINARY` (ciphertext for bank/PAN/Aadhaar), 2 post-hoc `ALTER TABLE` statements for forward references (lines 1600, 1604).
- Type census: VARCHAR 563, BIGINT 395, SMALLINT 224, BOOLEAN 166, ENUM 118, DATE 117, DECIMAL 111, TIMESTAMP 102, TINYINT 84, INT 62, DATETIME 62, TEXT 48, CHAR 17, YEAR 9, JSON 9, TIME 6, VARBINARY 3.

## 6. Migration risks
1. **Trigger logic is the highest-risk area.** Fee totals, payment allocation (with `FOR UPDATE` locking), scope validation and roster checks need equivalent PL/pgSQL, including concurrency behaviour.
2. **UNSIGNED + ENUM + YEAR + stored generated columns** need systematic, tested translation; regex alone is insufficient for edge cases.
3. **`utf8mb4_0900_ai_ci` is case/accent-insensitive.** Postgres `UNIQUE` on text is case-sensitive by default. For unique codes/emails/usernames the behaviour must be reproduced (`citext` or `lower()` indexes) or explicitly waived. Decision needed.
4. **The source SQL has never been executed** (header: "execution on MySQL ... remain required"). Source defects may only surface on a real run. Mitigation: run it on a MySQL server as a baseline and diff the introspected catalogues.
5. **Sensitive columns** (`*_ciphertext`): the source defines no encryption design or key custody; I will not invent one.
6. Supabase: `public` tables are exposed via PostgREST, so every table needs RLS (deny by default) before client access.

## 7. Blockers and decisions required
| # | Item | Needed from user |
|---|---|---|
| B1 | `SIMS_schema_review.md` not found | Provide it, or confirm it is unavailable. Until then no claim is made that the schema review is satisfied. |
| B2 | Supabase project and credentials | Needed only for cloud deployment; local work uses Postgres. |
| B3 | No local Postgres / Docker daemon / Supabase CLI | Start Docker Desktop (preferred; enables `supabase start`), or approve embedded Postgres (PGlite via npm) for migration validation only. |
| B4 | 52 dictionary-only tables (section 8) | Approve keep-out (default) or name tables to include. |
| B5 | Case-insensitive uniqueness (risk 3) | `citext` (recommended) or case-sensitive. |
| B6 | Aadhaar/PAN/bank ciphertext handling | Define encryption owner and key custody. |

## 8. Reconciliation summary (detail: `docs/SCHEMA_RECONCILIATION.md`)
All 213 SQL tables appear in the dictionary (no SQL-only tables). The dictionary has 52 extra tables, 11 extra views, and 2 shared tables with extra columns (a first draft said 3; see DATABASE_MIGRATION.md). Per the brief these are not silently added; they sit in the backlog.

## 9. Security observations on the source schema
- The header warns tenant authorization needs a context-aware service. Postgres views run as their owner and bypass RLS, so all views must be created `WITH (security_invoker = true)`.
- Legacy RBAC tables are "retained for reconciliation"; the effective-permission view becomes the basis of an RLS helper evaluated from a trusted identity map.
- Seed data grants permissions to roles; review before use in any environment with real users.

## 10. Implementation roadmap
See `docs/DEVELOPMENT_CHECKLIST.md`. Order: (1) translator + schema migrations validated on a real Postgres; (2) triggers/views with tests; (3) identity map, RBAC helpers, RLS; (4) storage; (5) Next.js shell, auth, dashboards; (6) module CRUD by priority (reference/institution, academic, student/employee, registration/attendance/assessment/results, finance, documents/activity); (7) test suites, security audit, docs.
