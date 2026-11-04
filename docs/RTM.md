# Requirements Traceability Matrix (RTM)

SIMS: MySQL to Supabase migration, backend and frontend.
Snapshot: 2026-11-04, repository `Ayush-Chugani/College-ERP`, `main`. Updated after migrations 040 to 043 (communication, IAM administration and audit viewer, student documents, student activities; the announcements module is the Communication implementation, M040_communication), the Playwright suite, the deployment files and the missing documents. Rows changed since the first snapshot are marked in the Status column; the evidence column names what exists.

This matrix traces every requirement of the **MASTER ENGINEERING PROMPT** (sections 2 to 18) to the design that answers it, the code that implements it, the tests that prove it and its honest status. It was written from the repository as it is, not from intentions: a row says **Done** only when the evidence column names something that exists and, where a test is claimed, that test was executed.

## How to read this document

**Status values**

| Status | Meaning |
|---|---|
| **Done** | Implemented, and the evidence executed (tests pass, build passes, or the database object was verified). |
| **Done (inferred rule)** | Implemented and tested, but the business rule is my inference because the source does not state it. It needs owner confirmation (see the KI number). |
| **Partial** | Some of the requirement is implemented. The Gap column says what is missing. |
| **Not started** | No implementation exists. |
| **Blocked** | Cannot proceed without something from the owner or an external system. |
| **Backlog** | Deliberately excluded until a source-of-truth decision is made. |

**Evidence conventions**

- `M###` is a file in `supabase/migrations/` (for example M031 is `031_attendance.sql`). M001 to M050 are applied to the live Supabase project `khqqfgqvwdxlqkncwtmh` (M044 to M050 on 2026-11-04 with `tools/apply_migrations.py`, after review). **M044 to M048 (staff profile, account features, record sections and reference data, receipts and holds, personal dashboard) are not applied to it yet.** M042 and M043 were reviewed and applied on 2026-11-04; the live check found the bucket `sims-documents` private (10 MB, PDF/JPEG/PNG only), three `sims_documents_*` Storage policies, no public bucket in the project, no `anon` execute on the 18 new functions and no client write grants on the activity tables. The Storage upload and signed-URL flow itself has **not** been run against the live project.
- `DB:` and `UT:` name the Vitest files in `tests/db/` and `tests/unit/`, with the number of tests in brackets.
- `KI-n` is an entry in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- Routes are paths under `src/app/(app)/`.

**Execution state behind this snapshot** (all run on 2026-11-04 on the development machine)

| Check | Result |
|---|---|
| `npx vitest run` | **551 passed, 0 failed** (51 files: 27 database files with 365 tests, 24 unit files with 186 tests) |
| `npx tsc --noEmit` | clean (strict mode, `noUncheckedIndexedAccess`) |
| `npm run lint` | clean |
| `npm run build` | succeeds |
| Migrations applied to the live project | 50 of 50 |
| Signed-in manual or browser verification of any screen | **Partly done on 2026-11-04**: signed in as the first super administrator (Auth user created in the dashboard, linked with `tools/bootstrap_admin.py`), the dashboard, the Users page and the Staff profile page were opened and looked right, and 26 other list and form pages returned 200 with no error text. The database is empty, so only empty states were seen: no create, edit, approve or search flow was exercised, no other role (student, faculty, finance) was tried, and the Create user form was not submitted (no service-role key) |
| Playwright end-to-end tests | **38 smoke tests pass** (desktop and phone); 4 signed-in tests skipped, no test user |
| Multi-connection (concurrent) tests | **not run** (the test database is single-connection embedded PostgreSQL) |

---

## 1. Headline summary

| Area | Status |
|---|---|
| Schema migration (213 tables, 500 FKs, 16 triggers, 10 views) | **Done**, catalogue comparison shows no differences, applied live |
| RLS on all tables, RBAC resolution, identity mapping | **Done**, tested on embedded PostgreSQL; sampled rather than exhaustive per table (KI-2) |
| Modules with working screens, RPCs and tests | 20 of 23 are built (some with gaps), 3 are partial, none is unstarted |
| Supabase Storage / document workflows | **Partial**: student documents (private bucket, policies, signed URLs, review); other document kinds not started |
| Supabase Auth flows in the app | Built; **never exercised signed in** |
| Edge Functions | **Not started** (not needed so far; RPCs were used) |
| Security audit report, testing report, deployment guide | **Done** (self-review; nothing deployed). Playwright smoke suite **Partial**. Performance report **Not started** |
| Lesson Plan and the 52 dictionary-only tables | **Backlog** (needs your decision) |

---

## 2. Source traceability (prompt section 2)

| ID | Requirement | Design / implementation | Evidence | Status | Gap or note |
|---|---|---|---|---|---|
| R-SRC-1 | Treat `SIMS-DatabaseWithoutLessonPlan.sql` as the authoritative source | `tools/translate.py` and `tools/build_migrations.py` generate M001 to M016 from the SQL; the SQL file is kept in the repository root | [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md), `tools/compare_catalogue.py` | Done | |
| R-SRC-2 | Use the Excel dictionary to understand relationships and meaning | Dictionary read by `tools/reconcile.py`; module codes in `tools/rls/table_module.json` (265 tables) | [SCHEMA_RECONCILIATION.md](SCHEMA_RECONCILIATION.md) | Done | |
| R-SRC-3 | Generate a source-to-target reconciliation report | `tools/write_reconciliation_md.py` | [SCHEMA_RECONCILIATION.md](SCHEMA_RECONCILIATION.md) | Done | |
| R-SRC-4 | Identify missing tables, columns, relationships, views | Dictionary 265 tables vs SQL 213 tables: 52 dictionary-only tables listed | [SCHEMA_RECONCILIATION.md](SCHEMA_RECONCILIATION.md) | Done | |
| R-SRC-5 | Do not silently introduce the 52 extra tables or Lesson Plan | None of them were created | `tests/db/schema.test.ts` asserts exactly 213 tables (DB: schema [17]) | Done | |
| R-SRC-6 | Keep unresolved differences in a migration backlog | KI-9 (source defect SD-1), KI-11 (52 tables, Lesson Plan, missing `SIMS_schema_review.md`) | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Done | Decisions still owed by you |
| R-SRC-7 | Do not invent business rules the source does not establish | Every inferred rule is flagged for confirmation: KI-28, 31, 35, 38, 40, 43, 46, 47, 49, 50 | Migration headers list the numbered assumptions | Done (flagged) | The rules themselves still need your confirmation |
| R-SRC-8 | Record the `SIMS_schema_review.md` dependency | Recorded as unavailable | KI-11 | Done | Request the file before claiming the review is satisfied |

---

## 3. Technology stack (prompt section 3)

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-STK-1 | Next.js App Router, React, strict TypeScript | `package.json` (Next 15.5, React 19, TS 5.9), `tsconfig.json` strict, `npx tsc --noEmit` clean | Done | |
| R-STK-2 | Tailwind CSS | Tailwind 4, `src/app/globals.css` | Done | |
| R-STK-3 | shadcn/ui | `src/components/ui/{button,card,input}.tsx` are hand-written components in the shadcn style (class-variance-authority, tailwind-merge); the shadcn CLI and its other components are not used | Partial | Say so plainly: the look follows shadcn, the library is not installed |
| R-STK-4 | Lucide icons | `lucide-react` is a dependency | Partial | Installed; icons are used very little |
| R-STK-5 | React Hook Form and Zod | Every create/edit form uses `useForm` with `zodResolver`; schemas in `src/lib/*-validation.ts` | Done | |
| R-STK-6 | TanStack Query where it helps | `@tanstack/react-query` is installed but **not used**: data is loaded in server components and mutations call Supabase then `router.refresh()` | Not started | Deliberate, because server components removed the need; remove the dependency or adopt it |
| R-STK-7 | Recharts | `src/components/charts.tsx` used by `/dashboard` and `/feedback/results/*` | Done | |
| R-STK-8 | Supabase, PostgreSQL, Auth, RLS | Live project `khqqfgqvwdxlqkncwtmh`, PostgreSQL 17 | Done | |
| R-STK-9 | Supabase Storage | Nothing uses Storage | Not started | See section 8 |
| R-STK-10 | Supabase Edge Functions | `supabase/functions/` does not exist; privileged workflows are SECURITY DEFINER RPCs | Not started | Acceptable by the prompt ("RPC or Edge Functions"); no Edge Function is needed until payment-gateway or email integrations arrive |
| R-STK-11 | PostgreSQL functions, RPC and triggers | M014, M017 to M039 | Done | |
| R-STK-12 | Git | Repository initialised and pushed to `Ayush-Chugani/College-ERP` | Done | |
| R-STK-13 | ESLint and Prettier | `eslint.config.mjs` (flat config), `.prettierrc.json`, `npm run lint`, `npm run format` | Done | |
| R-STK-14 | Vitest | 391 tests | Done | |
| R-STK-15 | Playwright | `playwright.config.ts`; `tests/e2e/smoke.spec.ts` (public pages, route protection, phone-width check) and `tests/e2e/auth.spec.ts` (sign-in flow, skipped without `E2E_EMAIL` / `E2E_PASSWORD`); `npm run test:e2e` | Partial | 38 smoke tests pass on desktop and phone projects; the signed-in flow has never run against a real project |
| R-STK-16 | Supabase CLI and migration-based version control | Migrations are versioned SQL files in `supabase/migrations/`; `supabase/config.toml` now exists (auth redirect URLs, sign-up off, password length 12). M001 to M039 were applied to the live project with a Python script; M040 to M042 have **not** been applied anywhere except the embedded test database | Partial | Run `supabase link` and `supabase db push` (DEPLOYMENT_GUIDE.md); the CLI itself was not run here |
| R-STK-17 | No unnecessary backend frameworks; PostgreSQL authoritative | No separate backend server exists | Done | |

