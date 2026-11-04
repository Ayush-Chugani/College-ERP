-- Identity mapping (Supabase Auth -> SIMS user_account) and effective-permission helpers for RLS.
-- Hand-written (not generated from the MySQL source). See docs/AUTHENTICATION_AND_RBAC.md.
--
-- Trust model
--   * auth.uid() comes from the verified JWT. It is the only client-influenced input and is never trusted as a role/permission/tenant.
--   * auth.uid() -> user_account is resolved ONLY through sims_private.auth_identity_map, which no client role can read or write.
--   * user_account -> student/employee uses the source tables student_user_account / employee_user_account (writes are server-only).
--   * Authority comes from user_role_assignment / role_permission / user_permission_override via v_effective_user_permission.
--   * user_metadata / app_metadata in the JWT are never read.

CREATE SCHEMA IF NOT EXISTS sims_private;
REVOKE ALL ON SCHEMA sims_private FROM PUBLIC;
GRANT USAGE ON SCHEMA sims_private TO authenticated, service_role;

CREATE TABLE sims_private.auth_identity_map (
    auth_user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    user_id      bigint NOT NULL UNIQUE REFERENCES public.user_account (user_id),
    linked_at    timestamptz NOT NULL DEFAULT now(),
    linked_by    text
);
ALTER TABLE sims_private.auth_identity_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sims_private.auth_identity_map FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- Identity resolution
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.current_user_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT m.user_id
    FROM sims_private.auth_identity_map m
    JOIN public.user_account u ON u.user_id = m.user_id
    WHERE m.auth_user_id = auth.uid()
      AND u.account_status = 'ACTIVE'
      AND (u.locked_until IS NULL OR u.locked_until <= now())
$$;

CREATE FUNCTION sims_private.current_student_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT s.student_id FROM public.student_user_account s WHERE s.user_id = sims_private.current_user_id()
$$;

CREATE FUNCTION sims_private.current_employee_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT e.employee_id FROM public.employee_user_account e WHERE e.user_id = sims_private.current_user_id()
$$;

