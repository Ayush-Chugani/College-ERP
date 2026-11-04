# Testing report

Run on 2026-11-04 on the development container. Everything below was executed; nothing is estimated.

| Suite | Command | Result |
|---|---|---|
| Database (embedded Postgres, all migrations, RLS, triggers, RPCs) | `npm run test:db` | 27 files, 365 test cases |
| Unit (validation, payload builders, navigation, drift tests against migrations) | `npm run test:unit` | 24 files, 186 test cases |
| **Vitest total** | `npm test` | **551 passed, 0 failed** (51 files) |
| Type check | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Production build | `npm run build` (placeholder Supabase variables) | passes |
| End-to-end smoke | `npm run test:e2e` | 38 passed, 4 skipped (desktop and phone projects; the 4 skipped need `E2E_EMAIL` / `E2E_PASSWORD`) |

## What the suites prove
- **Database:** schema counts (tables, views, triggers), RLS scope containment, workflow guards, every RPC's authorisation, validation, idempotent replays and audit rows; storage policies for documents (own folder only, orphan-only delete); IAM safeguards (no self-change, last super admin).
- **Unit:** Zod schemas, file checks, key building, list parameter parsing, navigation visibility, and **drift tests** that fail when an application table (status transitions, allowed file types) no longer matches its migration.
- **End to end:** the login page renders, validates and fits a phone screen; every protected route redirects an anonymous visitor to `/login` and keeps a safe `next`.

## Not tested (honest list)
- Signed-in browser flows against a real Supabase project (login, logout, reset, upload to Storage). The e2e file exists but has never run against a real project because none was available.
- Real Supabase Storage behaviour (the tests use a minimal stand-in for `storage.buckets` / `storage.objects`; signed URLs are not exercised).
- Concurrent financial operations on multiple connections (R-TST-7), `EXPLAIN ANALYZE` performance runs, component-level frontend tests, accessibility audits with a tool, load tests.