---

## 4. Phase 0: project audit (prompt section 4)

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-P0-1 | Inspect the complete repository and both sources | The repository was empty apart from the two source files | Done | |
| R-P0-2 | `docs/PROJECT_AUDIT.md` with the 10 listed sections | [PROJECT_AUDIT.md](PROJECT_AUDIT.md) | Done | Written at the start; later phases are tracked in IMPLEMENTATION_STATUS |
| R-P0-3 | Create and maintain a development checklist | [DEVELOPMENT_CHECKLIST.md](DEVELOPMENT_CHECKLIST.md) | Partial | The checklist is coarse and stale; [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) carries the real status and this RTM supersedes the checklist |

---

## 5. Phase 1: MySQL to PostgreSQL (prompt section 5)

### 5.1 Translation rules

| ID | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| R-P1-1 | AUTO_INCREMENT to identity | `GENERATED BY DEFAULT AS IDENTITY` | M001 to M013; DB: schema [17] | Done |
| R-P1-2 | UNSIGNED integers with range checks | Domains `u8, u16, u24, u32, u64, u_year` with CHECKs | M001; DB: schema | Done |
| R-P1-3 | ENUM | `text` plus named CHECK `enum_<column>` (119 checks) | M001 to M013 | Done |
| R-P1-4 | BOOLEAN | `boolean` | M001 to M013 | Done |
| R-P1-5 | TIMESTAMP defaults and time zones | `timestamptz` | M001 to M013 | Done |
| R-P1-6 | ON UPDATE CURRENT_TIMESTAMP | 37 `trg_*_touch_updated_at` triggers | M014; DB: schema asserts the count | Done |
| R-P1-7 | Generated columns | Native `GENERATED ALWAYS AS` (for example `class_batch_key`, current-primary keys) | DB: employees [13] tests current-primary uniqueness | Done |
| R-P1-8 | Indexes | 104 named indexes all present | `tools/compare_catalogue.py`; M009, M012 | Done |
| R-P1-9 | Foreign keys | 500 of 500 | catalogue comparison | Done |
| R-P1-10 | CHECK constraints | 101 of 101 preserved (plus 119 enum checks) | catalogue comparison | Done |
| R-P1-11 | INSERT IGNORE to ON CONFLICT | Seed data translated | M011 | Done |
| R-P1-12 | ON DUPLICATE KEY UPDATE to UPSERT | Same | M011 | Done |
| R-P1-13 | Views | 10 of 10, all `security_invoker = true` | M006, M007, M008, M012, M013; DB: schema | Done |
| R-P1-14 | Triggers to PL/pgSQL | 16 source triggers ported by hand | `tools/work/triggers_pg.sql` (local, ignored by git), M014; DB: schema, finance [14] | Done |
| R-P1-15 | MySQL functions and expressions | Translated by `tools/translate.py` | M001 to M013 | Done |

### 5.2 What must be preserved

| ID | Requirement | Evidence | Status |
|---|---|---|---|
| R-P1-16 | Table and column names, PKs, FKs, nullability, defaults, unique constraints, invariants | Catalogue comparison: 213/213 tables, 2,099/2,099 columns, 213/213 PKs, 500/500 FKs, 249/249 uniques, 101/101 checks | Done |
| R-P1-17 | Do not remove important constraints | Nothing removed. One source defect (SD-1: duplicate `ALTER TABLE file_object ADD COLUMN`) was skipped and documented | Done (KI-9 needs owner confirmation) |

### 5.3 Migration structure and validation

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-P1-18 | Clean `supabase/migrations/` with meaningful sequential names | 39 files (section 12) | Done | Names follow the real dependencies, not the prompt's suggested list |
| R-P1-19 | Migration comparison report: tables, columns, PK, FK, unique, check, index, trigger, view | [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) "Equivalence report" | Done | |
| R-P1-20 | Seed-data equivalence | M011 carries the source seed data | Partial | A row-by-row seed comparison was not run |
| R-P1-21 | Trigger behaviour equivalence | Each ported trigger has a test | DB: finance [14], schema [17], employees [13] | Done | Not compared against a running MySQL |
| R-P1-22 | Works on a fresh Supabase project | Applied to the empty live project; 16/16 then 39/39 migrations | DATABASE_MIGRATION.md; live `schema_migrations` | Done | |
| R-P1-23 | No destructive migration against production | None executed; only additive migrations | | Done | |
| R-P1-24 | Source SQL executed on MySQL as a baseline | Not done | | Not started | MySQL was not available |
| R-P1-25 | Every discrepancy documented | SD-1, ENUM translation, identity resync (M015), 3 `file_object` columns | DATABASE_MIGRATION.md | Done | |

---

## 6. Phase 2: Supabase backend (prompt section 6)

### 6.1 Authentication

| ID | Requirement | Implementation | Evidence | Status | Gap or note |
|---|---|---|---|---|---|
| R-AUTH-1 | Registration where permitted | Self-registration stays off (sign-up disabled). Administrators create users: `/admin/users/new` (server action with the service-role key) and `tools/create_admin.mjs` for the first administrator (M049) | DB: user-provisioning [6]; UT: user-provisioning [6] | Partial | Not run against a real Supabase project (needs your service-role key); applicant self-registration is not built (KI-29, KI-62) |
| R-AUTH-2 | Login | `src/app/(auth)/login` | Build; no signed-in test | Partial | Never exercised with a real user |
| R-AUTH-3 | Logout | `src/app/auth/signout/route.ts` | Build | Partial | Same |
| R-AUTH-4 | Forgot password | `src/app/(auth)/forgot-password` | Build | Partial | Needs Auth redirect settings (R-AUTH-10) |
| R-AUTH-5 | Password reset | `src/app/(auth)/reset-password`, `src/app/auth/callback/route.ts` | Build | Partial | Same |
| R-AUTH-6 | Email verification | Callback route handles Supabase email links | Build | Partial | Not exercised; SMTP not configured (KI-15) |
| R-AUTH-7 | Session management, protected routes, session-expiry handling | `src/middleware.ts` and `src/lib/supabase/middleware.ts` refresh the session and redirect; `requireContext()` in `src/lib/server-context.ts`; `/no-access` | UT: lib [8] covers `safeNextPath` and navigation | Partial | No automated route-protection test |
| R-AUTH-8 | User profile management | `/settings`: profile, contact details form (`my_profile`, `my_profile_update`, M045: own email and phone only, audited), change password, recent sign-ins | DB: account-features [14]; UT: account | Done | Name, roles and scopes stay administrator-managed; never used signed in |
| R-AUTH-9 | Account activation and deactivation | `iam_set_account_status` (M041) and `/admin/users/[id]`: ACTIVE / DISABLED / LOCKED with a reason, confirmation step, own-account and last-super-admin protection, audit row; a disabled account resolves to no identity | DB: iam-admin [8], rls [30]; UT: iam | Done | Not exercised signed in (no Auth user yet); KI-52 |
| R-AUTH-10 | Auth dashboard configuration (redirect URLs, SMTP, sign-up policy) | Documented steps | KI-15 | **Blocked** | Needs you in the Supabase dashboard |
| R-AUTH-11 | First administrator | `tools/bootstrap_admin.py` (one transaction, verifies identity resolution) | Script tested logically only | **Blocked** | The live project has 0 Auth users; you must create the first user in the dashboard (KI-3) |

