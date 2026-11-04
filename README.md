# SIMS – Student Information Management System

Next.js 15 (App Router, strict TypeScript, Tailwind 4) on Supabase (PostgreSQL, Auth, RLS). The database was migrated from the MySQL schema in `SIMS-DatabaseWithoutLessonPlan.sql`.

**Status: in progress.** Database, identity/RBAC, RLS and most application modules (students, employees, admissions, registration, attendance, assessment, finance, feedback, mentoring, grievances, announcements, student documents, student activities, staff profile and research, notifications, search, two-step verification, users and roles, audit log) are implemented and tested on an embedded database. Nothing has been exercised signed in against a real Supabase project, and migrations 044 to 049 are not applied to the live project. See `docs/IMPLEMENTATION_STATUS.md` and `docs/KNOWN_ISSUES.md` for the honest picture.

## Quick start
```bash
npm install
cp .env.example .env.local     # fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev                    # http://localhost:3000
```
First administrator: see `tools/bootstrap_admin.py` (needs an Auth user created in the Supabase dashboard).

## Scripts
| Command | Purpose |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript (strict) / ESLint |
| `npm run test:unit` | app unit tests |
| `npm run test:db` | schema, trigger and RLS tests on embedded Postgres (no Docker needed) |
| `npm run test:concurrency` | finance concurrency suite on a real PostgreSQL (needs `PG_CONCURRENCY_URL`; skipped otherwise) |
| `npm run docs:schema` / `npm run migrate:seed-check` | regenerate `docs/DATABASE_SCHEMA.md` / compare seed row counts with the MySQL source |
| `npm run test:e2e` | Playwright smoke tests (set `E2E_CHROMIUM_PATH` to use an installed Chromium) |
| `npm run build` | production build |
| `npm run migrate:build` | regenerate migrations 001–016 from the MySQL source |
| `npm run migrate:apply-check` / `migrate:catalogue` | apply migrations to a fresh embedded Postgres / compare catalogue with source |

## Layout
`supabase/migrations` (001–016 generated from MySQL; 017–019 identity, RLS helpers/policies, `my_context`; 020–049 workflow guards, module RPCs, announcements, IAM administration, student documents) · `src/app` (routes) · `src/lib` (clients, validation, nav) · `src/features` (data access per feature) · `tools` (translator, RLS generator, bootstrap) · `tests` · `docs`.

## Security notes
Never put the service-role key or the database password in `NEXT_PUBLIC_*` variables or client code. The browser only ever uses the publishable key; all access is constrained by RLS (see `docs/RLS_SECURITY_MODEL.md`).

Requirements traceability: [docs/RTM.md](docs/RTM.md). Also: [PROJECT_OVERVIEW](docs/PROJECT_OVERVIEW.md), [SYSTEM_ARCHITECTURE](docs/SYSTEM_ARCHITECTURE.md), [STORAGE_DOCUMENTATION](docs/STORAGE_DOCUMENTATION.md), [DEPLOYMENT_GUIDE](docs/DEPLOYMENT_GUIDE.md), [TESTING_REPORT](docs/TESTING_REPORT.md), [SECURITY_AUDIT](docs/SECURITY_AUDIT.md), [PERFORMANCE_REPORT](docs/PERFORMANCE_REPORT.md), [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md), [MODULE_DOCUMENTATION](docs/MODULE_DOCUMENTATION.md).
