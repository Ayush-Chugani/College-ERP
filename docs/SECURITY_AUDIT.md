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
| S-4 | Low | After the upgrade to Next 16.4.5 `npm audit` reports 16 moderate findings, all a minimatch ReDoS inside the ESLint toolchain (dev only; nothing of it ships). The earlier high PostCSS advisory is fixed. | Accepted |
| S-5 | Medium | MFA (M045) and the sign-in log exist; recovery codes were added in M056 (KI-66). Not yet exercised against a real Supabase Auth project; there is no "require MFA for role X" policy. | Partly open (KI-57, KI-66) |
| S-6 | Low | No virus scanning or content sniffing of uploads beyond type and size; the declared MIME type comes from the browser (the bucket restricts it as well). | Open (KI-53) |
| S-8 | Medium (found and fixed during development) | `can_student()` and `can_employee()` returned `NULL` instead of `false` for a caller with a SELF grant who is not a student or employee and asks about someone else's record. Callers that write `IF NOT can_student(...) THEN RAISE` would skip their refusal on `NULL`. The rewritten functions (M051) return `false`; the equivalence test covers it. No exploitable path existed in the seed (no role holds such a grant), but the trap was real. | Fixed before release |
| S-9 | Low | The permission memo (M051) caches a caller's permissions for the length of one transaction. A change made inside that same transaction is not seen by later checks of the same user. No RPC depends on it (KI-64). | Documented |
| S-7 | Low | No rate limiting beyond Supabase's built-in Auth limits. | Open |

## Controls in place
- Deny-by-default RLS on every table; the browser only holds the publishable key.
- All privileged writes are `SECURITY DEFINER` RPCs with a fixed `search_path`, a permission check at the row's scope, and one transaction; `EXECUTE` revoked from `PUBLIC` and `anon`.
- Account safeguards: no self status/role change, last super administrator protected, SUPER_ADMIN grants restricted to super administrators.
- Private storage bucket, owner/permission-scoped policies, 60-second signed URLs, logged downloads.
- Open-redirect protection (`safeNextPath`), security headers (frame denial, nosniff, referrer policy, permissions policy, HSTS on Vercel), no `X-Powered-By`.
- Secrets: none in the repository; `.env*` is ignored; the service-role key and database password are never read by the web app.
| S-10 | Medium (found and fixed in M054) | `employee_sensitive_access_audit` could be inserted into, edited and deleted by anyone holding `EMPLOYEE_DOCUMENT` permissions (generated policies), so the access log of PAN, Aadhaar and bank data was not trustworthy. The write policies and grants are removed; only the SECURITY DEFINER functions write it. | Fixed |
| S-11 | Info | PAN, Aadhaar and bank numbers are encrypted at rest under a Vault key, shown masked, revealed only with EXPORT or by the owner with a logged reveal, and never written to the audit log (the three tables are not row-audited, a test checks it). Key rotation is manual (KI-65). | Done |
| S-12 | Medium | Permission overrides (M057): ALLOW of a sensitive, IAM or AUDIT permission is limited to super administrators, nobody edits their own, every change is row-audited. A system administrator can still DENY anyone, including a super administrator, at any scope; that is an availability risk by design. | Accepted |
| S-13 | Medium (found and fixed in M060) | The same NULL-authorisation pattern as S-8, in new code: `NOT (student = current_student_id() OR can_student(...))` is NULL, so an IF on it does not fire, for a caller without a student record. Certificate requests now use `sims_private.is_me_student()` (never NULL); a test covers it. Worth a repo-wide grep for `= sims_private.current_student_id()` / `current_employee_id()` in new code. | Fixed |
| S-14 | Low | The "require MFA for a role" policy is an application-level gate (KI-69): a person without a factor can still call the data API until they enrol. | Open (KI-69) |