### 6.2 Identity mapping and RBAC

| ID | Requirement | Implementation | Evidence | Status | Gap or note |
|---|---|---|---|---|---|
| R-RBAC-1 | Secure identity mapping; Auth id is never a student or employee id | `sims_private.auth_identity_map` (auth uid to `user_account`), written only by `link_auth_user()` | M017; DB: rls [30] | Done | |
| R-RBAC-2 | Map to the legacy catalogue (roles, permissions, modules, resources, actions, assignments, overrides, role permissions, scopes) | `sims_private.eff()` over the source view `v_effective_user_permission` | M017; [AUTHENTICATION_AND_RBAC.md](AUTHENTICATION_AND_RBAC.md) | Done | |
| R-RBAC-3 | Effective permission resolution | Scope containment, DENY wins, SELF read-only | M017; DB: rls [30] | Done (inferred rule) | "DENY at any covering scope wins" is stricter than the source view; flagged in AUTHENTICATION_AND_RBAC.md |
| R-RBAC-4 | Scopes: institution, campus, department, programme, student, employee | `can_global/institution/campus/department/programme/student/employee` | M017; DB: rls | Done | |
| R-RBAC-5 | Never trust frontend role or institution ids | Every RPC derives identity from `auth.uid()`; `my_context()` is read-only | M019, all RPC migrations | Done | |
| R-RBAC-6 | Sensitive actions need explicit authorisation (delete, approve documents, change financials, export protected data) | Workflow guards on 20 tables / 63 columns; money RPC-only; sensitive resources need their specific grant | M020, M021; DB: rls [30], finance [14] | Partial | Guards cover a curated list (KI-1); export is not built |
| R-RBAC-7 | Admin RPCs: assign roles, overrides, link users | `iam_assign_role`, `iam_revoke_role`, `iam_user_list`, `iam_user_detail`, `iam_roles` (M041) and `/admin/users`; SUPER_ADMIN grants restricted to super administrators; scope must match the role level | DB: iam-admin [8] | Partial | Permission overrides and linking Auth users to students or employees have no RPC or screen (KI-52) |
| R-RBAC-8 | MFA | TOTP via Supabase Auth: enrol / turn off in `/settings`, code step in `/mfa` after the password (`requireContext` redirects there). The database enforces it: once a verified factor exists (`mfa_sync`, M045) `sims_private.current_user_id()` resolves an identity only for aal2 sessions | DB: account-features [14] (aal1 sees nothing, aal2 works, removal lifts it); UT: account | Partial | The enrolment and challenge screens have never run against a real Supabase Auth project; MFA must also be enabled in the dashboard; no "require MFA for role X" policy (KI-57) |

### 6.3 Row-level security

| ID | Requirement | Implementation | Evidence | Status | Gap or note |
|---|---|---|---|---|---|
| R-RLS-1 | RLS enabled on all tables exposed to clients | 213 of 213 tables | M016, M018; DB: rls asserts "every table has RLS and a policy" | Done | |
| R-RLS-2 | SELECT, INSERT, UPDATE and DELETE policies | Generated per table by `tools/build_rls.py` (anchor = shortest FK path) | M018, M029; [RLS_POLICY_MAP.md](RLS_POLICY_MAP.md) | Done | Anchors are heuristics; reviewed on sampled tables (KI-2) |
| R-RLS-3 | Institution and organisation boundaries; no cross-institution leakage | Scope containment in policies | DB: rls [30], plus a cross-institution case in each module's DB test | Done | |
| R-RLS-4 | Student ownership | SELF scope | DB: rls, students [9], grievance [12], assessment [25] | Done | |
| R-RLS-5 | Faculty and department access; administrator privileges | Department and global scopes | DB: rls, attendance [15], timetable [12] | Done | |
| R-RLS-6 | Prevent privilege escalation | `anon` has 0 grants; `authenticated` cannot touch the identity map or IAM writes; RPC-only tables lose client write grants | DB: rls asserts anon grants = 0 | Done | |
| R-RLS-7 | Context-aware tenant authorisation, not a view alone | SECURITY DEFINER helpers in the private schema; policies call them | M017, M029 | Done | |
| R-RLS-8 | Do not use user-editable metadata for access | Only `auth.uid()` from the verified JWT is read | M017 | Done | |
| R-RLS-9 | Test authorised and unauthorised access | Each module's DB test includes allowed and refused callers | 258 database tests | Done | |
| R-RLS-10 | Multi-hop anchor lookups work for users without cross-module read | 34 definer lookups | M029; DB: registration [16] regression | Done | Fixed a real defect (KI-33) |

### 6.4 Backend services

| ID | Requirement | Implementation | Status | Gap or note |
|---|---|---|---|---|
| R-SVC-1 | Reusable service layer per module with validation, authorisation, business logic, DB operations, error handling, logging, transactions, response formatting | Validation: `src/lib/*-validation.ts` (Zod). Data access: `src/features/*-data.ts`. Authorisation, business logic and transactions: PostgreSQL functions (one transaction each). Error mapping: `dbMessage()` in each forms file. | Partial | There is no application logging layer; auditing is in the database; logging of server errors is the framework default |
| R-SVC-2 | RPC or Edge Functions for multi-table privileged workflows | 76 public PostgreSQL functions in M019 to M039 (see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)) | Done | |
| R-SVC-3 | Service-role key never exposed to the frontend | Only the publishable key is in `.env.local`; the service-role key is not used anywhere | Done | Security audit report not yet written (R-SEC-12) |

---

## 7. Phase 3: modules (prompt section 7)

### 7.1 Module status

Table counts come from the dictionary map in `tools/rls/table_module.json` (265 tables; the SQL contains 213 of them). "Screens" are routes under `src/app/(app)/`.

