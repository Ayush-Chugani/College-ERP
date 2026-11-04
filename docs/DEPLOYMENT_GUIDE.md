# Deployment guide

Nothing has been deployed by this repository's tooling. This guide is the checklist for doing it. Never run a destructive migration on production without an approval and a backup.

## 1. Supabase project
1. Create (or pick) the project. Note the project URL and the **publishable** key (Settings > API). Never copy the service-role key or the database password into the web app.
2. Apply migrations `001` to `063` **in order**. Either `supabase link --project-ref <ref>` then `supabase db push` (uses `supabase/config.toml`), or the operator scripts in `tools/` (see DATABASE_MIGRATION.md). Migration 042 creates the `sims-documents` bucket and its policies.
3. Authentication > URL configuration: Site URL = the production origin; redirect URLs = `<origin>/auth/callback` and `<origin>/reset-password`.
4. Authentication > Multi-factor: enable TOTP (enrol and verify) so the screens in `/settings` and `/mfa` work (matches `config.toml`). Authentication > Providers > Email: sign-ups **disabled** (accounts are provisioned), confirmation on, minimum password length 12 (matches `config.toml`). Configure a real SMTP provider or password-reset mails will not arrive.
5. Create the first user in Authentication > Users, then run `tools/bootstrap_admin.py` (one transaction; verifies identity resolution). After that, manage accounts and roles from `/admin/users`.
6. Storage: confirm `sims-documents` is private with a 10 MB limit, and that the three policies exist (STORAGE_DOCUMENTATION.md).

## 2. Vercel
1. Import the repository; framework preset Next.js (`vercel.json` already says so).
2. Environment variables (Production and Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **Do not** set `SUPABASE_DB_PASSWORD` or `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy. Security headers come from `next.config.mjs` and `vercel.json` (HSTS).
4. Add the custom domain, then add it to the Supabase redirect URLs.

## 3. Verify
- `npm run typecheck && npm run lint && npm test` (needs no Supabase account).
- `npm run test:e2e` (needs Chromium; set `E2E_CHROMIUM_PATH` to use an installed one). With a **non-production** test user also set `E2E_EMAIL` and `E2E_PASSWORD` to run the sign-in flow.
- Sign in as the first administrator: Dashboard loads, `/admin/users` lists users, `/audit` shows the bootstrap entries, a student can upload to `/my-documents`.

## 3b. Optional checks against the real database server
- `PG_CONCURRENCY_URL=postgres://... npm run test:concurrency` runs the finance concurrency suite on a scratch PostgreSQL 15+ (it creates and drops its own database).
- `PG_PERF_URL=postgres://... npx vite-node tools/perf/run.ts` measures the main queries under row level security at realistic volumes (see PERFORMANCE_REPORT.md).

## 4. Rollback
Migrations are forward-only SQL. Take a backup (Dashboard > Database > Backups, or `pg_dump`) before each `db push`; to roll back restore the backup, then redeploy the previous Vercel build.

## Notes for migrations 052 to 057
- **M054 needs Vault and pgcrypto.** On Supabase both are available; the migration enables `pgcrypto` in the `extensions` schema and creates the secret `sims_pii_key` in Vault if it is missing. Do not delete or rename that secret: the encrypted PAN, Aadhaar and bank numbers cannot be read without it. Include it in your backup and key-rotation plan (KI-65).
- **M056** deletes rows from `auth.mfa_factors` when a recovery code is used. Check once, on the live project, that the migration role may do that (`select * from has_table_privilege('postgres', 'auth.mfa_factors', 'DELETE')`).
- **Next.js 16**: `src/middleware.ts` is now `src/proxy.ts`; Vercel needs Node 20.9 or newer. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the build, otherwise static pages fail to prerender.
- After applying M052, students see their own fees and the super administrator reads fee data: tell the finance office. `docs/ROLE_PERMISSION_MATRIX.md` lists every grant (`npm run docs:roles` regenerates it).
- **M059 and M060** add Storage policies for `announcement/<id>/` files (and use the `student/<id>/` policies for issued certificates). **M062** blocks registration, results and certificate approval while the matching fee hold is active: tell the fee office and the registrar before applying it, and check no student is on an old hold that should have been released.
- **M058**: for "require two-step verification" choose the roles under `/admin/mfa-policy`; people who hold them see only the set-up screen until they enrol.
- **M063** makes EXAMINATION, HALL_TICKET, HOSTEL_CHECKOUT and GRADUATION holds meaningful (they block the new `/requests` workflow). Tell the exam section and the hostel office that approval of these requests is done by holders of `DOCUMENT.ALL.APPROVE`; give them that permission through a role or an override if they should approve.
