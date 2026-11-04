# Performance report

> **Update (migration 051).** The finding below (KI-61) is mitigated: the caller's permissions are resolved once per transaction and the helpers evaluate against a decoded set (steps 1 and 2 of the recommended fix, KI-64). On a native PostgreSQL 16 with the same 20,000 students, the exact count of students went from more than 20 s to about 0.7 s, and the activity lists from 2.4 s to 0.5 s. The before/after table, the plans and the remaining cost (about 30 microseconds per row, so set-based policies are the next step if the institution grows) are in [PERFORMANCE_REPORT_NATIVE.md](PERFORMANCE_REPORT_NATIVE.md). The statement "No caching is used" at the end of this report no longer holds: there is a per-transaction memo (KI-64). The text below is the original first measurement, unchanged.

Status 2026-11-04. This is the first measurement of query plans. It answers KI-10 ("RLS helper performance unmeasured") and finds a **real problem**.

## How it was measured

- `tests/perf/explain.perf.ts`, run with `npx vitest run --config tests/perf/vitest.perf.config.ts` (it is not part of `npm test`).
- Embedded PostgreSQL (PGlite, PostgreSQL compiled to WASM) with all migrations applied, on a development machine.
- **Synthetic data only**, created in that throw-away database: 20,000 students with enrolments, 20,000 financial accounts, 40,000 fee assessments, 40,000 payments, 6,000 grievances. The live project was not touched and holds no data.
- Each statement ran as a real signed-in role (`registrar1` or `finance1` of the test fixture) under row-level security, with `EXPLAIN (ANALYZE, BUFFERS)`.
- WASM PostgreSQL is much slower than a native server, so **the absolute times are not production latencies**. What matters is the shape: which queries scale with the number of rows the policies must check.

## Results

| Query (as the app issues it) | Execution time | Seq scan on | Comment |
|---|---|---|---|
| Student by number (index lookup) | 2 ms | - | fine |
| Students, first page by student number (`limit 20`) | 55 ms | - | fine: the index order lets the scan stop early |
| Students, exact count (the list header) | **36,440 ms** | student | every row is checked by the policy |
| Students, deep page (`offset 10000`) | **27,401 ms** | - | 10,000 rows are checked and thrown away |
| Students, name search (`ilike`) | **49,671 ms** | student | every row is checked |
| Dashboard: enrolments by programme and status | **35,308 ms** | - | |
| Dashboard: fee collection (6 months) | **63,069 ms** | - | |
| Dashboard: fee outstanding | **63,628 ms** | - | |
| Finance: account list (first page, with totals) | **31,174 ms** | - | |
| Finance: account search by student number | **31,316 ms** | - | |
| Grievances: staff list | **8,495 ms** | - | 6,000 rows |

## Finding (KI-61, P1)

Anything that has to look at many rows, such as a count, a search, a deep page or a dashboard total, costs about **1 to 3 ms per row** here. That is the cost of the row-level-security helpers, which are called **once per row**: `can_student()` looks up the student's enrolment and programme and then calls `covers()` and `eff()`, which read the permission view again for every row. A first page is fast only because it stops after 20 rows.

On a native server the same work is perhaps 10 to 30 times faster, which still means seconds for a count over 20,000 students, and dashboards that scale with the whole institution. This would show up as slow list headers, searches and dashboards on a real institution (the prompt says to optimise for realistic institutional workloads). It is not a correctness problem: the results were right.

### Cause

The generated policies (M018, M029) have the form `USING (sims_private.can_student(codes, <student id of the row>, false))`. PostgreSQL cannot hoist that out of the scan because its argument changes per row, so it re-evaluates the permission lookup each time.

### Recommended fix (not done yet)

1. Compute the caller's permission set **once per statement**: a STABLE function that returns the effective grants as an array or a materialised set, referenced as an `InitPlan` (`(SELECT ...)`), so it runs once.
2. For student-anchored tables, replace the per-row call with a membership test against a set computed once: `student_id IN (SELECT sims_private.visible_student_ids(codes))` (or an `= ANY(array)` on a cached array). That turns an O(rows x lookup) scan into one lookup plus a hash probe.
3. Do the same for the department, campus and programme anchors, then regenerate the policies with `tools/build_rls.py` and re-run the full test suite (the RLS tests prove behaviour is unchanged).
4. Re-run `tests/perf/explain.perf.ts` and compare. A realistic target is under a second for each query above on this machine.
5. Until then, keep list pages on `limit`/index-ordered queries (the app already pages at 20) and avoid exact counts on the biggest tables: use an estimate or drop the total.

This is a change to every generated policy, so it needs its own migration and review; I have not made it in this task.

## What was checked and is fine

- Index lookups and ordered first pages are fast.
- Pagination is server-side everywhere; no screen loads a whole table into the browser.
- Dashboard numbers come from database aggregates, not from the browser.
- No caching is used, so nothing can leak across users.

## Not measured

- Concurrent load (no multi-connection database is available here).
- The live Supabase project (empty, and no synthetic data may be written to it).
- File upload and signed-URL latency.
- Query plans for the remaining RPCs (attendance sheet, assessment sheet, feedback results, timetable entries); they are bounded by one section or offering but were not timed.
