# Testing report

Run on 2026-11-04 on the development container. Everything below was executed; nothing is estimated.

| Suite | Command | Result |
|---|---|---|
| Database (embedded Postgres, all migrations, RLS, triggers, RPCs) | `npm run test:db` | 40 files, 447 test cases |
| Unit (validation, payload builders, navigation, drift tests against migrations) | `npm run test:unit` | 25 files, 202 test cases |
| **Vitest total** | `npm test` | **649 passed, 0 failed, 8 skipped** (65 files; the 8 skipped are the opt-in concurrency suite, which also passes against a real PostgreSQL 16 with all migrations: 657 of 657) |
| Type check | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Production build | `npm run build` (placeholder Supabase variables; Next 16.4.5 with Turbopack) | passes |
| End-to-end smoke | `npm run test:e2e` | 56 passed, 4 skipped (desktop and phone projects; the 4 skipped need `E2E_EMAIL` / `E2E_PASSWORD`) |

## What the suites prove
- **Database:** schema counts (tables, views, triggers), RLS scope containment, workflow guards, every RPC's authorisation, validation, idempotent replays and audit rows; storage policies for documents (own folder only, orphan-only delete); IAM safeguards (no self-change, last super admin).
- **Unit:** Zod schemas, file checks, key building, list parameter parsing, navigation visibility, and **drift tests** that fail when an application table (status transitions, allowed file types) no longer matches its migration.
- **End to end:** the login page renders, validates and fits a phone screen; every protected route redirects an anonymous visitor to `/login` and keeps a safe `next`.

## Not tested (honest list)
- Signed-in browser flows against a real Supabase project (login, logout, reset, upload to Storage). The e2e file exists but has never run against a real project because none was available.
- Real Supabase Storage behaviour (the tests use a minimal stand-in for `storage.buckets` / `storage.objects`; signed URLs are not exercised).
- Concurrent financial operations on multiple connections (R-TST-7), `EXPLAIN ANALYZE` performance runs, component-level frontend tests, accessibility audits with a tool, load tests.

## Additional suites (added with the quality work)
| Suite | Command | What it proves |
|---|---|---|
| Concurrency on real PostgreSQL 16 | `PG_CONCURRENCY_URL=postgres://... npm run test:concurrency` | 8 tests with 10 parallel connections: idempotent duplicate payments, no over-allocation of a payment, no overpayment of an item, no over-refund, unique receipt numbers, one active hold, no deadlock. Skipped when the variable is not set. The migrations also apply cleanly on real PostgreSQL there. |
| Role, fee, HR and recovery suites | part of `npm run test:db` | `finance-benefits` (benefits, adjustments, instalments, late fees, penalties, four-eyes), `finance-receipts` (REC numbering, student self-service), `employee-sensitive` (encryption, formats, Verhoeff, reveal log, HR documents), `staff-research`, `mfa-recovery`, `permission-overrides`, `link-and-mfa-policy`, `announcement-attachments`, `certificate-requests`, `fee-structures`, `hold-enforcement`. |
| Permission equivalence | part of `npm run test:db` | The rewritten `covers`, `can_student` and `can_employee` (M051) agree with the original definitions for every fixture user, permission set, target and mode. |
| Views | part of `npm run test:db` | The ten views exist, are security invoker, resolve, and return the right rows under each role. |
| Role matrix | `node tools/validate/role_matrix.mjs --check` | `docs/ROLE_PERMISSION_MATRIX.md` matches the seeded grants. |
| Seed counts | `npm run migrate:seed-check` | 37 of 38 seeded tables have the same row count as the MySQL source; 1 explained difference. |
| Schema document | `node tools/validate/schema_doc.mjs --check` | `docs/DATABASE_SCHEMA.md` matches the migrated catalogue. |
| Performance run | `tools/perf/run.ts` (see PERFORMANCE_REPORT.md) | Timings and plans of 21 queries under row level security at 20,000 students. |
