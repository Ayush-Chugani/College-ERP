# Security audit

A self-review of the repository, not an independent penetration test. Date: 2026-11-04.

## Method
Read the migrations, RPCs, middleware and forms; ran the database tests that attack the boundaries (anonymous, unmapped, disabled, other-institution, student-vs-staff callers); ran `npm audit`.

## Findings
| ID | Severity | Finding | Status |
|---|---|---|---|
| S-1 | High (found and fixed during development) | In `student_document_register` / `student_document_download_info` the check `NOT (student_id = current_student_id() OR can_student(...))` evaluates to NULL for a caller with no student record, so the `IF` never raised and an unmapped user would have passed. Fixed with `COALESCE(..., false)`; regression covered in `tests/db/student-documents.test.ts`. | Fixed before release |
| S-2 | Medium | `announcement` keeps its generated direct-write policies, so a holder of the COMMUNICATION permissions can bypass the RPC lifecycle rules by writing the table (approval stays guarded). | Open (KI-51) |
| S-3 | Medium | Audit log records writes, not reads; only document downloads are logged as reads. | Open (R-AUD-1) |
| S-4 | Medium | `npm audit --omit=dev` reports 2 findings in PostCSS bundled with Next 15 (build-time CSS processing; no attacker-controlled CSS reaches it). Dev-only tooling has 14 more. Fix needs a Next major upgrade. | Open (KI-13) |
| S-5 | Medium | No MFA (`multi_factor_enabled` is not consulted); no login/auth event log (`login_audit` is never written). | Open |
| S-6 | Low | No virus scanning or content sniffing of uploads beyond type and size; the declared MIME type comes from the browser (the bucket restricts it as well). | Open (KI-53) |
| S-7 | Low | No rate limiting beyond Supabase's built-in Auth limits. | Open |

## Controls in place
- Deny-by-default RLS on every table; the browser only holds the publishable key.
- All privileged writes are `SECURITY DEFINER` RPCs with a fixed `search_path`, a permission check at the row's scope, and one transaction; `EXECUTE` revoked from `PUBLIC` and `anon`.
- Account safeguards: no self status/role change, last super administrator protected, SUPER_ADMIN grants restricted to super administrators.
- Private storage bucket, owner/permission-scoped policies, 60-second signed URLs, logged downloads.
- Open-redirect protection (`safeNextPath`), security headers (frame denial, nosniff, referrer policy, permissions policy, HSTS on Vercel), no `X-Powered-By`.
- Secrets: none in the repository; `.env*` is ignored; the service-role key and database password are never read by the web app.
