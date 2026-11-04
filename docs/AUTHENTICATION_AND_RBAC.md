# Authentication and RBAC

Status 2026-11-04: **database layer implemented, tested on embedded Postgres, and applied to the live project.** Next.js auth flows (login, reset, sessions) are **not built yet**; no Auth users exist.

## Identity mapping
```
Supabase auth.users.id (uuid, from the verified JWT)
   └─ sims_private.auth_identity_map(auth_user_id PK, user_id UNIQUE)      -- no client privileges
        └─ public.user_account(user_id)  [must be account_status='ACTIVE' and not locked]
             ├─ student_user_account(student_id, user_id)                  -- source table
             └─ employee_user_account(employee_id, user_id)                -- source table
```
- An Auth user id is **never** assumed to equal a student/employee/user id.
- The map is written only by `sims_private.link_auth_user()` (granted to `service_role` only; also usable by a DB admin). `authenticated` cannot read or write the map or call the function (tested).
- `user_metadata` / `app_metadata` are never read. The only client-influenced input is `auth.uid()` from the signed JWT.
- `user_account.password_hash` is a leftover of the MySQL design. Supabase Auth owns credentials. Provisioned users should store a non-usable placeholder; the column is not client-readable (column-level privilege).
- Disabled / locked / pending accounts resolve to **no identity**, so every policy denies (tested).

## Effective permissions
Resolved by `sims_private.eff()` from the source view `v_effective_user_permission` (active role assignments incl. delegations + active overrides; **DENY wins at the same scope**). Added by this layer:
- **Scope containment**: a grant at GLOBAL / INSTITUTION / CAMPUS / DEPARTMENT / PROGRAMME covers rows below it in the hierarchy institution → campus → department → programme. (The source view returns exact-scope rows only; containment is implemented in `sims_private.covers()`.)
- **DENY at any covering scope overrides ALLOW** (decision, stricter than "exact scope only"; flagged for owner confirmation).
- **SELF** scope matches only rows that belong to the caller and is **read-only** through direct table access.
- Permission codes are `MODULE.RESOURCE.ACTION`. A module-wide grant `MODULE.ALL.ACTION` covers ordinary tables; **sensitive resources require their specific grant** (e.g. `EMPLOYEE.BANK_ACCOUNT.READ`, `FEES.FEE_PAYMENT.READ`), `ALL` is not enough.

## Helpers (schema `sims_private`, SECURITY DEFINER, `search_path` pinned, not exposed by the Data API)
`current_user_id/student_id/employee_id`, `eff`, `covers`, `can_global/institution/campus/department/programme`, `can_student/employee/user`, `is_active_member`, `link_auth_user`.

## Not done yet
- Login, logout, forgot / reset password, protected routes and session-expiry handling are built, but have **never been exercised signed in** against a real project (no Auth user exists yet).
- **Bootstrap**: there is no first administrator. Needed: create an Auth user, a `user_account`, a SUPER_ADMIN assignment and the identity link (admin script using the DB connection).
- Role assignment, revocation and account activation / deactivation are built (migration 041, `/admin/users`). Permission overrides have RPCs and a card on `/admin/users/[id]` (migration 057); user creation with a linked person is `/admin/users/new` (M049). Still missing: linking an Auth user that already exists to a student or employee (KI-68). The full list of default grants is `ROLE_PERMISSION_MATRIX.md`.
- MFA is built (migration 045): the database consults `multi_factor_enabled` and demands an aal2 session; see KI-57 for what is not covered (a policy that forces MFA for privileged roles, a real-project run). Recovery codes are built (migration 056, KI-66).
