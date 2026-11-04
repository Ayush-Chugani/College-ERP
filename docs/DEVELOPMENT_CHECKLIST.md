# Development Checklist
Legend: [x] done and verified · [~] in progress · [ ] not started · [!] blocked

## Phase 0 – Audit
- [x] Inspect repository (empty apart from 2 source files)
- [x] Inspect SQL (counts measured)
- [x] Reconcile SQL vs dictionary (`tools/reconcile.py`)
- [x] `docs/PROJECT_AUDIT.md`, `docs/SCHEMA_RECONCILIATION.md`
- [!] `SIMS_schema_review.md` not available (B1)

## Phase 1 – MySQL to PostgreSQL
- [ ] Decide B3 (validation engine) and B5 (citext)
- [ ] Translator for tables/columns/indexes/FKs/checks
- [ ] Generated columns, enums, unsigned range checks, `updated_at` triggers
- [ ] 16 triggers to PL/pgSQL (hand-ported, tested)
- [ ] 10 views as `security_invoker` views
- [ ] 103 seed INSERTs
- [ ] Migration run on clean Postgres; catalogue diff vs MySQL baseline

## Phases 2–10
- [ ] Identity map, RBAC helpers, RLS, storage, services, frontend, modules, tests, docs, deployment
