# Development Checklist

Legend: [x] done and verified · [~] done with gaps (see the linked issue) · [ ] not started · [!] blocked on a person or an external system.
This file is a short view of [RTM.md](RTM.md), which is the source of truth for every requirement. Updated 2026-11-04 (after M057).

## Phase 0 – Audit
- [x] Repository, SQL and data dictionary inspected and reconciled (`PROJECT_AUDIT.md`, `SCHEMA_RECONCILIATION.md`)
- [!] `SIMS_schema_review.md` was never provided (decision D-6)
- [!] Source SQL executed on MySQL as a baseline: MySQL is not available (R-P1-24)

## Phase 1 – MySQL to PostgreSQL
- [x] 213 tables, 500 foreign keys, 16 triggers, 10 views translated; catalogue compared with the source
- [x] Seed data carried (M011); row counts checked by `tools/validate/seed_counts.mjs` (see RTM R-P1-20)
- [x] Migrations 001-063 apply on embedded PostgreSQL and also on a real PostgreSQL 16 (concurrency suite)

## Phase 2 – Identity, RBAC, RLS
- [x] Identity map, scoped permission helpers, deny-by-default RLS, workflow guards
- [x] Admin screens: users, role assignment, account status; audit and sign-in logs
- [x] Two-step verification enforced by the database
- [!] First administrator and Auth dashboard settings (D-1, D-2)

## Phase 3 – Application modules
- [x] Students, employees (with sub-records), admissions, registration, attendance, timetable, assessment, finance (assessments, payments, refunds, receipts, holds), feedback, mentoring, grievances, communication
- [x] Student activities and evidence, staff profile and research, student documents
- [x] Reference-data administration (32 lists), notifications, global search, personal dashboards
- [x] Finance: concessions, scholarships, sponsorships, instalments, late fees, penalties, adjustments (M053, KI-67)
- [x] Employee identity numbers (encrypted), bank accounts, HR documents (M054, KI-65)
- [x] Research leftovers (M055), MFA recovery codes (M056), permission overrides (M057)
- [x] Role-based access completed and documented (M052, `ROLE_PERMISSION_MATRIX.md`)
- [x] Fee structures with approval (M061), holds enforced (M062), link existing users and MFA role policy (M058)
- [ ] Lesson Plan and the dictionary-only tables (decision D-6)

## Phase 4 – Storage
- [x] Private bucket, owner/permission-scoped policies, signed URLs, logged downloads (student documents, activity evidence, staff evidence)
- [x] Employee HR documents (M054)
- [x] Certificate requests (M060), announcement attachments (M059)

## Phase 5 – Tests
- [x] Database, unit, drift, view, concurrency (real PostgreSQL, opt-in) and Playwright smoke suites
- [!] Signed-in browser flows: no Auth user exists yet (D-1)

## Phase 6 – Quality documents
- [x] PROJECT_OVERVIEW, SYSTEM_ARCHITECTURE, DATABASE_SCHEMA, MODULE_DOCUMENTATION, STORAGE_DOCUMENTATION, TESTING_REPORT, SECURITY_AUDIT, PERFORMANCE_REPORT, DEPLOYMENT_GUIDE

## Phase 7 – Deployment
- [x] `vercel.json`, `supabase/config.toml`, deployment checklist
- [!] Nothing deployed; migrations 051-063 not applied to the live project (D-1, D-2)