| # | Module | Tables | Status | Migrations | Screens | Tests | Open issues |
|---|---|---|---|---|---|---|---|
| 1 | Platform and Reference Data | 25 | **Built (gaps)** | M001, M011 (seed), M016, M018, M046 | `/admin/reference`, `/admin/reference/[table]`: 32 lists (genders, castes, countries, states, document types, qualification levels, designations, staff-profile lists, fee configuration) | DB: sections-reference [12], schema [17], rls [30]; UT: records | KI-58: the system, module and event tables (`system_module`, `outbox_event` ...) have no screens; fee configuration needs a GLOBAL FEES grant that no seeded role holds (KI-45) |
| 2 | Identity and Access Management | 29 | **Partial** | M006, M015, M017, M019, M020, M041 | login, forgot and reset password, `/settings`, `/no-access`, `/admin/users` (list, status, roles) | DB: rls [30], iam-admin [8]; UT: iam | KI-3, KI-15, KI-52; no override or user-linking screens, no MFA |
| 3 | University and Institution | 8 | **Built (gaps)** | M025 | `/structure`, `/structure/[kind]/[id]`, `/structure/[kind]/new` | DB: structure [9]; UT: structure [10] | KI-22, KI-23, KI-25: no screens for buildings, rooms, specialisations |
| 4 | Academic Calendar | 4 | **Built (gaps)** | M024 | `/calendar` (years, terms, semesters) | DB: academic [11]; UT: academic [7] | KI-22; no `time_slot` screens (KI-44) |
| 5 | Curriculum and Course Catalogue | 5 | **Built (gaps)** | M026 | `/curriculum`, `/courses`, `/courses/categories` | DB: courses [8]; UT: courses [10] | KI-24, KI-26, KI-27 |
| 6 | Student Management | 6 | **Built (gaps)** | M022, M046 | `/students` (list, detail, create, edit, status), `/students/[id]/records` (addresses, parents and guardians, previous education, entrance exams, residence) | DB: students [9], sections-reference [12]; UT: students [7], records | KI-6, KI-7, KI-8, KI-17, KI-19, KI-58; the student cannot edit these records themself (staff-managed) |
| 7 | Employee Management | 26 | **Built (gaps)** | M023, M046 | `/employees` (list, detail, create, edit, assign, status), `/employees/[id]/records` (addresses, qualifications, previous employment) | DB: employees [13], sections-reference [12]; UT: employees [7], records | KI-20, KI-21, KI-58: PAN, Aadhaar and bank accounts wait for the encryption-owner decision (KI-8); HR documents and competencies have no screen |
| 8 | Document Management | 5 | **Partial** | M005, M009 (schema), M042 | `/my-documents`, `/students/[id]/documents` | DB: student-documents [12]; UT: documents | KI-53: student documents only; see section 8 |
| 9 | Audit and Compliance | 1 | **Built (gaps)** | M006, M022, per-module audit triggers, M041, M045 | `/audit`, `/audit/[id]`, `/audit/logins` | DB: iam-admin [8], account-features [14] and audit assertions inside module tests | KI-19, KI-57; writes only (plus logged document downloads), no export |
| 10 | Communication | 3 | **Built (gaps)** | M005 (schema), M040 | `/announcements` (feed), `/announcements/manage`, `/announcements/new`, `/announcements/[id]`, `/announcements/[id]/edit` | DB: communication [18]; UT: communication [7] | KI-51: no attachments, no notification delivery; the author cannot approve their own announcement |
| 11 | Admissions | 4 | **Built** | M027 | `/admissions` (list, detail, new, categories) | DB: admissions [16]; UT: admissions [9] | KI-28, KI-29, KI-30 |
| 12 | Student Registration | 6 | **Built** | M028, M030 | `/registration` (offerings, term registration, course registration) | DB: registration [16]; UT: registration [7] | KI-31, KI-32, KI-34 |
| 13 | Teaching Allocation | 3 | **Built (inside Attendance)** | M031 | `/attendance/section/[id]` (sections, instructor assignments, roster) | DB: attendance [15] | KI-34, KI-37 |
| 14 | Timetable | 1 | **Built (gaps)** | M035 | `/timetable`, `/timetable/[id]` | DB: timetable [12]; UT: timetable [8] | KI-43, KI-44 |
| 15 | Attendance | 4 | **Built** | M031 | `/attendance` (sections, sessions, marking, corrections, statuses) | DB: attendance [15]; UT: attendance [8] | KI-35, KI-36, KI-37 |
| 16 | Assessment | 3 | **Built** | M032, M033 | `/assessment`, `/assessment/offering/[id]`, `/assessment/event/[id]` | DB: assessment [25]; UT: assessment [9] | KI-38, KI-39 |
| 17 | Results | 4 | **Built** | M032, M033 | `/results/term/[id]`, `/results/grades`, `/my-results` | DB: assessment [25]; UT: assessment [9] | KI-38, KI-39 |
| 18 | Feedback | 8 | **Built** | M037 | `/feedback`, `/feedback/give/[cycle]`, `/feedback/results/*`, `/feedback/setup` | DB: feedback [19]; UT: feedback [10] | KI-46, KI-47, KI-48 |
| 19 | Mentoring | 2 | **Built** | M038 | `/mentoring`, `/mentoring/[id]` | DB: mentoring [15]; UT: mentoring [6] | KI-49 |
| 20 | Grievance Management | 3 | **Built** | M039 | `/grievances`, `/grievances/[id]` | DB: grievance [12]; UT: grievance [8] | KI-50 (no handler role exists) |
| 21 | Student Finance and Fees | 31 | **Partial** | M008, M014, M021, M034, M046, M047 | `/finance`, `/finance/account/[id]`, `/finance/receipt/[id]`, `/admin/reference/<fee list>` | DB: finance [14], finance-read [7], finance-receipts [6]; UT: finance [10], finance-extras | KI-16, KI-40, KI-41, KI-42, KI-59: no RPC or UI to apply concessions, scholarships or sponsorships to an assessment, no instalments, late fees, penalties or adjustments, no fee-structure approval screens |
| 22 | Staff Profile and Research | 55 | **Built (gaps)** | M010, M011, M012 (schema), M044 | `/staff-profile` (list, summary), `/staff-profile/new`, `/staff-profile/[id]` (details, contributors, evidence, submit, verify, approve) | DB: staff-profile [18]; UT: staff | KI-55: 12 detail kinds covered; no screens for research supervision, journal metrics, project financial utilisation, indexing rows or the 25 lookup tables |
| 23 | Student Activity and Evidence | 7 | **Built (gaps)** | M011, M013 (schema), M043 | `/activities` (list, summary report), `/activities/new`, `/activities/[id]` (details, team, evidence, submit, verify, approve) | DB: student-activities [14]; UT: activities | KI-54: no requirement-matrix or type management screens, no external-organisation lookup, no export |
| - | Dashboards (cross-cutting) | n/a | **Built (gaps)** | M036 | `/dashboard` | DB: dashboard [10]; UT: dashboard [9] | KI-45 |
| - | Lesson Plan | 22 | **Backlog** | none | none | none | Needs a source-of-truth decision (KI-11) |

Counts: **Built or Built (gaps): 20 modules (1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23); Partial: 3 modules (2, 8, 21); Not started: 0 modules.** That is 23 in total. Dashboards are cross-cutting and not counted. Student Finance is Partial because most of its 31 tables have no workflow.

### 7.2 Per-module feature matrix

The prompt requires every module to have: dashboard, list, detail, create, edit, delete or deactivate, search, filters, sorting, pagination, validation, backend service, authorisation, audit, reports and tests.

Legend: Y = implemented and tested, P = partly, N = not implemented, n/a = does not apply to the module.

| Module | Dash | List | Detail | Create | Edit | Del/deact | Search | Filter | Sort | Page | Valid. | Service | Authz | Audit | Reports | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Institution structure | P | Y | Y | Y | Y | Y | N | N | N | N | Y | Y | Y | Y | N | Y |
| Academic calendar | P | Y | Y | Y | Y | Y | N | N | N | N | Y | Y | Y | Y | N | Y |
| Curriculum and courses | P | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y | Y | Y | N | Y |
| Students | P | Y | Y | Y | Y | Y (status) | Y | Y | Y | Y | Y | Y | Y | Y | N | Y |
| Employees | P | Y | Y | Y | Y | Y (status) | Y | Y | Y | Y | Y | Y | Y | Y | N | Y |
| Admissions | P | Y | Y | Y | Y | P (cancel, no delete) | Y | Y | N | Y | Y | Y | Y | Y | N | Y |
| Registration | P | Y | Y | Y | Y | Y | N | Y | N | Y | Y | Y | Y | Y | N | Y |
| Teaching and attendance | P | Y | Y | Y | Y | Y | N | Y | N | Y | Y | Y | Y | Y | P (per-student summary) | Y |
| Timetable | N | Y | Y | Y | P (end-date only) | P (end-date only) | N | Y | N | Y | Y | Y | Y | Y | N | Y |
| Assessment and results | P | Y | Y | Y | P | Y | N | Y | N | Y | Y | Y | Y | Y | P (sheets) | Y |
| Finance | P | Y | Y | Y | N | N (by design) | Y | Y | N | Y | Y | Y | Y | Y | P (dashboard) | Y |
| Feedback | P | Y | Y | Y | N | N | N | N | N | N | Y | Y | Y | Y | Y (results) | Y |
| Mentoring | N | Y | Y | Y | Y (sessions) | Y (end) | Y | Y | N | Y | Y | Y | Y | Y | N | Y |
| Grievance | N | Y | Y | Y | N | Y (close) | Y | Y | P (priority order) | Y | Y | Y | Y | Y | N | Y |

Reading the matrix: server-side sorting is mostly fixed (not user-selectable); only the student and employee lists let the user choose the sort. Reports are not built as a feature in any module beyond result sheets, the attendance summary, feedback results and the dashboard. These are gaps against the prompt's "relevant reports" line.

---

## 8. Phase 4: file and document management (prompt section 8)

**Only student documents are built** (M042); everything else in this phase is still schema only. The `file_object`, `student_document`, `employee_document` and related tables exist as schema (M005, M007, M009), and the workflow guard on verification columns exists (M020), but there is no Storage bucket, no upload, no download and no document screen.

| ID | Requirement | Status |
|---|---|---|
| R-DOC-1 | Secure workflows for student documents, employee documents, qualification and experience certificates, identity evidence, student activity evidence, achievement certificates, other document types | Partial: **student documents** (M042, `/my-documents`, `/students/[id]/documents`). Student activity evidence (M043) and staff evidence (M044, `employee/<id>/` prefix): done, same bucket and rules, versioned, downloads logged. Employee documents, certificates, announcement attachments: not started (KI-53, KI-54) |
| R-DOC-2 | Private buckets by default | Done: `sims-documents` is private (M042); asserted in DB: student-documents |
| R-DOC-3 | Signed URLs for controlled downloads | Done: 60-second signed URL after `student_document_download_info` authorises and logs; signed URL creation itself is not exercised in tests (needs real Storage) |
| R-DOC-4 | File type and size validation, secure upload and download | Done for student documents: PDF, JPEG, PNG, 10 MB, name must match type, checked in the browser, the RPC and the bucket (UT: documents; DB: student-documents). No virus scanning (KI-53) |
| R-DOC-5 | Document metadata (`file_object`) | Done for student documents: written only by `student_document_register`, never by clients |
| R-DOC-6 | Versioning, verification status, approval status, confidentiality levels, expiry, audit history | Partial: verification status, expiry (shown as EXPIRED) and audit history for student documents; no versioning, no approval step, only CONFIDENTIAL level |
| R-DOC-7 | Storage policies equal to the database permissions | Done for the student prefix: SELECT / INSERT by owner or `DOCUMENT.ALL.READ` / `CREATE` at the student's scope, DELETE only for orphans, no UPDATE (DB: student-documents) |
| R-DOC-8 | Never log document contents, passwords or Aadhaar numbers | Done: only metadata and a download event are logged; `user_account` is not row-audited because its row holds `password_hash`; counselling notes are kept out of the audit log (M038) |

