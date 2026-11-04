# Module documentation

One section per application area: what it does, where it lives, the database objects behind it and what is not covered. Exact permissions and parameters are in [API_DOCUMENTATION.md](API_DOCUMENTATION.md); rules the source did not state are listed as inferences in [KNOWN_ISSUES.md](KNOWN_ISSUES.md); status per requirement is in [RTM.md](RTM.md).

## How every module is built
- **Screens** are server components that load data (`src/features/<module>-data.ts`) plus client forms (`<module>-forms.tsx`) validated with Zod (`src/lib/<module>-validation.ts`).
- **Writes** that matter go through one `SECURITY DEFINER` RPC = one transaction, which authorises the caller at the row's scope, validates, writes and audits. Where a module has no RPC the table's own row level security policy decides.
- **Authorisation** is `sims_private.can_global / can_institution / can_department / can_programme / can_student / can_employee` against permission codes such as `STUDENT.ALL.READ`. Owners (a student, an employee) act on their own records by identity because the seed gives them SELF-scope grants only.
- **Tests**: a database test per migration on embedded PostgreSQL, unit tests for validation and for "drift" between application tables and the migrations, Playwright for route protection.

## Platform and access
| Area | Screens | Database | Notes |
|---|---|---|---|
| Identity and access (module 2) | `/login`, `/forgot-password`, `/reset-password`, `/mfa`, `/settings`, `/admin/users`, `/admin/users/[id]`, `/no-access` | M006, M017-M020, M041, M045 | Users, role assignments with safeguards, TOTP two-step verification enforced by the database, own contact details |
| Reference data (module 1) | `/admin/reference`, `/admin/reference/[table]` | M001, M011, M046 | 32 maintainable lists |
| Audit and compliance (module 9) | `/audit`, `/audit/[id]`, `/audit/logins` | M006, M022, M041, M045 | Row-level audit triggers, manual audit rows for RPC actions, sign-in log |
| Notifications and search | header bell, `/notifications`, `/search` | M045 | Computed from live data under the caller's RLS |

## Institution and academics
| Module | Screens | Database | Notes |
|---|---|---|---|
| University and institution (3) | `/structure` | M025 | Tree of university, institution, campus, department, programme |
| Academic calendar (4) | `/calendar` | M024 | Years, terms, semesters |
| Curriculum and courses (5) | `/curriculum`, `/courses` | M026 | Schemes, courses, prerequisites |
| Admissions (11) | `/admissions` | M027 | Applications through to admit-to-student |
| Student registration (12) | `/registration` | M028-M030 | Term offerings, sections, course registration with capacity |
| Attendance (13), Timetable (14) | `/attendance`, `/timetable` | M031, M035 | Rosters, sessions, marking, corrections, clash-guarded timetable |
| Assessment and results (15) | `/assessment`, `/results/grades`, `/my-results` | M032, M033 | Marks, SGPA/CGPA, publication |
| Feedback (16), Mentoring (17), Grievance (20) | `/feedback`, `/mentoring`, `/grievances` | M037, M038, M039 | Anonymous feedback, confidential counselling, grievance workflow |

## People
| Module | Screens | Database | Notes |
|---|---|---|---|
| Students (6) | `/students`, `/students/[id]/records`, `/students/[id]/documents` | M022, M042, M046 | Registration, edit, status, sub-records, documents |
| Employees (7) | `/employees`, `/employees/[id]/records`, `/employees/[id]/hr`, `/my-hr` | M023, M046, M054, M063 | Registration, assignments, qualifications, previous employment; PAN, Aadhaar and bank accounts (encrypted, masked, reveal logged) and HR documents; employees see and correct their own until HR verifies |
| Student documents (8) | `/my-documents`, `/certificates` | M042, M060 | Private bucket, signed URLs, verification; certificate requests with approval and an issued PDF |
| Student activities and evidence (23) | `/activities` | M043 | Draft, evidence with versions, verification, approval, team |
| Staff profile and research (22) | `/staff-profile` | M044, M055 | 12 kinds of record through a catalogue-driven form, contributors, evidence; research supervision, project utilisation and journal / conference indexing on the record; journal metrics in the reference data |

## Communication and finance
| Module | Screens | Database | Notes |
|---|---|---|---|
| Communication (10) | `/announcements`, `/announcements/manage` | M040, M059 | Audiences, approval workflow, feed |
| Student finance (21) | `/finance`, `/finance/account/[id]`, `/finance/receipt/[id]` | M008, M014, M021, M034, M047, M052, M053, M061, M062, M063 | Assessments, payments, allocations, refunds, receipts, holds. Concessions, scholarships, sponsorships, adjustments, instalments, late fees and penalties (M052, M053); students see their own account; fee structures are drafted, approved and versioned on `/finance/structures`; holds block registration, results and certificates. |

## Dashboards
`/dashboard` shows the charts for the modules the caller can read (M036) plus personal cards (M048): a student's classes today, attendance per course and results; an employee's upcoming sessions and unmarked ones.

## Cross-cutting mechanisms worth knowing
- **Generic catalogue-driven forms** (`sims_private.describe_columns`, `form_columns`, `write_row`, `write_detail`): used for staff record details (M044), student and employee sub-records and reference data (M046). Only whitelisted tables are reachable, only catalogue columns can be written, keys, audit columns and user references are rejected, and constraint violations become readable messages.
- **Workflow lifecycle** (DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED, NEEDS_CORRECTION back to DRAFT, nobody reviews their own record): student activities (M043) and staff records (M044), sharing `workflow-actions.tsx` and `evidence-panel.tsx`.
- **Private Storage**: one bucket, `student/<id>/...` and `employee/<id>/...` prefixes, 60-second signed URLs after an RPC has authorised and logged the download ([STORAGE_DOCUMENTATION.md](STORAGE_DOCUMENTATION.md)).

## Access control
Every default grant is listed in [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md) (generated). Per-user exceptions are permission overrides on `/admin/users/[id]` (migration 057). Recovery codes for two-step verification are on `/settings` (migration 056).

## Student services
`/requests` (migration 063): hall ticket per term, hostel check-out and graduation requests, approved by `DOCUMENT.ALL.APPROVE`, blocked by the matching fee hold. `/certificates` (migration 060): certificate requests.
