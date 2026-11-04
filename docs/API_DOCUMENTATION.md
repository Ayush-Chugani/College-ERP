# API Documentation

There is no custom REST layer. The API is: PostgREST table access (constrained by RLS, see RLS_SECURITY_MODEL.md) plus these RPCs, called with the user's JWT via `supabase.rpc(name, args)`. All RPCs are `SECURITY DEFINER`, pin `search_path`, are executable by `authenticated` only, and return a clear error (SQLSTATE in brackets) on refusal.

## Context
| RPC | Returns |
|---|---|
| `my_context()` | `null` if the JWT has no active SIMS identity; else `{user_id, username, email, student_id, employee_id, roles[], readable_modules[]}`. Takes no parameters and can only describe the caller. |

| `student_register(p_student jsonb, p_enrolment jsonb?)` → student_id | | |

`student_register` (migration 022): creates a student and, optionally, the first programme enrolment in one transaction. With an enrolment it requires `STUDENT.ALL.CREATE` **and** `ADMISSION.ALL.CREATE` at the programme's scope; without one, a global `STUDENT.ALL.CREATE`. `display_name` is computed server-side; the curriculum scheme must belong to the programme; duplicate student number / email → `23505`. Student edits and status changes use ordinary RLS-checked updates and are audited into `activity_audit` (changed fields only).

`employee_register(p_employee jsonb, p_assignment jsonb?)` → employee_id and `employee_assign(employee_id, campus_id, department_id, designation_id, start_date, is_primary, end_current)` → assignment_id (migration 023). Register needs `EMPLOYEE.ALL.CREATE` at institution scope, or, when an assignment is supplied, at the target department/campus scope within that institution. Assign needs `EMPLOYEE.ALL.UPDATE` on the employee and at the target scope; with `end_current` the current primary is ended the day before the new start date (the single-current-primary rule is also enforced by a unique key). `institution_id` of an employee cannot be changed by end users.

`institution_create(p jsonb)` → id and `institution_update(p_id, p jsonb)` (migration 025): institutions have no client write policy. Create needs a GLOBAL `INSTITUTION.ALL.CREATE`; update needs `INSTITUTION.ALL.UPDATE` covering the institution and applies only the keys present in `p` (null/blank clears optional fields; the university link is immutable). Campus, department, programme and university are written directly under RLS with parent-scope checks.

## Admissions (migration 027)
Direct writes to `admission_applicant` / `admission_application` are closed; reads are RLS-scoped by the application's programme. RPCs (all authorised at the programme's scope):
| RPC | Permission | Notes |
|---|---|---|
| `admission_apply(p_applicant, p_application)` → application_id | `ADMISSION.ALL.CREATE` | New applicant (or `admission_applicant_id` of a visible one) + DRAFT application, atomically. `application_number` is the unique key; duplicates rolled back completely. |
| `admission_update_applicant(id, p)` / `admission_update_application(id, p)` | `ADMISSION.ALL.UPDATE` | Partial updates; terminal applications (ADMITTED/REJECTED/CANCELLED) are read-only. |
| `admission_set_status(id, status, remarks?)` | UPDATE (SUBMITTED, UNDER_REVIEW, CANCELLED), VERIFY (ELIGIBLE, INELIGIBLE), APPROVE (SELECTED, WAITLISTED, REJECTED) | Only allowed transitions (assumed matrix, KI-28); same-status replay is a no-op; ADMITTED only via admit. |
| `admission_admit(id, p_student, p_enrolment)` → student_id | `ADMISSION.ALL.APPROVE` + `STUDENT.ALL.CREATE` (+ `ADMISSION.ALL.CREATE` via `student_register`) | Requires SELECTED. Builds the student from the applicant (explicit values win) and enrols them; all-or-nothing; replay returns the same student. |