---

## 9. Phase 5: frontend (prompt section 9)

### 9.1 Layout and design

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-FE-1 | Login page | `(auth)/login` | Partial | Not exercised signed in |
| R-FE-2 | Forgot password page | `(auth)/forgot-password` | Partial | Same |
| R-FE-3 | Main layout, sidebar, top navigation | `src/components/app-shell.tsx`; `src/lib/nav.ts` shows items by readable module | Done | UT: lib [8] tests visibility |
| R-FE-4 | User profile menu | Signed-in user and sign-out in the shell; `/settings` | Partial | |
| R-FE-5 | Notifications | Bell with count in the header, `/notifications`; `my_notifications`, `my_notification_count`, `notification_dismiss[_all]` (M045): announcements, decisions on own documents, activities, staff records and grievances, review queues for reviewers; links restricted to same-site paths | DB: account-features [14]; UT: account | Done | Computed on request (no push, no email); dismissal only (no read history) (KI-57) |
| R-FE-6 | Breadcrumb navigation | `Breadcrumbs` in `app-shell.tsx` | Done | Built from the navigation list, not from deep routes |
| R-FE-7 | Global search | Search box in the header, `/search`; `global_search` (M045, SECURITY INVOKER so RLS applies) over students, employees, courses, programmes, departments | DB: account-features [14]; UT: account | Done | Does not search admissions, grievances, activities, finance or documents (each has its own search) |
| R-FE-8 | Dashboard | `/dashboard` | Partial | One dashboard that adapts to readable modules (section 9.2) |
| R-FE-9 | Module navigation | `NAV_ITEMS` (20 entries) | Done | Only pages that exist are listed |
| R-FE-10 | Settings page | `/settings` (profile, contact details, change password, two-step verification, recent sign-ins) | Done | |
| R-FE-11 | Professional light theme, accessible forms, responsive layouts, consistent spacing | Light theme in `globals.css`; labels, `aria-*` and roles on forms and tables | Partial | Not visually reviewed in a browser beyond the login screen; no responsive test |
| R-FE-12 | Loading and error states, confirmation dialogs, toasts | `sonner` toasts; confirm steps on destructive and status actions; error banners on lists; `(app)/loading.tsx` skeleton, `(app)/error.tsx` boundary with retry, root `not-found.tsx` | Done | Per-route skeletons are not written; one shared skeleton |
| R-FE-13 | Every button performs its action, every form connects to a real service, every table shows real records, no hard-coded metrics or fabricated records | All data comes from the database through RLS or RPCs; empty states are written for each list | Done | Verified by code review and database tests, not by clicking |

### 9.2 Role-sensitive dashboards

One page serves every role. It shows a count tile for each readable module and the chart sections for the modules the user can read (RLS scopes every number). It is not a separate design per role.

| ID | Required dashboard | Status | Note |
|---|---|---|---|
| R-DASH-1 | Super Administrator | Partial | Sees global counts and charts; sees no fee figures because the seeded SUPER_ADMIN holds no FEES permission (KI-45) |
| R-DASH-2 | Institution Administrator | Partial | Same page, scoped to the institution |
| R-DASH-3 | Head of Department | Partial | Same page, scoped to the department |
| R-DASH-4 | Programme Coordinator | Partial | Same page, scoped to the programme |
| R-DASH-5 | Faculty | Partial | Dashboard card "My teaching" (`my_dashboard`, M048): active sections, sessions of the next 7 days with links to marking, past sessions still unmarked; no timetable grid |
| R-DASH-6 | Student | Partial | Cards "My results", "Today's classes" and "My attendance" (per course, low under 75% marked; M048); no fees view until students are given a FEES permission (KI-41, D-5) |
| R-DASH-7 | Finance Officer | Partial | Fee totals and monthly collection chart |
| R-DASH-8 | Examination Staff | Partial | Term results chart |
| R-DASH-9 | HR Staff | Partial | Employee counts only |

---

## 10. Phase 6: business logic and transactions (prompt section 10)

### 10.1 Integrity rules to implement

| ID | Rule | Where it is enforced | Evidence | Status |
|---|---|---|---|---|
| R-BL-1 | Programme-specialisation ownership | Composite FKs from the source (migrated) | M002, M003; DB: schema | Done |
| R-BL-2 | Department-campus ownership | Composite FKs; institution immutability trigger for employees | M014, M023; DB: employees [13] | Done |
| R-BL-3 | Section and batch ownership | Composite FKs; `class_batch_key` generated column | M003, M031; DB: attendance [15] | Done |
| R-BL-4 | Course registration integrity | Guard triggers (same programme-term, ACTIVE enrolment, capacities under row locks) | M028; DB: registration [16] | Done (inferred rule, KI-31) |
| R-BL-5 | Attendance roster integrity | Roster must be ACTIVE in the section; ownership guard on instructor assignments | M031; DB: attendance [15] | Done (inferred rule, KI-35) |
| R-BL-6 | Assessment-course integrity | Marks must belong to the offering's registered students and not exceed event maximums | M032; DB: assessment [25] | Done (inferred rule, KI-38) |
| R-BL-7 | Employee current-primary assignment | Generated-column unique key | M014; DB: employees [13] | Done |
| R-BL-8 | Effective permissions | `sims_private.eff()` | M017; DB: rls [30] | Done |
| R-BL-9 | Fee calculations | Net amount computed in `fin_create_fee_assessment`; header totals through the source triggers | M014, M021; DB: finance [14] | Done |
| R-BL-10 | Payment allocations | `fin_allocate_payment` with row locks and source triggers | M021; DB: finance | Done (concurrency not tested) |
| R-BL-11 | Refund calculations | `fin_request_refund`, `fin_decide_refund`, `fin_process_refund` | M021; DB: finance | Done (concurrency not tested) |
| R-BL-12 | Fee benefits | Source triggers exist (M014). Concession types, scholarship schemes, instalment plans and late-fee rules can now be maintained as reference data (M046, needs a GLOBAL FEES grant); there is still no RPC or screen that applies a concession, scholarship or sponsorship to a student assessment | M014, M046 | Partial (KI-42, KI-59) |
| R-BL-13 | Student and employee document verification | Student: `student_document_review` (M042) over the M020 guard, PENDING to VERIFIED or REJECTED, remarks required to reject. Employee: guard only | M020, M042; DB: student-documents [12] | Partial | Employee documents have no workflow |
| R-BL-14 | Student activity approvals | `student_activity_submit` / `_review` (M043): DRAFT -> SUBMITTED -> VERIFIED (UNDER_REVIEW) -> APPROVED or REJECTED; NEEDS_CORRECTION returns to draft; separate VERIFY and APPROVE permissions; mandatory evidence checked at submission | DB: student-activities [14]; UT: activities | Done | Rules are inferences (KI-54) |

### 10.2 Financial safety

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-FIN-1 | No duplicate payment processing | `fin_record_payment` is idempotent on `transaction_number`; the same number with different details is refused | DB: finance [14] | Done | |
| R-FIN-2 | No over-allocation of payments | Row-locked triggers and RPC checks | DB: finance | Done | |
| R-FIN-3 | No invalid refund | Refundable-balance check and approval state machine | DB: finance | Done | |
| R-FIN-4 | No negative balances from concurrent operations | Row locks in a fixed order (payment, then item) | DB: finance | Partial | Proven on a single connection only; needs a multi-connection test (DATABASE_MIGRATION.md) |
| R-FIN-5 | No unauthorised change to financial records | Clients hold no write grants on money tables; RPCs authorise per student scope | DB: finance, rls | Done | |
| R-FIN-6 | Idempotency where appropriate | Keys on assessment, payment, refund request and refund numbers | DB: finance | Done | |
| R-FIN-7 | Never trust frontend totals | The form shows a live total, the server recomputes | UT: finance [10]; DB: finance | Done | |
| R-FIN-8 | Receipts | `fin_issue_receipt`, `fin_cancel_receipt` (cancel or replace), `fin_payment_receipts`, `fin_receipt_get` (M047); numbered `RCP-<year>-<6 digits>` (an assumed rule, decision D-9 can change it in one function); printable page `/finance/receipt/[id]` | DB: finance-receipts [6]; UT: finance-extras | Done | The numbering rule is my inference (KI-59) |

