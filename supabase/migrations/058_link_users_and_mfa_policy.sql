-- Link an existing Auth user to a person, and "require two-step verification for role X". Hand-written (not from the MySQL source). Closes KI-68 and the policy part of KI-57.
--
-- DESIGN
--  * iam_link_auth_user(email, student number, employee number): for an Auth user created in the dashboard (or by anyone) that has no SIMS account yet. It finds the Auth user by email and runs the
--    same provisioning as migration 049, so the rules (one account per person, audit row, must change password) are identical. iam_link_person(user, student number, employee number) attaches a person
--    to an account that has none. Both need a GLOBAL IAM.ALL.CREATE / UPDATE grant.
--  * mfa_required_role names roles whose holders must use two-step verification. my_context() reports mfa_setup_required = true for a person who holds such a role (active assignment) and has no verified
--    factor; the app then shows only the enrolment screen. The database itself keeps enforcing aal2 only for people who have a factor (a person with no factor must be able to reach the enrolment API),
--    so this policy is an application-level gate plus an audit-visible report (iam_mfa_policy_gaps), not a hard database lock (KI-69).

CREATE TABLE sims_private.mfa_required_role (
    role_id integer PRIMARY KEY REFERENCES public.role(role_id) ON DELETE CASCADE,
    set_by bigint REFERENCES public.user_account(user_id),
    set_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON sims_private.mfa_required_role FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.iam_link_auth_user(p_email text, p_student_number text DEFAULT NULL, p_employee_number text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text := lower(btrim(COALESCE(p_email, ''))); v_auth uuid;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.CREATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.CREATE)' USING ERRCODE = '42501'; END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'A valid email address is required' USING ERRCODE = '22023'; END IF;
    SELECT id INTO v_auth FROM auth.users WHERE lower(email) = v_email LIMIT 1;
    IF v_auth IS NULL THEN RAISE EXCEPTION 'No sign-in account with that email exists yet: create it in the Authentication dashboard first' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM sims_private.auth_identity_map WHERE auth_user_id = v_auth) THEN RAISE EXCEPTION 'That sign-in account is already linked' USING ERRCODE = '23505'; END IF;
    RETURN public.iam_provision_user(v_auth, v_email, p_student_number, p_employee_number, sims_private.current_user_id());
END $$;

CREATE FUNCTION public.iam_link_person(p_user_id bigint, p_student_number text DEFAULT NULL, p_employee_number text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint; v_employee bigint;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_account WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'Unknown user' USING ERRCODE = '22023'; END IF;
    IF p_user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own links' USING ERRCODE = '45000'; END IF;
    IF (NULLIF(btrim(p_student_number), '') IS NULL) = (NULLIF(btrim(p_employee_number), '') IS NULL) THEN RAISE EXCEPTION 'Give either a student number or an employee number' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM student_user_account WHERE user_id = p_user_id) OR EXISTS (SELECT 1 FROM employee_user_account WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'That account is already linked to a person' USING ERRCODE = '23505'; END IF;
    IF NULLIF(btrim(p_student_number), '') IS NOT NULL THEN
        SELECT student_id INTO v_student FROM student WHERE student_number = btrim(p_student_number);
        IF v_student IS NULL THEN RAISE EXCEPTION 'Unknown student number' USING ERRCODE = '22023'; END IF;
        IF EXISTS (SELECT 1 FROM student_user_account WHERE student_id = v_student) THEN RAISE EXCEPTION 'That student already has an account' USING ERRCODE = '23505'; END IF;
        INSERT INTO student_user_account (student_id, user_id) VALUES (v_student, p_user_id);
    ELSE
        SELECT employee_id INTO v_employee FROM employee WHERE employee_number = btrim(p_employee_number);
        IF v_employee IS NULL THEN RAISE EXCEPTION 'Unknown employee number' USING ERRCODE = '22023'; END IF;
        IF EXISTS (SELECT 1 FROM employee_user_account WHERE employee_id = v_employee) THEN RAISE EXCEPTION 'That employee already has an account' USING ERRCODE = '23505'; END IF;
        INSERT INTO employee_user_account (employee_id, user_id) VALUES (v_employee, p_user_id);
    END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, after_values)
    VALUES (sims_private.current_user_id(), 'IAM', 'LINK_PERSON', 'user_account', p_user_id::text, jsonb_build_object('student_id', v_student, 'employee_id', v_employee));
