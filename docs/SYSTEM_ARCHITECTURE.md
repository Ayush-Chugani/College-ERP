# System architecture

```
Browser ──(publishable key + user JWT)──> Supabase
   │                                        ├─ Auth: sessions, password reset
   │ Next.js 15 (App Router, Vercel)        ├─ PostgREST: table reads under RLS
   │  ├─ middleware: session refresh,       ├─ RPCs (SECURITY DEFINER): every privileged write
   │  │   redirect to /login                ├─ Storage: private bucket sims-documents
   │  ├─ server components: load data       └─ PostgreSQL: schema public (213 tables), sims_private (helpers)
   │  └─ client components: forms (react-hook-form + Zod), toasts
```

## Layers
| Layer | Where | Responsibility |
|---|---|---|
| Routes | `src/app/(auth)`, `src/app/(app)` | pages, loading and error states |
| Features | `src/features/*-data.ts`, `*-forms.tsx` | data access (server), mutations (client) |
| Validation | `src/lib/*-validation.ts` | Zod schemas shared by forms and tests; drift-tested against migrations |
| Identity | `src/lib/server-context.ts`, `context.ts`, `nav.ts` | `my_context()` once per request; navigation is a convenience, RLS is the enforcement |
| Database | `supabase/migrations/001-051` | schema, RLS, workflow guards, audit triggers, RPCs |

## Decisions
- Server components load data, so TanStack Query is not used (KI/RTM R-STK-6).
- Authorisation lives in PostgreSQL (`sims_private.can_*` at department, programme, student, employee scope), never in the UI alone.
- Every privileged workflow is one RPC = one transaction; clients cannot write those tables directly.
- Row level security decides row by row. To keep that cheap, M051 resolves the caller once per transaction and evaluates the permission functions against a decoded, transaction-local set (PERFORMANCE_REPORT.md, PERFORMANCE_REPORT_NATIVE.md, KI-61, KI-64).
- Edge Functions are not needed until payment-gateway or email integrations arrive.

Details: AUTHENTICATION_AND_RBAC.md, RLS_SECURITY_MODEL.md, RLS_POLICY_MAP.md.