---

## 11. Phase 7: audit, security and compliance (prompt section 11)

### 11.1 Audit

| ID | Requirement | Implementation | Evidence | Status | Gap or note |
|---|---|---|---|---|---|
| R-AUD-1 | User activity logs | `activity_audit` rows from `sims_private.audit_row()` triggers (about 46 audit triggers) | M022, M024 to M039; `schema.test.ts` counts them | Partial | Logs writes, not reads |
| R-AUD-2 | Authentication event logs | `login_audit` written by `auth_login_record`, `auth_logout_record`, `auth_failure_record` (anonymous, throttled to 20 per name and 5000 per hour) with address and browser from the request headers (M045); viewer `/audit/logins`; own history in `/settings` | DB: account-features [14] | Done | Not exercised against real Auth; no automatic lockout (KI-57) |
| R-AUD-3 | Creation and modification history | Audit triggers store before and after values | DB: module tests assert audit rows | Done | KI-19: some personal fields are copied into the audit log |
| R-AUD-4 | Approval and verification history | Status changes are audited; grievance and refund have action histories | DB: grievance [12], finance [14] | Partial | |
| R-AUD-5 | Financial audit history | `fee_activity_audit` written by `fin_audit()` | M021, M034 | Done | |
| R-AUD-6 | Permission change history | Role assignments and permission overrides are row-audited (`trg_user_role_assignment_audit`, `trg_user_permission_override_audit`, M041); account status changes write an audit row from the RPC | DB: iam-admin [8] | Done | Role and permission definitions themselves are still not editable by clients |
| R-AUD-7 | Sensitive data access controls | Counselling notes by confidentiality level and kept out of the audit log; feedback anonymity; sensitive resources need specific grants | M038, M037; DB: mentoring [15], feedback [19] | Partial | Aadhaar, PAN and bank encryption owner is undecided (KI-8) |
| R-AUD-8 | Audit viewer | `/audit` (filters by module, action, text, dates; detail page with before and after values) over `audit_list`, `audit_get`, `audit_modules` (M041); needs a global `AUDIT.ALL.READ` | DB: iam-admin [8]; UT: iam | Done | Shows what triggers recorded (writes); no export |

### 11.2 Security requirements

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-SEC-1 | No exposed service-role credentials | The service-role key is not used anywhere in code or docs; a scan of every file before the first push found no secret | Done | |
| R-SEC-2 | No secrets committed to Git | `.env.local` is git-ignored; the database password and publishable key were searched for in every file before the push | Done | The database password was shared in chat; rotate it (KI-12) |
| R-SEC-3 | No unrestricted database access | `anon` has 0 grants; deny-by-default RLS; definer helpers are not exposed | DB: rls [30] | Done | |
| R-SEC-4 | No publicly accessible sensitive documents | No documents exist yet | | Done by absence | |
| R-SEC-5 | No frontend-only authorisation | Navigation hides items, RLS and RPC checks enforce | DB tests | Done | |
| R-SEC-6 | No unprotected administrative functions | Admin functions are not exposed; `link_auth_user` is service-role only | DB: rls | Done | |
| R-SEC-7 | No SQL injection | All queries use PostgREST filters or parameterised RPCs; search text is matched with `position()` (no pattern syntax) in the newer RPCs and sanitised in the older list queries | DB tests cover `'%'` and similar inputs | Done | Not verified by an external scanner |
| R-SEC-8 | No insecure file upload handling | No upload exists | | Done by absence | |
| R-SEC-9 | No privilege escalation | RPC-only tables, immutable identity map, guards | DB: rls | Done | |
| R-SEC-10 | No cross-tenant data access | Cross-institution cases in module DB tests | DB: all modules | Done | Sampled per table (KI-2) |
| R-SEC-11 | `npm audit` clean | 2 findings (1 high) in PostCSS bundled with Next 15 | KI-13 | Partial | Build-time only; fix on a Next upgrade |
| R-SEC-12 | **Security audit report** (`SECURITY_AUDIT.md`) | [SECURITY_AUDIT.md](SECURITY_AUDIT.md): self-review with 7 findings (1 fixed) and the controls in place | | Done | A self-review, not an independent penetration test |

---

## 12. Phase 8: testing and quality assurance (prompt section 12)

### 12.1 Required test categories

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-TST-1 | Schema creation | DB: schema [17] | Done | |
| R-TST-2 | Foreign key integrity, unique and check constraints | DB: schema; each module test | Done | |
| R-TST-3 | Trigger execution | DB: schema, finance, employees, registration, attendance, assessment, timetable, feedback | Done | |
| R-TST-4 | View results | DB: schema (views exist, are security invoker) | Partial | Result rows of the 10 views are not asserted |
| R-TST-5 | RPC functions | Every RPC family has authorised, unauthorised, invalid-input and replay cases | Done | |
| R-TST-6 | Transaction rollback | Failed multi-step RPCs leave no rows (for example feedback submit validation, mentoring, grievance limits) | DB: feedback [19] and others | Done | |
| R-TST-7 | Concurrent financial operations | Not run | | Not started | Needs real multi-connection PostgreSQL |
| R-TST-8 | Authentication tests (login, logout, invalid credentials, expiry, reset, unauthorised routes) | None automated | | Not started | Blocked on the first Auth user for real flows |
| R-TST-9 | RLS tests for every important role | DB: rls [30] plus module tests with registrar, faculty, finance, student and super-admin identities | Done | KI-2: representative, not every table |
| R-TST-10 | Frontend tests (page load, validation, CRUD, search, pagination, filters, navigation, errors, responsive) | Unit tests of validation, payload builders and navigation only (133 tests) | Partial | No component or page tests |
| R-TST-11 | End-to-end tests with Playwright | `tests/e2e/` (see R-STK-15) | Partial | Smoke only; signed-in flows blocked on a test user (KI-3) |
| R-TST-12 | Do not mark tests passed unless executed | The 391 figure is from an executed run | Done | |
| R-TST-13 | `TESTING_REPORT.md` | [TESTING_REPORT.md](TESTING_REPORT.md) | Done | |

### 12.2 The twelve workflows the prompt lists

None has an end-to-end browser test. The right-hand column shows what is covered at the database level.

| # | Workflow | Screen exists | Database-level coverage |
|---|---|---|---|
| 1 | Admin creates an academic year | Yes (`/calendar/years/new`) | DB: academic |
| 2 | Admin creates a department and programme | Yes (`/structure`) | DB: structure |
| 3 | Admin creates a course and curriculum | Yes (`/courses`, `/curriculum`) | DB: courses |
| 4 | Admin registers a student | Yes (`/students/new`) | DB: students |
| 5 | Admin assigns a student to a programme | Yes (admit flow, `/students/new` with enrolment) | DB: students, admissions |
| 6 | Admin creates a term offering and section | Yes (`/registration/new`, section manager) | DB: registration, attendance |
| 7 | Faculty receives a course assignment | Yes (`/attendance/section/[id]`) | DB: attendance |
| 8 | Faculty marks attendance | Yes (`/attendance/session/[id]`) | DB: attendance |
| 9 | Examination staff creates assessments | Yes (`/assessment/offering/[id]`) | DB: assessment |
| 10 | Results are entered and published | Yes (`/results/term/[id]`) | DB: assessment |
| 11 | Finance staff records payments | Yes (`/finance/account/[id]`) | DB: finance |
| 12 | Student accesses their authorised information | Partly (`/my-results`, `/feedback`, `/grievances`; no attendance, fees or profile view) | DB: rls, assessment, feedback, grievance |

---

## 13. Phase 9: performance (prompt section 13)

| ID | Requirement | Evidence | Status | Gap or note |
|---|---|---|---|---|
| R-PERF-1 | Proper indexes | 104 source indexes migrated; extra indexes in M009 and M012 | Done | No new indexes were added for the RLS helper lookups (KI-10) |
| R-PERF-2 | Pagination and server-side filtering | List screens page at 20 rows; filters run in the database or RPC | Done | Feedback and a few reference lists load up to 200 to 500 rows at once |
| R-PERF-3 | Avoid retrieving whole tables | Same | Done | |
| R-PERF-4 | Avoid N+1 queries | List helpers return joined rows from one RPC; ledgers batch with `IN` lists | Done | Not measured |
| R-PERF-5 | Efficient dashboard aggregation | `dash_*` functions aggregate in the database | Done | |
| R-PERF-6 | `EXPLAIN ANALYZE` of important queries | Run on synthetic data (20,000 students) in the embedded database: `tests/perf/explain.perf.ts` | Done | Found a P1 scaling problem in the RLS helpers (KI-61); fix not done |
| R-PERF-7 | Caching that cannot leak across users | No caching is used | Done | |
| R-PERF-8 | **Performance report** | [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) | Done | Reports the finding; the optimisation is outstanding |

