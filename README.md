# SIMS – Student Information Management System

Next.js 15 (App Router, strict TypeScript, Tailwind 4) on Supabase (PostgreSQL, Auth, RLS). The database was migrated from the MySQL schema in `SIMS-DatabaseWithoutLessonPlan.sql`.

**Status: early.** Database, identity/RBAC and RLS are implemented and tested; the web app has auth, a role-aware shell, a dashboard and a read-only Students list. Most modules have no UI yet. See `docs/IMPLEMENTATION_STATUS.md` and `docs/KNOWN_ISSUES.md` for the honest picture.

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
| `npm run build` | production build |
| `npm run migrate:build` | regenerate migrations 001–016 from the MySQL source |
| `npm run migrate:apply-check` / `migrate:catalogue` | apply migrations to a fresh embedded Postgres / compare catalogue with source |

## Layout
`supabase/migrations` (001–016 generated from MySQL; 017–019 identity, RLS helpers/policies, `my_context`) · `src/app` (routes) · `src/lib` (clients, validation, nav) · `src/features` (data access per feature) · `tools` (translator, RLS generator, bootstrap) · `tests` · `docs`.

## Security notes
Never put the service-role key or the database password in `NEXT_PUBLIC_*` variables or client code. The browser only ever uses the publishable key; all access is constrained by RLS (see `docs/RLS_SECURITY_MODEL.md`).

Requirements traceability: [docs/RTM.md](docs/RTM.md).
