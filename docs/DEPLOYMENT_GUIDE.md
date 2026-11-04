# Deployment guide

Nothing has been deployed by this repository's tooling. This guide is the checklist for doing it. Never run a destructive migration on production without an approval and a backup.

## 1. Supabase project
1. Create (or pick) the project. Note the project URL and the **publishable** key (Settings > API). Never copy the service-role key or the database password into the web app.
2. Apply migrations `001` to `044` **in order**. Either `supabase link --project-ref <ref>` then `supabase db push` (uses `supabase/config.toml`), or the operator scripts in `tools/` (see DATABASE_MIGRATION.md). Migration 042 creates the `sims-documents` bucket and its policies.
3. Authentication > URL configuration: Site URL = the production origin; redirect URLs = `<origin>/auth/callback` and `<origin>/reset-password`.
4. Authentication > Providers > Email: sign-ups **disabled** (accounts are provisioned), confirmation on, minimum password length 12 (matches `config.toml`). Configure a real SMTP provider or password-reset mails will not arrive.
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

## 4. Rollback
Migrations are forward-only SQL. Take a backup (Dashboard > Database > Backups, or `pg_dump`) before each `db push`; to roll back restore the backup, then redeploy the previous Vercel build.