---

## 14. Test inventory

All 391 tests passed in the 2026-11-04 run. Counts per file (`vitest --reporter=json`).

| Database tests (`tests/db`) | Tests | Covers |
|---|---|---|
| academic.test.ts | 11 | Calendar |
| admissions.test.ts | 16 | Admissions workflow |
| assessment.test.ts | 25 | Marks, results, SGPA/CGPA, publication visibility |
| attendance.test.ts | 15 | Teaching sections, sessions, marking, corrections |
| communication.test.ts | 18 | Announcement workflow, author separation, audience rules, feed |
| courses.test.ts | 8 | Catalogue and curriculum |
| dashboard.test.ts | 10 | Scoped aggregates |
| employees.test.ts | 13 | Employee registration, assignments, current-primary rule |
| feedback.test.ts | 19 | Anonymity, visibility, suppression |
| finance-read.test.ts | 7 | Account helpers, account opening |
| finance.test.ts | 14 | Money RPCs, idempotency, limits |
| grievance.test.ts | 12 | Workflow, internal notes |
| iam-admin.test.ts | 8 | Account status, role assignment, last-super-admin protection |
| mentoring.test.ts | 15 | Confidentiality, audit hygiene |
| registration.test.ts | 16 | Offerings, registration integrity, anchor-lookup regression |
| rls.test.ts | 30 | Identity mapping, scope containment, anon and student refusals, workflow guards, every-table-has-a-policy |
| schema.test.ts | 17 | 213 tables, 10 views, trigger families, constraints |
| structure.test.ts | 9 | Institution structure |
| student-activities.test.ts | 14 | Student activity workflow, evidence, approvals |
| student-documents.test.ts | 12 | Student document workflow on private Storage |
| students.test.ts | 9 | Student registration |
| timetable.test.ts | 12 | Clash guard, class-session generation |
| **Database total** | **310** | |

| Unit tests (`tests/unit`) | Tests |
|---|---|
| academic 7, activities 9, admissions 9, assessment 9, attendance 8, communication 6, courses 10, dashboard 9, documents 7, employees 7, feedback 10, finance 10, grievance 8, iam 5, lib 8, mentoring 6, registration 7, structure 10, students 7, timetable 8 | **160** |

Known limits of this evidence: the database runs on embedded PostgreSQL (PGlite), a real PostgreSQL build without the Supabase stack (no PostgREST, no `auth` or `storage` schemas, roles simulated), on a single connection. Live-project checks done separately: applied-migration list, function privileges for `anon` and `authenticated`, and absence of client write grants on RPC-only tables.

---

## 15. Phase 10: documentation and deployment (prompt section 14)

### 15.1 Required documents

| # | Required file | Status |
|---|---|---|
| 1 | PROJECT_OVERVIEW.md | Done |
| 2 | SYSTEM_ARCHITECTURE.md | Done |
| 3 | DATABASE_MIGRATION.md | Done |
| 4 | DATABASE_SCHEMA.md | Not started (SCHEMA_RECONCILIATION.md and RLS_POLICY_MAP.md cover tables) |
| 5 | MODULE_DOCUMENTATION.md | Partial (IMPLEMENTATION_STATUS.md, API_DOCUMENTATION.md, migration headers) |
| 6 | AUTHENTICATION_AND_RBAC.md | Done (its "Not done yet" section is partly stale: login screens now exist) |
| 7 | RLS_SECURITY_MODEL.md | Done |
| 8 | API_DOCUMENTATION.md | Done for the RPCs |
| 9 | STORAGE_DOCUMENTATION.md | Done (student documents) |
| 10 | TESTING_REPORT.md | Done |
| 11 | SECURITY_AUDIT.md | Done (self-review) |
| 12 | DEPLOYMENT_GUIDE.md | Done (checklist; nothing deployed) |
| 13 | ENVIRONMENT_SETUP.md | Done |
| 14 | KNOWN_ISSUES.md | Done (KI-1 to KI-60) |
| 15 | IMPLEMENTATION_STATUS.md | Done |

Extra documents that exist: PROJECT_AUDIT.md, SCHEMA_RECONCILIATION.md, RLS_POLICY_MAP.md (generated), DEVELOPMENT_CHECKLIST.md, this RTM.

### 15.2 Other deliverables

| ID | Requirement | Status | Note |
|---|---|---|---|
| R-DEP-1 | `.env.example`, `README.md` | Done | |
| R-DEP-2 | Supabase migration scripts | Done | `supabase/migrations/` |
| R-DEP-3 | Seed scripts | Partial | Reference seed is in M011; no sample-data or per-role test-user seed (and no fabricated records, by the rules) |
| R-DEP-4 | Test scripts | Done | `npm test`, `npm run test:db`, `npm run test:unit` |
| R-DEP-5 | Deployment configuration | `vercel.json` (framework, install and build commands, HSTS) and `supabase/config.toml` | Done | Neither has been used for a real deployment |
| R-DEP-6 | Supabase project configuration, Vercel deployment, production environment variables, migration execution, bucket configuration, Auth redirect configuration, domain configuration | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) is the checklist | Blocked | Needs you: nothing was deployed (migrations M001 to M050 are applied to the Supabase project) |
| R-DEP-7 | Never commit secrets; never run a destructive production migration without approval and backup | Done | |

---

## 16. Engineering rules (prompt section 16)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | Never fabricate database records | Complied | No sample data was inserted into the live database; test data exists only in the embedded test database |
| 2 | Never remove original constraints without approval | Complied | Catalogue comparison |
| 3 | Never silently ignore SQL statements | Complied | The one skipped statement (SD-1) is documented |
| 4 | Never expose secrets | Complied | R-SEC-1, R-SEC-2 (but the DB password was pasted in chat; rotate it) |
| 5 | Never bypass RLS to make a feature work | Complied | Definer functions authorise explicitly; none disable RLS |
| 6 | No service-role key in client code | Complied | |
| 7 | Never create fake APIs | Complied | Every RPC is backed by tables and tests |
| 8 | Never leave core buttons non-functional | Complied (by review) | Not click-tested |
| 9 | Never mark incomplete features as complete | Complied | This RTM |
| 10 | Never silently change the source schema | Complied | Changes are additive and listed in migrations |
| 11 | Never overwrite working code without review | Complied | |
| 12 | No destructive database operation without authorisation | Complied | |
| 13 | TypeScript strict mode | Complied | |
| 14 | Reusable components | Partial | Shared `DeleteButton`, `StatusControl`, form fields, charts; some forms duplicate small helpers (`dbMessage`) |
| 15 | Modular services | Partial | See R-SVC-1 |
| 16 | Business logic out of presentation components | Complied | Rules live in PostgreSQL; the UI mirrors only transition tables, and unit tests guard against drift |
| 17 | Migrations version-controlled | Complied | |
| 18 | Meaningful error messages | Complied | Business-rule messages are returned, RLS failures are generic |
| 19 | Validate all external inputs | Complied | Zod in the browser, checks again in the database |
| 20 | Backward traceability to the original database | Complied | This RTM, SCHEMA_RECONCILIATION.md, RLS_POLICY_MAP.md |

---

## 17. Final acceptance criteria (prompt section 18)

| # | Criterion | Status | Note |
|---|---|---|---|
| 1 | Approved MySQL schema migrated to PostgreSQL | **Met** | |
| 2 | Source-to-target reconciliation documented | **Met** | |
| 3 | Foreign keys and constraints working | **Met** | |
| 4 | All required triggers and views migrated | **Met** | 16 of 16 triggers, 10 of 10 views |
| 5 | Supabase authentication works | **Not met** | Built, never exercised; no Auth user exists |
| 6 | RBAC and RLS enforced | **Met** | On embedded PostgreSQL and by live privilege checks |
| 7 | Tenant isolation tested | **Met (sampled)** | KI-2 |
| 8 | Backend business logic implemented | **Partly met** | For the 13 built modules; not for the not-started modules |
| 9 | Supabase Storage works securely | **Not met** | |
| 10 | Frontend forms connect to real backend services | **Met** for built modules | Not click-tested |
| 11 | CRUD operations work | **Partly met** | See the feature matrix |
| 12 | Important institutional workflows work end to end | **Not demonstrated** | No browser-level run |
| 13 | Automated tests executed | **Met** | 391 of 391 passing |
| 14 | No unresolved P0 security defects | **Met as far as known** | No P0 is open; there is no security audit report and no external review |
| 15 | Production build succeeds | **Met** | `npm run build` |
| 16 | Deployment instructions complete | **Not met** | |