END $$;

-- ---------------------------------------------------------------
-- MFA policy
-- ---------------------------------------------------------------
CREATE FUNCTION public.iam_mfa_policy_list() RETURNS TABLE (role_code text, role_name text, required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.READ)' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT r.role_code::text, r.role_name::text, EXISTS (SELECT 1 FROM sims_private.mfa_required_role m WHERE m.role_id = r.role_id) FROM role r WHERE r.is_active ORDER BY r.role_code;
END $$;

CREATE FUNCTION public.iam_mfa_policy_set(p_role_code text, p_required boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role integer;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.CONFIGURE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.CONFIGURE)' USING ERRCODE = '42501'; END IF;
    SELECT role_id INTO v_role FROM role WHERE role_code = p_role_code AND is_active;
    IF v_role IS NULL THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023'; END IF;
    IF p_required THEN
        INSERT INTO sims_private.mfa_required_role (role_id, set_by) VALUES (v_role, sims_private.current_user_id()) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM sims_private.mfa_required_role WHERE role_id = v_role;
    END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, after_values)
    VALUES (sims_private.current_user_id(), 'IAM', 'MFA_POLICY', 'role', p_role_code, jsonb_build_object('required', p_required));
END $$;

-- who holds a required role but has no verified factor yet
CREATE FUNCTION public.iam_mfa_policy_gaps() RETURNS TABLE (user_id bigint, username text, role_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.READ)' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT DISTINCT u.user_id::bigint, u.username::text, r.role_code::text FROM public.v_active_user_role a JOIN public.user_account u ON u.user_id = a.user_id
                 JOIN role r ON r.role_code = a.role_code JOIN sims_private.mfa_required_role m ON m.role_id = r.role_id
                 WHERE u.account_status = 'ACTIVE' AND NOT u.multi_factor_enabled ORDER BY 2, 3;
END $$;

CREATE FUNCTION sims_private.mfa_setup_required(p_user bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_account u WHERE u.user_id = p_user AND NOT u.multi_factor_enabled)
       AND EXISTS (SELECT 1 FROM public.v_active_user_role a JOIN public.role r ON r.role_code = a.role_code JOIN sims_private.mfa_required_role m ON m.role_id = r.role_id WHERE a.user_id = p_user)
$$;
REVOKE ALL ON FUNCTION sims_private.mfa_setup_required(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_user_id() AS uid)
    SELECT CASE WHEN me.uid IS NULL THEN NULL ELSE jsonb_build_object(
        'user_id', me.uid,
        'username', (SELECT u.username FROM public.user_account u WHERE u.user_id = me.uid),
        'email', (SELECT u.email FROM public.user_account u WHERE u.user_id = me.uid),
        'student_id', sims_private.current_student_id(),
        'employee_id', sims_private.current_employee_id(),
        'mfa_setup_required', sims_private.mfa_setup_required(me.uid),
        'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'role_code', r.role_code, 'role_name', r.role_name, 'scope_type', r.scope_type,
                    'institution_id', r.institution_id, 'campus_id', r.campus_id,
                    'department_id', r.department_id, 'programme_id', r.programme_id))
                 FROM public.v_active_user_role r WHERE r.user_id = me.uid), '[]'::jsonb),
        'readable_modules', COALESCE((SELECT jsonb_agg(DISTINCT split_part(v.permission_code, '.', 1))
                 FROM public.v_effective_user_permission v
                 WHERE v.user_id = me.uid AND v.permission_effect = 'ALLOW' AND v.permission_code LIKE '%.READ'), '[]'::jsonb),
        'permissions', COALESCE((SELECT jsonb_agg(DISTINCT v.permission_code)
                 FROM public.v_effective_user_permission v
                 WHERE v.user_id = me.uid AND v.permission_effect = 'ALLOW' AND v.scope_type <> 'SELF'), '[]'::jsonb)
    ) END
    FROM me
$$;

REVOKE ALL ON FUNCTION public.iam_link_auth_user(text, text, text), public.iam_link_person(bigint, text, text), public.iam_mfa_policy_list(), public.iam_mfa_policy_set(text, boolean), public.iam_mfa_policy_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iam_link_auth_user(text, text, text), public.iam_link_person(bigint, text, text), public.iam_mfa_policy_list(), public.iam_mfa_policy_set(text, boolean), public.iam_mfa_policy_gaps() TO authenticated;