-- ---------------------------------------------------------------
-- Effective permission rows for the caller (reuses the source view; DENY wins)
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.eff(p_codes text[]) RETURNS TABLE (scope_type text, scope_entity_id bigint, permission_effect text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT v.scope_type::text, v.scope_entity_id::bigint, v.permission_effect::text
    FROM public.v_effective_user_permission v
    WHERE v.user_id = sims_private.current_user_id()
      AND v.permission_code = ANY (p_codes)
$$;

-- Allow iff some covering scope ALLOWs and no covering scope DENYs.
-- p_self_ok: the row belongs to the caller, so SELF-scope grants may apply (read-only usage is decided by callers).
CREATE FUNCTION sims_private.covers(p_codes text[], p_inst bigint, p_campus bigint, p_dept bigint, p_prog bigint, p_self_ok boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(bool_or(m.permission_effect = 'ALLOW') AND NOT bool_or(m.permission_effect = 'DENY'), false)
    FROM sims_private.eff(p_codes) m
    WHERE m.scope_type = 'GLOBAL'
       OR (m.scope_type = 'INSTITUTION' AND m.scope_entity_id = p_inst)
       OR (m.scope_type = 'CAMPUS'      AND m.scope_entity_id = p_campus)
       OR (m.scope_type = 'DEPARTMENT'  AND m.scope_entity_id = p_dept)
       OR (m.scope_type = 'PROGRAMME'   AND m.scope_entity_id = p_prog)
       OR (p_self_ok AND m.scope_type = 'SELF')
$$;

CREATE FUNCTION sims_private.can_global(p_codes text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.covers(p_codes, NULL, NULL, NULL, NULL, false)
$$;

CREATE FUNCTION sims_private.can_institution(p_codes text[], p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.covers(p_codes, p_id, NULL, NULL, NULL, false)
$$;

CREATE FUNCTION sims_private.can_campus(p_codes text[], p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT sims_private.covers(p_codes, c.institution_id, c.campus_id, NULL, NULL, false)
                     FROM public.campus c WHERE c.campus_id = p_id),
                    sims_private.can_global(p_codes))
$$;

CREATE FUNCTION sims_private.can_department(p_codes text[], p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT sims_private.covers(p_codes, c.institution_id, c.campus_id, d.department_id, NULL, false)
                     FROM public.department d JOIN public.campus c ON c.campus_id = d.campus_id
                     WHERE d.department_id = p_id),
                    sims_private.can_global(p_codes))
$$;

CREATE FUNCTION sims_private.can_programme(p_codes text[], p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT sims_private.covers(p_codes, c.institution_id, c.campus_id, d.department_id, p.programme_id, false)
                     FROM public.programme p
                     JOIN public.department d ON d.department_id = p.department_id
                     JOIN public.campus c ON c.campus_id = d.campus_id
                     WHERE p.programme_id = p_id),
                    sims_private.can_global(p_codes))
$$;

-- Student rows: SELF (read only) or staff scope through any programme enrolment of the student.
CREATE FUNCTION sims_private.can_student(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_global(p_codes)
        OR (NOT p_write AND p_id IS NOT NULL AND p_id = sims_private.current_student_id()
            AND sims_private.covers(p_codes, NULL, NULL, NULL, NULL, true))
        OR EXISTS (
            SELECT 1
            FROM public.student_programme_enrolment e
            JOIN public.programme p ON p.programme_id = e.programme_id
            JOIN public.department d ON d.department_id = p.department_id
            JOIN public.campus c ON c.campus_id = d.campus_id
            WHERE e.student_id = p_id
              AND sims_private.covers(p_codes, c.institution_id, c.campus_id, d.department_id, p.programme_id, false))
$$;

-- Employee rows: SELF (read only), institution scope, or scope through a current assignment.
CREATE FUNCTION sims_private.can_employee(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_global(p_codes)
        OR (NOT p_write AND p_id IS NOT NULL AND p_id = sims_private.current_employee_id()
            AND sims_private.covers(p_codes, NULL, NULL, NULL, NULL, true))
        OR EXISTS (SELECT 1 FROM public.employee e
                   WHERE e.employee_id = p_id AND sims_private.covers(p_codes, e.institution_id, NULL, NULL, NULL, false))
        OR EXISTS (
            SELECT 1
            FROM public.employee_assignment a
            JOIN public.campus c ON c.campus_id = a.campus_id
            WHERE a.employee_id = p_id AND a.end_date IS NULL
              AND sims_private.covers(p_codes, c.institution_id, c.campus_id, a.department_id, NULL, false))
$$;

-- User-owned rows (logs, histories): own rows are readable; anything else needs a global grant.
CREATE FUNCTION sims_private.can_user(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_global(p_codes)
        OR (NOT p_write AND p_id IS NOT NULL AND p_id = sims_private.current_user_id())
$$;

-- Any authenticated, ACTIVE, identity-mapped user (reference data and org directory).
CREATE FUNCTION sims_private.is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.current_user_id() IS NOT NULL
$$;

-- ---------------------------------------------------------------
-- Server-only provisioning of the identity link (service role / DB admin; never exposed to clients)
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.link_auth_user(p_auth_user uuid, p_user_id bigint, p_actor text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.user_account WHERE user_id = p_user_id) THEN
        RAISE EXCEPTION 'user_account % does not exist', p_user_id USING ERRCODE = '45000';
    END IF;
    INSERT INTO sims_private.auth_identity_map (auth_user_id, user_id, linked_by) VALUES (p_auth_user, p_user_id, p_actor);
END $$;

-- Function privileges: no PUBLIC execute; helpers for policy evaluation go to authenticated, provisioning to service_role only.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sims_private FROM PUBLIC;
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sims_private' LOOP
        IF r.proname = 'link_auth_user' THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
        ELSE
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
        END IF;
    END LOOP;
END $$;

-- public-schema functions from migration 014 are trigger/internal helpers: not callable through the API.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