## Registration (migrations 028-030)
Offerings, sections, batches, course offerings and registrations are written directly under RLS (scoped by programme / student). Integrity and capacity are enforced by triggers for every writer. RPCs:
| RPC | Permission | Notes |
|---|---|---|
| `offering_generate_courses(programme_term_offering_id)` → count | `TEACHING.ALL.CREATE` at the programme | Creates a course offering per scheme course for that semester; idempotent; `offering_code` = `<offering id>-<course code>`. |
| `registration_roster(offering_id)` | `REGISTRATION.ALL.READ` at the programme | Registered students (number, name, section, status) without needing STUDENT/ADMISSION read. |
| `registration_term_info(term_registration_id)` | same | One registration with the student's name. |
| `registration_candidates(offering_id, q?)` | `REGISTRATION.ALL.CREATE` at the programme | Up to 50 ACTIVE, unregistered enrolments of the programme (and specialisation); search treats `%`, `_`, `\` literally. |
Errors raised by the guards (`45000`): different programme, specialisation mismatch, enrolment not ACTIVE, offering completed/cancelled, section/batch/course full, course offering from another programme term, term registration cancelled/completed.

## Attendance (migration 031)
Teaching sections, instructor assignments and class sessions are written directly under RLS; `student_attendance` and `attendance_correction_request` are **RPC-only**. All RPCs are authorised at the programme's scope.
| RPC | Permission | Notes |
|---|---|---|
| `teaching_populate_roster(cos_id)` → count | `TEACHING.ALL.UPDATE` | Adds course-registered students whose term registration is in the section (and batch); idempotent. |
| `attendance_sheet(session_id)` | `ATTENDANCE.ALL.READ` | Roster with names and current status (names live in a module the marker may not read). |
| `attendance_mark(session_id, marks[])` → count | `ATTENDANCE.ALL.CREATE` (+ `UPDATE` to change existing marks) | `marks` = `[{roster_id, status_id, remarks?}]`, 1-1000 entries, no duplicates, roster must be ACTIVE in this teaching section, status active; all-or-nothing; stamps the acting user; refuses CANCELLED/RESCHEDULED sessions; sets PLANNED -> CONDUCTED. |
| `attendance_request_correction(session_id, roster_id, status_id, reason)` → id | `ATTENDANCE.ALL.CREATE` | Needs an existing mark; one pending request per student/session (replay returns it). |
| `attendance_decide_correction(id, approve)` | `ATTENDANCE.ALL.APPROVE` | Approval applies the status atomically, only if the attendance is unchanged since the request; replays are no-ops. |
| `attendance_summary(cos_id)` | `ATTENDANCE.ALL.READ` | Per student: present, conducted, percentage (assumed definition, KI-35). |

`my_context().permissions` lists the caller's ALLOW codes at non-SELF scopes, for hiding UI actions only.

## Grievance (migration 039)
`grievance` and `grievance_action` are **RPC-only** for writes. Students are authorised by identity (their own record); staff by `GRIEVANCE.ALL.READ` / `UPDATE` at the student's scope.

| RPC | Needs | Notes |
|---|---|---|
| `grievance_submit(category, department?, subject, description, priority)` -> id | student | Active category, subject <= 200, description <= 5000, at most 10 non-closed; writes the first history entry. |
| `grievance_my()` | student | The caller's own grievances. |
| `grievance_student_respond(id, 'CLOSE' or 'REOPEN', notes?)` | the owner | Close a resolved/rejected grievance; re-open a resolved one (clears resolved_at). |
| `grievance_list(search, status, priority, limit, offset)` | `GRIEVANCE.ALL.READ` at the student | Urgent and high priority first. |
| `grievance_detail(id)` -> jsonb | owner or staff reader | The owner never sees INTERNAL_NOTE actions. |
| `grievance_act(id, 'COMMENT' / 'INTERNAL_NOTE' / 'STATUS_CHANGE', notes?, new_status?, resolution?)` | `GRIEVANCE.ALL.UPDATE` | Transition rules in KI-50; replays of a status change are no-ops. |

## Mentoring (migration 038)
`mentor_assignment` writes and all `counselling_session` access are **RPC-only**. Session notes never enter the audit log.

| RPC | Needs | Notes |
|---|---|---|
| `mentoring_assign(student_number, employee_number, start?)` -> id | `MENTORING.ALL.ASSIGN` at the student | Student needs an ACTIVE enrolment; mentor ACTIVE and from the same institution; one ACTIVE mentor per student; idempotent for the same pair. |
| `mentoring_end_assignment(id, status, end_date?)` | `MENTORING.ALL.ASSIGN` | COMPLETED or CANCELLED; replay is a no-op. |
| `mentoring_assignments(search, status, limit, offset)` / `mentoring_assignment_info(id)` | `MENTORING.ALL.READ` at the student, or the assigned mentor | Names resolved server-side. |
| `mentoring_sessions(assignment)` | same | Notes are returned only as the confidentiality level allows (KI-49); otherwise `redacted`. |
| `mentoring_record_session(...)` / `mentoring_update_session(...)` | the assigned mentor (or global CREATE / UPDATE) | Only while the assignment is ACTIVE. |

## Feedback (migration 037)
Configuration tables (categories, questions, choices, questionnaires, items, cycles) are written directly by global `FEEDBACK.ALL.CONFIGURE` holders; guards enforce KI-46 and every change is audited. `feedback_response` / `feedback_response_item` are **RPC-only** for writes.

| RPC | Needs | Notes |
|---|---|---|
| `feedback_my_tasks()` | signed-in student | Open cycles in the student's registered terms: one task per course (COURSE), per course and instructor (FACULTY) or per cycle, with whether it was already submitted. |
| `feedback_form(cycle)` | any active member (RLS) | Questions with active choices. |
| `feedback_submit(cycle, course_offering, faculty_assignment, answers[])` -> receipt token | student | Validates window, registration, instructor and every answer; one submission per cycle/registration/course/instructor; anonymous questionnaires store no registration and a day-truncated time. |
| `feedback_cycle_offerings(cycle)` | `FEEDBACK.ALL.READ` at the programme | Offerings of the cycle's term with response counts; empty while results are HIDDEN. |
| `feedback_results(cycle, course_offering?)` -> jsonb | per visibility level (KI-46) | Per question: answered, average, distribution, and free text only where allowed; suppressed (count only) below 5 visible responses. |

## Dashboard aggregates (migration 036)
SECURITY INVOKER functions: they aggregate the real tables, so RLS decides what each caller counts (no extra authorisation). Anonymous users cannot call them.

| RPC | Returns |
|---|---|
| `dash_enrolments()` | programme, enrolment status, count |
| `dash_applications()` / `dash_registrations()` | status, count |
| `dash_employees()` | employment type, status, count |
| `dash_sessions(days)` | class sessions by status in the last `days` (1-366) days |
| `dash_term_results()` | result status, published flag, count |
| `dash_fee_collection(months)` | one row per UTC month (1-36) with successful payments total and count; empty months are zero |
| `dash_fee_outstanding()` | payable, paid, balance, overdue assessments (excludes draft, cancelled and waived) |

## Timetable (migration 035)
`timetable_session` is written directly under RLS (`TIMETABLE.ALL.CREATE/UPDATE/DELETE` at the programme). A SECURITY DEFINER guard trigger enforces the rules in KI-43 (including clashes with rows the caller cannot see) and every change is audited under module TIMETABLE.

| RPC | Needs | Notes |
|---|---|---|
| `timetable_generate_sessions(cos_id, from, to)` -> count | `ATTENDANCE.ALL.CREATE` and `TIMETABLE.ALL.READ` at the programme | Creates PLANNED `class_session` rows on matching weekdays within each entry's effective period; idempotent on (section, date, start time); at most 367 days. |
| `timetable_offerings(term, programme, limit, offset)` / `timetable_offering_info(pto)` | `TIMETABLE.ALL.READ` | Programme terms with section / entry counts. |
| `timetable_entries(pto)` / `timetable_sections(pto)` / `timetable_assignments(cos_id)` | `TIMETABLE.ALL.READ` | Labelled rows (course, section, instructor, slot, room) for staff who lack TEACHING / EMPLOYEE / INSTITUTION read. |
| `timetable_slots()` / `timetable_rooms()` | `TIMETABLE.ALL.READ` on the campus | Slots and rooms of campuses in scope. |

### Finance read helpers (migration 034)
| RPC | Needs | Notes |
|---|---|---|
| `fin_accounts(search, status, limit, offset)` | `FEES.FEE_ASSESSMENT.READ` per student | Accounts in scope with student names and totals (payable / paid / balance; CANCELLED and WAIVED assessments excluded); search is a literal substring match. |
| `fin_account_info(account_id)` | `FEES.FEE_ASSESSMENT.READ` | Same refusal for unknown and out-of-scope. |
| `fin_open_account(student_number)` -> id | `FEES.FEE_ASSESSMENT.CREATE` | Account number `ACC-<student number>`; idempotent; audited as `ACCOUNT_OPENED`. |
| `fin_academic_years()` | any signed-in user | Plain reference data for the assessment form. |

## Assessment and results (migrations 032, 033)
`student_assessment_mark`, `student_course_result` and `student_term_result` are **RPC-only** for writes. Students read their own rows only once published. All RPCs authorise at the programme's scope.

| RPC | Needs | Notes |
|---|---|---|
| `assessment_offerings(term, programme, limit, offset)` / `assessment_offering_info(id)` | `ASSESSMENT.ALL.READ` or `RESULT.ALL.READ` | Course offerings the caller may see with names (examination staff lack TEACHING/REGISTRATION read). |
| `assessment_sheet(event_id)` | `ASSESSMENT.ALL.READ` | Roster with current marks. |
| `assessment_enter_marks(event_id, marks[])` -> count | `ASSESSMENT.ALL.CREATE` (+ `UPDATE` to change existing marks) | `[{course_registration_id, attendance_status, marks_obtained?, reduced_marks?, remarks?}]`; marks <= event maximum; refused for PUBLISHED/CANCELLED events; PLANNED -> CONDUCTED. |
| `result_course_sheet(course_offering_id)` | `RESULT.ALL.READ` | Latest result per registered student. |
| `result_record_course(reg, internal, external, attempt, status, remarks)` -> id | `RESULT.ALL.CREATE` (+ `UPDATE` to change) | Percentage, grade, status and credits are derived; explicit status ABSENT / WITHHELD / EXEMPTED / INCOMPLETE skips marks. |
| `result_compute_term(term_registration_id)` -> id | `RESULT.ALL.CREATE` | SGPA / CGPA / term status (assumptions in KI-38). |
| `result_publish_term(term_registration_id, publish)` | `RESULT.ALL.PUBLISH` | Makes the term and its course results visible to the student; unpublish reverses. |
| `result_term_sheet(programme_term_offering_id)` | `RESULT.ALL.READ` | Term results with student names. |
| `my_results()` -> jsonb | signed-in student | Own published terms with courses; nothing else. |

## Finance (migration 021)
Direct writes to fee/payment/refund tables are disabled for clients; these are the only write path. Permission shown is checked at the **student's scope** (`FEES.<resource>.<action>`; SELF scope never suffices). Unknown account and out-of-scope account give the same refusal. Every call that changes data writes `fee_activity_audit` with the acting user.

| RPC | Permission | Idempotency key | Behaviour |
|---|---|---|---|
| `fin_create_fee_assessment(assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date, due_date, items jsonb)` → id | `FEE_ASSESSMENT.CREATE` | `assessment_number` | Items `[{fee_type_id, description?, original_amount, concession_amount?, scholarship_amount?, adjustment_amount?, due_date?}]`. Net = original − concession − scholarship + adjustment is computed server-side; header totals follow via triggers; negative nets, >2 decimals, empty items refused. Account must be `ACTIVE`. Status set to `ASSESSED`. |
| `fin_record_payment(transaction_number, student_account_id, payment_mode_id, amount, bank_reference?, payer_name?, remarks?)` → id | `FEE_PAYMENT.CREATE` | `transaction_number` | Offline modes only (online modes are for the gateway integration). Reference required when the mode demands it. Replay with identical details returns the same id; different details → `23505`. |
| `fin_allocate_payment(payment_transaction_id, assessment_item_id, amount)` → id | `FEE_PAYMENT.CREATE` | (payment, item) pair | Same account only; not for cancelled/waived items. Limits enforced by the row-locked source triggers (cannot exceed payment or item net). Sets item/assessment status `PARTIALLY_PAID`/`PAID` from the balance. |
| `fin_request_refund(request_number, student_account_id, payment_transaction_id, amount, reason)` → id | `FEE_REFUND.CREATE` | `request_number` | Payment must be `SUCCESS`/`PARTIALLY_REFUNDED`, same account; amount ≤ refundable balance. |
| `fin_decide_refund(refund_request_id, approve, approved_amount?)` | `FEE_REFUND.APPROVE` | request state | Approve (≤ requested and ≤ refundable) or reject; re-deciding a decided request is refused, an identical replay is a no-op. |
| `fin_process_refund(refund_transaction_number, refund_request_id, refund_mode_id, amount, bank_reference?)` → id | `FEE_REFUND.UPDATE` | `refund_transaction_number` | Requires approval; cumulative refunds ≤ approved amount and ≤ payment (trigger-enforced, row-locked). Marks request `PROCESSED` when fully refunded and payment `PARTIALLY_REFUNDED`/`REFUNDED`. |

Error codes: `42501` not authorised / unknown; `22023` invalid input; `23505` key reused with different details; `45000` business-rule violation (limits, status).

### Not covered
Admission-application (`application_id`) payments, fee receipts (the numbering rule is not defined in the source), online-gateway confirmation, late-fee/installment automation, ledger postings. Concurrent interleavings are protected by row locks and unique keys but **have not been load-tested** (tests ran on a single connection).

## Announcements (migration 040)
Authorised with `COMMUNICATION.ALL.*` at the announcement's department (no department = institution-wide, needs a GLOBAL grant). The generated direct-write policies remain (KI-51).
| RPC | Permission | Notes |
|---|---|---|
| `announcement_save(p_id?, type_id, department_id?, title, description, publish_from, publish_to?, audience)` -> id | CREATE (new) / UPDATE (edit) | Edits only DRAFT or REJECTED. Audience ALL, STUDENTS, STAFF, DEPARTMENT, PROGRAMME, CUSTOM; DEPARTMENT and PROGRAMME need a department. |
| `announcement_set_status(id, status)` | UPDATE (PENDING, ARCHIVED, DRAFT), APPROVE (APPROVED, REJECTED) | DRAFT -> PENDING -> APPROVED / REJECTED, APPROVED -> ARCHIVED, REJECTED -> DRAFT; identical replay returns quietly. |
| `announcement_delete(id)` | DELETE | DRAFT only. |
| `announcement_manage_list(search?, status?, limit, offset)` / `announcement_get(id)` | READ | Staff list with `total_count`; `announcement_get` also returns `can_update`, `can_approve`, `can_delete`. |
| `announcement_feed(limit)` | any active member | APPROVED, inside the publish window, matching the caller's audience (student, employee, department member). CUSTOM is never shown. |

## Identity administration and audit viewer (migration 041)
Everything needs a GLOBAL grant: `IAM.ALL.READ` to read, `IAM.ALL.UPDATE` to change, `AUDIT.ALL.READ` for the audit viewer. Without it the list functions return no rows and the others raise `42501`.
| RPC | Notes |
|---|---|
| `iam_user_list(search?, status?, limit, offset)` / `iam_user_detail(user_id)` / `iam_roles()` | Users with roles and the student or employee they are linked to; detail includes every role assignment and `is_self`. |
| `iam_set_account_status(user_id, status, reason?)` | ACTIVE, DISABLED or LOCKED; a reason is required to disable or lock; not for your own account; the last active GLOBAL SUPER_ADMIN is protected; writes an `activity_audit` row (`IAM` / `ACCOUNT_STATUS`). |
| `iam_assign_role(user_id, role_id, scope_type, scope_entity_id?, reason?)` -> assignment id | Scope must equal the role's level; role active and assignable; only a super administrator grants SUPER_ADMIN; not for your own account; an identical active assignment is returned, not duplicated. |
| `iam_revoke_role(assignment_id, reason?)` | Sets REVOKED and ends validity; same protections; identical replay returns quietly. |
| `audit_list(module?, action?, search?, from?, to?, limit, offset)` / `audit_get(id)` / `audit_modules()` | Newest first with `total_count`; `audit_get` returns the before, after and details JSON. |
Role assignments and permission overrides are row-audited, so permission changes appear in the audit log.

## Student documents (migration 042)
Private bucket `sims-documents`, keys `student/<student_id>/<random>-<name>` (see [STORAGE_DOCUMENTATION.md](STORAGE_DOCUMENTATION.md)). Owners act by identity; staff need `DOCUMENT.ALL.*` at the student's scope.
| RPC | Permission | Notes |
|---|---|---|
| `student_document_register(student_id, document_type_id, storage_key, file_name, mime_type, size, checksum?, number?, issue_date?, expiry_date?)` -> id | owner or CREATE | Validates type, size, extension, key shape, that the object exists and its size matches; creates `file_object` and a PENDING `student_document`. |
| `student_document_list(student_id)` | owner or READ | Includes `effective_status` (VERIFIED past its expiry shows EXPIRED). |
| `student_document_download_info(id)` | owner or READ | Logs a DOWNLOAD audit row and returns the key to sign. |
| `student_document_review(id, decision, remarks?)` | VERIFY | PENDING -> VERIFIED or REJECTED; remarks required to reject. |
| `student_document_delete(id)` -> storage key | owner or DELETE | Never a VERIFIED document; the caller then removes the orphaned object. |

## Student activities (migration 043)
Students act on their own activities by identity; staff need `STUDENT.STUDENT_ACTIVITY[_EVIDENCE|_REPORT].*` at the student's scope. Direct writes to the five activity tables are closed.
| RPC | Permission | Notes |
|---|---|---|
| `student_activity_save(activity_id?, student_id?, p jsonb)` -> id | owner or CREATE / UPDATE | `p` holds type, title, dates, achievement, rank, award, link, texts, year, level, mode; scope is taken from the latest enrolment; only DRAFT can be edited. |
| `student_activity_submit(id)` | owner or UPDATE | Needs start date, team name for team types, mandatory evidence; sets SUBMITTED / PENDING. Replay returns quietly. |
| `student_activity_review(id, step, decision, remarks?)` | VERIFY or APPROVE | VERIFY: VERIFIED, NEEDS_CORRECTION, REJECTED; APPROVE: APPROVED, REJECTED. Remarks required unless the decision is VERIFIED / APPROVED. |
| `student_activity_delete(id, reason?)` | owner or DELETE | Soft delete of a DRAFT or REJECTED activity. |
| `student_activity_team_add(...)` / `student_activity_team_remove(member_id)` | owner or UPDATE | Draft only; a member is either a student or an external person. |
| `student_activity_evidence_add(...)` / `_replace(...)` / `_download_info(id)` / `_delete(id, reason?)` | owner or EVIDENCE.CREATE / UPDATE / READ / DELETE | Same file rules as student documents; replace adds a version; every action writes `student_activity_evidence_audit`; delete is soft. |
| `student_activity_list(student_id?, search?, approval?, limit, offset)` / `student_activity_get(id)` | owner or READ | The list returns the caller's own plus every activity they may read. `get` includes team, current evidence and `can_*` flags. |
| `student_activity_report(year?)` | REPORT.READ | Counts per type and approval status, and how many carry an award. |

## Staff profile and research (migration 044)
Employees act on their own records by identity; staff need `STAFF_PROFILE.STAFF_ACTIVITY|STAFF_EVIDENCE|STAFF_REPORT.*` at the employee's scope. Nobody may verify or approve their own record. Direct writes to the activity, contributor, evidence and 12 detail tables are closed.
| RPC | Permission | Notes |
|---|---|---|
| `staff_detail_schema(activity_type_id)` / `staff_lookup_schema(table)` | any active member | Column description (type, required, max length, referenced table, CHECK choices) used to render the generic forms. |
| `staff_lookup_options(table)` | any active member | id / label pairs for the 26 listed reference tables only (never people tables). |
| `staff_lookup_add(table, p jsonb)` -> id | an employee, or global CREATE | Adds a journal, publisher, conference event, organiser, external organisation or funding agency; errors are readable ("The field \"x\" is required"). |
| `staff_activity_save(activity_id?, employee_id?, p jsonb, detail jsonb?)` -> id | owner or CREATE / UPDATE | Common record plus the detail row of the type in one transaction; DRAFT only; changing the type swaps the detail row. |
| `staff_activity_submit(id)` / `staff_activity_review(id, step, decision, remarks?)` / `staff_activity_delete(id, reason?)` | owner or UPDATE; VERIFY / APPROVE; owner or DELETE | Same lifecycle and rules as student activities. |
| `staff_contributor_add(...)` / `staff_contributor_remove(id)` | owner or UPDATE | Draft only; an employee or an external person. |
| `staff_evidence_add(...)` / `_replace(...)` / `_download_info(id)` / `_delete(id, reason?)` | owner or EVIDENCE.* | Keys under `employee/<id>/`; versions kept; every action audited in `evidence_document_audit`. |
| `staff_activity_list(employee_id?, search?, approval?, group?, limit, offset)` / `staff_activity_get(id)` / `staff_activity_report(year?)` | owner or READ; REPORT.READ | `get` returns the detail row as JSON, contributors, evidence and `can_*` flags. |

## Workflow guards (migration 020)
Not an API, but visible to clients: updates that set approval/verification/publication state or actor columns raise `42501` ("Not authorised to APPROVE/VERIFY/PUBLISH …" or "… must be the acting user") unless the caller holds the matching permission at the row's scope.
