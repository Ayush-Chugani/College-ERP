# Environment Setup

## Variables
| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web app (browser + server) | no | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web app | no (designed to be public; RLS protects data) | API key |
| `SUPABASE_DB_PASSWORD` | local operator tools only (`tools/*.py`) | **yes** | applying migrations, bootstrap, FK-graph dump. Never set it in Vercel or any `NEXT_PUBLIC_*` variable |
| `SUPABASE_SERVICE_ROLE_KEY` | future server-only code | **yes** | not used yet; never expose to the browser |

`.env.local` is gitignored. Copy `.env.example` and fill it in.

## Local tooling
Node 22+, npm 10+. Python 3.11+ with `psycopg2-binary` and `openpyxl` only for `tools/` scripts. No Docker or Supabase CLI is required: migrations are validated on embedded Postgres (PGlite) and applied with `tools/` scripts or by pasting SQL into the dashboard.

## Supabase project settings still to do (dashboard)
- Authentication → URL configuration: Site URL and redirect URLs (`http://localhost:3000/auth/callback`, your production origin + `/auth/callback`).
- Authentication → Providers → Email: decide on sign-ups (disabled recommended: accounts are provisioned by administrators), confirm-email, password policy (min 10, mixed case, number to match the app).
- Authentication → SMTP: configure a real SMTP provider before relying on password-reset emails.
- Storage buckets and policies: not created yet.
