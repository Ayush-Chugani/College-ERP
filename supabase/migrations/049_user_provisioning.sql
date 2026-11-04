-- User provisioning: create a SIMS account for a Supabase Auth user. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * The Auth user itself (email and password) is created by the web server with the Supabase admin API and the service-role key, which only
--    exists on the server. This migration adds the database half: a function only service_role may call that creates the user_account,
--    optionally links it to a student or employee, and maps the Auth identity. It never sees or stores a password.
--  * iam_can_provision() lets the server ask, with the caller's own session, whether that caller may create users. The server must call it
--    BEFORE using the service-role key; the service-role function itself trusts its caller, as every service-role call does.
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-62):
--  1  Creating users needs a GLOBAL IAM.ALL.CREATE grant. New accounts start ACTIVE with must_change_password = true and no roles; roles are
--     assigned afterwards (iam_assign_role) so that every grant stays audited.
--  2  A student or employee record can be linked to at most one account, and an account to at most one of them.
--  3  The username is the lower-cased email address.

CREATE FUNCTION public.iam_can_provision() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_global(ARRAY['IAM.ALL.CREATE']::text[])
$$;

CREATE FUNCTION public.iam_provision_user(p_auth_user uuid, p_email text, p_student_number text, p_employee_number text, p_actor_user_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text := lower(btrim(COALESCE(p_email, ''))); v_user bigint; v_student bigint; v_employee bigint;
BEGIN
    IF p_auth_user IS NULL THEN RAISE EXCEPTION 'The Auth user id is required' USING ERRCODE = '22023'; END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'A valid email address is required' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_student_number), '') IS NOT NULL AND NULLIF(btrim(p_employee_number), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Link the account to a student or an employee, not both' USING ERRCODE = '22023';
    END IF;

    -- idempotent replay: the Auth user is already provisioned
    SELECT user_id INTO v_user FROM sims_private.auth_identity_map WHERE auth_user_id = p_auth_user;
    IF v_user IS NOT NULL THEN RETURN v_user; END IF;

    IF EXISTS (SELECT 1 FROM user_account WHERE lower(username) = v_email OR lower(email) = v_email) THEN
        RAISE EXCEPTION 'An account with that email already exists' USING ERRCODE = '23505';
    END IF;
    IF NULLIF(btrim(p_student_number), '') IS NOT NULL THEN
        SELECT student_id INTO v_student FROM student WHERE student_number = btrim(p_student_number);
        IF v_student IS NULL THEN RAISE EXCEPTION 'Unknown student number' USING ERRCODE = '22023'; END IF;
        IF EXISTS (SELECT 1 FROM student_user_account WHERE student_id = v_student) THEN RAISE EXCEPTION 'That student already has an account' USING ERRCODE = '23505'; END IF;
    END IF;
    IF NULLIF(btrim(p_employee_number), '') IS NOT NULL THEN
        SELECT employee_id INTO v_employee FROM employee WHERE employee_number = btrim(p_employee_number);
        IF v_employee IS NULL THEN RAISE EXCEPTION 'Unknown employee number' USING ERRCODE = '22023'; END IF;
        IF EXISTS (SELECT 1 FROM employee_user_account WHERE employee_id = v_employee) THEN RAISE EXCEPTION 'That employee already has an account' USING ERRCODE = '23505'; END IF;
    END IF;

    INSERT INTO user_account (username, password_hash, email, account_status, must_change_password)
    VALUES (v_email, '!supabase-auth', v_email, 'ACTIVE', true) RETURNING user_id INTO v_user;
    IF v_student IS NOT NULL THEN INSERT INTO student_user_account (student_id, user_id) VALUES (v_student, v_user); END IF;
    IF v_employee IS NOT NULL THEN INSERT INTO employee_user_account (employee_id, user_id) VALUES (v_employee, v_user); END IF;
    PERFORM sims_private.link_auth_user(p_auth_user, v_user, COALESCE('provisioned by user ' || p_actor_user_id, 'provisioned'));
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, after_values)
    VALUES (p_actor_user_id, 'IAM', 'PROVISION', 'user_account', v_user::text, jsonb_build_object('email', v_email, 'student_id', v_student, 'employee_id', v_employee));
    RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION public.iam_can_provision() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iam_can_provision() TO authenticated;
REVOKE ALL ON FUNCTION public.iam_provision_user(uuid, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.iam_provision_user(uuid, text, text, text, bigint) TO service_role;
    END IF;
END $$;