**Overall: the project does not yet meet its acceptance criteria.** The database and security foundation and thirteen modules are in place and tested. Authentication has not been run end to end, storage and documents are missing, four modules and part of three more are unbuilt, and there are no end-to-end tests, performance report, security audit or deployment guide.

---

## 18. Migration inventory

| Migration | What it adds | Source |
|---|---|---|
| M001 | Common reference tables, institution structure | generated from the MySQL SQL |
| M002 | Academic calendar and curriculum | generated |
| M003 | Student, employee, admission, registration | generated |
| M004 | Teaching, attendance, assessment, feedback tables | generated |
| M005 | Documents and communication tables | generated |
| M006 | Identity, RBAC, audit tables | generated |
| M007 | Employee HR profile | generated |
| M008 | Student finance (and 10 views) | generated |
| M009 | Indexes and file metadata | generated |
| M010 | Staff profile and research | generated |
| M011 | Evidence tables and seed data | generated |
| M012 | Staff views and indexes | generated |
| M013 | Student activity and evidence | generated |
| M014 | 16 ported triggers and 37 `updated_at` triggers | hand-ported |
| M015 | Identity sequence resync | hand-written |
| M016 | RLS enabled, deny by default | generated |
| M017 | Identity map, permission resolution helpers | hand-written |
| M018 | Per-table RLS policies | generated (`tools/build_rls.py`) |
| M019 | `my_context()` RPC | hand-written |
| M020 | Workflow guards (approve, verify, publish) | generated |
| M021 | Finance RPCs (`fin_*`) | hand-written |
| M022 | `student_register`, generic audit trigger | hand-written |
| M023 | `employee_register`, `employee_assign` | hand-written |
| M024 | Academic setup audit | hand-written |
| M025 | Institution structure RPCs | hand-written |
| M026 | Course catalogue audit | hand-written |
| M027 | Admissions workflow | hand-written |
| M028 | Registration integrity guards, offering generation | hand-written |
| M029 | Security-definer anchor lookups (34) | generated |
| M030 | Registration read RPCs | hand-written |
| M031 | Attendance | hand-written |
| M032 | Assessment and results | hand-written |
| M033 | Assessment read helpers, `my_results()` | hand-written |
| M034 | Finance read helpers, account opening | hand-written |
| M035 | Timetable guard and session generation | hand-written |
| M036 | Dashboard aggregates | hand-written |
| M037 | Feedback | hand-written |
| M038 | Mentoring | hand-written |
| M039 | Grievance | hand-written |
| M040 | Communication (announcements, audiences, approval) | hand-written |
| M041 | IAM administration, audit viewer | hand-written |
| M042 | Student documents on private Storage | hand-written |
| M043 | Student activities and evidence | hand-written |
| M044 | Staff profile and research (generic detail forms) | hand-written |
| M045 | Account features: MFA enforcement, sign-in log, profile, notifications, global search | hand-written |
| M046 | Record sections (student and employee sub-tables) and reference-data administration | hand-written |
| M047 | Fee receipts and financial holds | hand-written |
| M048 | Personal dashboard (`my_dashboard`) | hand-written |
| M049 | User provisioning (service-role function, `iam_can_provision`) | hand-written |
| M050 | Revoke EXECUTE on trigger functions from anon and authenticated | hand-written (found by the live check) |

## 19. Screen inventory

| Area | Routes |
|---|---|
| Authentication | `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/auth/signout`, `/no-access` |
| General | `/dashboard`, `/settings` |
| Students | `/students`, `/students/new`, `/students/[id]`, `/students/[id]/edit` |
| Employees | `/employees`, `/employees/new`, `/employees/[id]`, `/employees/[id]/edit` |
| Institution structure | `/structure`, `/structure/[kind]/new`, `/structure/[kind]/[id]` |
| Academic calendar | `/calendar`, `/calendar/years/new`, `/calendar/years/[id]`, `/calendar/years/[id]/edit`, `/calendar/terms/[id]` |
| Curriculum and courses | `/curriculum`, `/curriculum/new`, `/curriculum/[id]`, `/curriculum/[id]/edit`, `/courses`, `/courses/new`, `/courses/[id]`, `/courses/categories` |
| Admissions | `/admissions`, `/admissions/new`, `/admissions/[id]`, `/admissions/categories` |
| Registration | `/registration`, `/registration/new`, `/registration/[id]`, `/registration/term/[id]` |
| Attendance | `/attendance`, `/attendance/section/[id]`, `/attendance/session/[id]`, `/attendance/statuses` |
| Timetable | `/timetable`, `/timetable/[id]` |
| Assessment and results | `/assessment`, `/assessment/offering/[id]`, `/assessment/event/[id]`, `/results/term/[id]`, `/results/grades`, `/my-results` |
| Finance | `/finance`, `/finance/account/[id]` |
| Feedback | `/feedback`, `/feedback/give/[cycle]`, `/feedback/results/[cycle]`, `/feedback/results/[cycle]/[offering]`, `/feedback/setup` |
| Mentoring | `/mentoring`, `/mentoring/[id]` |
| Grievance | `/grievances`, `/grievances/[id]` |
| Communication | `/announcements`, `/announcements/manage`, `/announcements/new`, `/announcements/[id]`, `/announcements/[id]/edit` |
| Users and audit | `/admin/users`, `/admin/users/[id]`, `/audit`, `/audit/[id]`, `/audit/logins` |
| Documents | `/my-documents`, `/students/[id]/documents` |
| Student activities | `/activities`, `/activities/new`, `/activities/[id]` |
| Staff profile and research | `/staff-profile`, `/staff-profile/new`, `/staff-profile/[id]` |
| Account | `/settings`, `/mfa`, `/notifications`, `/search` |
| Records and reference data | `/students/[id]/records`, `/employees/[id]/records`, `/admin/reference`, `/admin/reference/[table]` |
| Fee receipts | `/finance/receipt/[id]` |

## 20. Open decisions and blockers (owner actions)

| ID | Item | Needed from | Blocks |
|---|---|---|---|
| D-1 | Create the first Auth user in the Supabase dashboard (project `khqqfgqvwdxlqkncwtmh`), then run `tools/bootstrap_admin.py <email>` | You | R-AUTH-2 to R-AUTH-11, signed-in verification, acceptance criterion 5 |
| D-2 | Auth dashboard settings: Site URL, redirect URLs, SMTP, disable sign-up | You | R-AUTH-4 to R-AUTH-6 |
| D-3 | Rotate the database password that was shared in chat | You | KI-12 |
| D-4 | Confirm or correct the inferred business rules | You | KI-28, 31, 35, 38, 40, 43, 46, 47, 49, 50 |
| D-5 | Define a grievance handler role and fee permissions for students and the super admin | You | KI-41, KI-45, KI-50 |
| D-6 | Decide Lesson Plan and the 52 dictionary-only tables; provide `SIMS_schema_review.md` | You | KI-11 |
| D-7 | Owner and key management for encrypting Aadhaar, PAN and bank data | You | KI-8 |
| D-8 | Case-insensitive uniqueness for codes and emails | You | KI-7 |
| D-9 | Fee receipt numbering rule | You | R-FIN-8 |
| D-10 | Multi-connection PostgreSQL for concurrency tests | Infrastructure | R-TST-7, R-FIN-4 |

## 21. Remaining work in priority order

1. **Unblock authentication** (D-1, D-2), then verify every built screen signed in and add Playwright tests for the 12 workflows.
2. **Documents and Storage** (module 8, Phase 4), because student activity, staff profile and several modules depend on files.
3. **Remaining modules:** Communication (3 tables), Student Activity and Evidence (7), Staff Profile and Research (55), then the unbuilt HR and student sub-tables.
4. **Finance completion:** fee structures, concessions, scholarships, instalments, late fees, penalties, holds, receipts.
5. **IAM administration:** role assignment, overrides, user linking, activation and deactivation, permission-change audit.
6. **Global search, notifications, role-specific dashboards.**
7. **Quality deliverables:** security audit, performance report with `EXPLAIN ANALYZE`, concurrency tests, testing report, deployment guide and Vercel configuration, and the missing documents in section 15.1.
