-- Identity administration (account status, role assignment) and the audit viewer. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * user_account and user_role_assignment stay unwritable by clients. These SECURITY DEFINER RPCs are the only way to change them from the app, each in one transaction.
--  * Everything here needs a GLOBAL grant (IAM.ALL.READ / IAM.ALL.UPDATE / AUDIT.ALL.READ). Account status changes write their own activity_audit row (user_account is not
--    row-audited because its row holds password_hash); role assignments and permission overrides are row-audited (permission change history, R-AUD-6).
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-52):
--  1  A caller cannot change their own account status or revoke their own roles (no self lock-out, no self-escalation).
--  2  The last active GLOBAL SUPER_ADMIN cannot be disabled, locked or revoked.
--  3  Only a SUPER_ADMIN may grant or revoke the SUPER_ADMIN role.
--  4  The assignment scope must equal the role's role_level; the role must be active and assignable.
--  5  Assigning an identical active assignment again returns the existing row.

CREATE TRIGGER trg_user_role_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON user_role_assignment FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('IAM', 'user_role_assignment_id');
CREATE TRIGGER trg_user_permission_override_audit AFTER INSERT OR UPDATE OR DELETE ON user_permission_override FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('IAM', 'user_permission_override_id');

-- Does the caller hold an active GLOBAL assignment of this role?
CREATE FUNCTION sims_private.caller_has_role(p_role_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM user_role_assignment a JOIN role r ON r.role_id = a.role_id
                   WHERE a.user_id = sims_private.current_user_id() AND r.role_code = p_role_code AND a.scope_type = 'GLOBAL' AND a.assignment_status = 'ACTIVE'
                     AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now()))
$$;

-- Number of ACTIVE accounts, other than p_user_id, holding an active GLOBAL SUPER_ADMIN assignment.
CREATE FUNCTION sims_private.other_super_admins(p_user_id bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT count(DISTINCT a.user_id)::integer FROM user_role_assignment a JOIN role r ON r.role_id = a.role_id JOIN user_account u ON u.user_id = a.user_id
    WHERE r.role_code = 'SUPER_ADMIN' AND a.scope_type = 'GLOBAL' AND a.assignment_status = 'ACTIVE' AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now())
      AND u.account_status = 'ACTIVE' AND a.user_id <> p_user_id
$$;

CREATE FUNCTION public.iam_roles() RETURNS TABLE (role_id integer, role_code text, role_name text, role_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.role_id::integer, r.role_code::text, r.role_name::text, r.role_level::text FROM role r
    WHERE r.is_active AND r.is_assignable AND sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) ORDER BY r.role_name
$$;

CREATE FUNCTION public.iam_user_list(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (user_id bigint, username text, email text, account_status text, last_login_at timestamptz, roles text, linked_to text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH v AS (
        SELECT u.user_id, u.username::text, u.email::text, u.account_status::text, u.last_login_at,
               COALESCE((SELECT string_agg(DISTINCT r.role_name, ', ' ORDER BY r.role_name) FROM user_role_assignment a JOIN role r ON r.role_id = a.role_id
                         WHERE a.user_id = u.user_id AND a.assignment_status = 'ACTIVE' AND (a.valid_to IS NULL OR a.valid_to > now())), '')::text AS roles,
               COALESCE((SELECT 'Student ' || s.student_number FROM student_user_account su JOIN student s ON s.student_id = su.student_id WHERE su.user_id = u.user_id),
                        (SELECT 'Employee ' || e.employee_number FROM employee_user_account eu JOIN employee e ON e.employee_id = eu.employee_id WHERE eu.user_id = u.user_id), '')::text AS linked_to
        FROM user_account u
        WHERE sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) AND (p_status IS NULL OR u.account_status = p_status)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(u.username || ' ' || COALESCE(u.email, ''))) > 0)
    )
    SELECT v.user_id::bigint, v.username, v.email, v.account_status, v.last_login_at, v.roles, v.linked_to, count(*) OVER ()
    FROM v ORDER BY v.username LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.iam_user_detail(p_user_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u record;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.READ)' USING ERRCODE = '42501'; END IF;
    SELECT user_id, username, email, account_status, last_login_at, locked_until INTO u FROM user_account WHERE user_id = p_user_id;
    IF u.user_id IS NULL THEN RAISE EXCEPTION 'Unknown user' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('user_id', u.user_id, 'username', u.username, 'email', u.email, 'account_status', u.account_status, 'last_login_at', u.last_login_at, 'locked_until', u.locked_until,
        'is_self', u.user_id = sims_private.current_user_id(), 'can_update', sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]),
        'assignments', COALESCE((SELECT jsonb_agg(jsonb_build_object('assignment_id', a.user_role_assignment_id, 'role_name', r.role_name, 'role_code', r.role_code, 'scope_type', a.scope_type,
                'scope', COALESCE(i.institution_name, c.campus_name, d.department_name, p.programme_name, ''), 'status', a.assignment_status, 'valid_from', a.valid_from, 'valid_to', a.valid_to, 'reason', a.assignment_reason)
                ORDER BY a.assignment_status, a.user_role_assignment_id)
            FROM user_role_assignment a JOIN role r ON r.role_id = a.role_id LEFT JOIN institution i ON i.institution_id = a.institution_id LEFT JOIN campus c ON c.campus_id = a.campus_id
            LEFT JOIN department d ON d.department_id = a.department_id LEFT JOIN programme p ON p.programme_id = a.programme_id WHERE a.user_id = u.user_id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.iam_set_account_status(p_user_id bigint, p_status text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    IF p_status NOT IN ('ACTIVE', 'DISABLED', 'LOCKED') THEN RAISE EXCEPTION 'The status must be ACTIVE, DISABLED or LOCKED' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_reason, '')) > 500 THEN RAISE EXCEPTION 'The reason is limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_status <> 'ACTIVE' AND v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required to disable or lock an account' USING ERRCODE = '22023'; END IF;
    SELECT user_id, account_status INTO v FROM user_account WHERE user_id = p_user_id FOR UPDATE;
    IF v.user_id IS NULL THEN RAISE EXCEPTION 'Unknown user' USING ERRCODE = '22023'; END IF;
    IF v.user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own account status' USING ERRCODE = '45000'; END IF;
    IF v.account_status = p_status THEN RETURN; END IF; -- idempotent replay
    IF p_status <> 'ACTIVE' AND sims_private.other_super_admins(p_user_id) = 0
       AND EXISTS (SELECT 1 FROM user_role_assignment a JOIN role r ON r.role_id = a.role_id WHERE a.user_id = p_user_id AND r.role_code = 'SUPER_ADMIN' AND a.assignment_status = 'ACTIVE') THEN
        RAISE EXCEPTION 'This is the last active super administrator' USING ERRCODE = '45000';
    END IF;
    UPDATE user_account SET account_status = p_status, failed_login_count = CASE WHEN p_status = 'ACTIVE' THEN 0 ELSE failed_login_count END,
        locked_until = CASE WHEN p_status = 'ACTIVE' THEN NULL ELSE locked_until END WHERE user_id = p_user_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, before_values, after_values, details)
    VALUES (sims_private.current_user_id(), 'IAM', 'ACCOUNT_STATUS', 'user_account', p_user_id::text, jsonb_build_object('account_status', v.account_status), jsonb_build_object('account_status', p_status), jsonb_build_object('reason', v_reason));
END $$;

CREATE FUNCTION public.iam_assign_role(p_user_id bigint, p_role_id integer, p_scope_type text, p_scope_entity_id integer DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_id bigint; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    IF length(COALESCE(v_reason, '')) > 500 THEN RAISE EXCEPTION 'The reason is limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_account WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'Unknown user' USING ERRCODE = '22023'; END IF;
    IF p_user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own roles' USING ERRCODE = '45000'; END IF;
    SELECT role_id, role_code, role_level, is_active, is_assignable INTO r FROM role WHERE role_id = p_role_id;
    IF r.role_id IS NULL OR NOT r.is_active OR NOT r.is_assignable THEN RAISE EXCEPTION 'Choose an active, assignable role' USING ERRCODE = '22023'; END IF;
    IF p_scope_type IS DISTINCT FROM r.role_level THEN RAISE EXCEPTION 'A % role must be assigned with % scope', r.role_code, r.role_level USING ERRCODE = '22023'; END IF;
    IF r.role_code = 'SUPER_ADMIN' AND NOT sims_private.caller_has_role('SUPER_ADMIN') THEN RAISE EXCEPTION 'Only a super administrator can grant the SUPER_ADMIN role' USING ERRCODE = '42501'; END IF;
    IF (p_scope_type IN ('GLOBAL', 'SELF')) <> (p_scope_entity_id IS NULL) THEN RAISE EXCEPTION 'The scope entity is required for % scope and not allowed otherwise', p_scope_type USING ERRCODE = '22023'; END IF;
    IF p_scope_type = 'INSTITUTION' AND NOT EXISTS (SELECT 1 FROM institution WHERE institution_id = p_scope_entity_id)
       OR p_scope_type = 'CAMPUS' AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id = p_scope_entity_id)
       OR p_scope_type = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department WHERE department_id = p_scope_entity_id)
       OR p_scope_type = 'PROGRAMME' AND NOT EXISTS (SELECT 1 FROM programme WHERE programme_id = p_scope_entity_id) THEN
        RAISE EXCEPTION 'Unknown scope entity' USING ERRCODE = '22023';
    END IF;
    SELECT a.user_role_assignment_id INTO v_id FROM user_role_assignment a
    WHERE a.user_id = p_user_id AND a.role_id = p_role_id AND a.scope_type = p_scope_type AND a.scope_entity_id = CASE p_scope_type WHEN 'GLOBAL' THEN 0 WHEN 'SELF' THEN p_user_id ELSE p_scope_entity_id END
      AND a.assignment_status = 'ACTIVE' AND (a.valid_to IS NULL OR a.valid_to > now()) LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    INSERT INTO user_role_assignment (user_id, role_id, scope_type, institution_id, campus_id, department_id, programme_id, assigned_by_user_id, assignment_reason)
    VALUES (p_user_id, p_role_id, p_scope_type, CASE WHEN p_scope_type = 'INSTITUTION' THEN p_scope_entity_id END, CASE WHEN p_scope_type = 'CAMPUS' THEN p_scope_entity_id END,
            CASE WHEN p_scope_type = 'DEPARTMENT' THEN p_scope_entity_id END, CASE WHEN p_scope_type = 'PROGRAMME' THEN p_scope_entity_id END, sims_private.current_user_id(), v_reason)
    RETURNING user_role_assignment_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.iam_revoke_role(p_assignment_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_code text;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    SELECT user_role_assignment_id, user_id, role_id, assignment_status, valid_from INTO a FROM user_role_assignment WHERE user_role_assignment_id = p_assignment_id FOR UPDATE;
    IF a.user_role_assignment_id IS NULL THEN RAISE EXCEPTION 'Unknown assignment' USING ERRCODE = '22023'; END IF;
    IF a.user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own roles' USING ERRCODE = '45000'; END IF;
    IF a.assignment_status = 'REVOKED' THEN RETURN; END IF; -- idempotent replay
    SELECT role_code INTO v_code FROM role WHERE role_id = a.role_id;
    IF v_code = 'SUPER_ADMIN' THEN
        IF NOT sims_private.caller_has_role('SUPER_ADMIN') THEN RAISE EXCEPTION 'Only a super administrator can revoke the SUPER_ADMIN role' USING ERRCODE = '42501'; END IF;
        IF sims_private.other_super_admins(a.user_id) = 0 THEN RAISE EXCEPTION 'This is the last active super administrator' USING ERRCODE = '45000'; END IF;
    END IF;
    UPDATE user_role_assignment SET assignment_status = 'REVOKED', valid_to = GREATEST(now(), a.valid_from + interval '1 second'),
        assignment_reason = COALESCE(NULLIF(btrim(p_reason), ''), assignment_reason) WHERE user_role_assignment_id = p_assignment_id;
END $$;

-- ---------------------------------------------------------------
-- Audit viewer (global AUDIT.ALL.READ only)
-- ---------------------------------------------------------------
CREATE FUNCTION public.audit_list(p_module text DEFAULT NULL, p_action text DEFAULT NULL, p_search text DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
                                  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS TABLE (activity_audit_id bigint, activity_at timestamptz, username text, module_code text, action_code text, entity_name text, entity_id text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.activity_audit_id::bigint, a.activity_at, u.username::text, a.module_code::text, a.action_code::text, a.entity_name::text, a.entity_id::text, count(*) OVER ()
    FROM activity_audit a LEFT JOIN user_account u ON u.user_id = a.user_id
    WHERE sims_private.can_global(ARRAY['AUDIT.ALL.READ']::text[])
      AND (p_module IS NULL OR a.module_code = p_module) AND (p_action IS NULL OR a.action_code = p_action)
      AND (p_from IS NULL OR a.activity_at >= p_from) AND (p_to IS NULL OR a.activity_at < p_to)
      AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(COALESCE(a.entity_name, '') || ' ' || COALESCE(a.entity_id, '') || ' ' || COALESCE(u.username, ''))) > 0)
    ORDER BY a.activity_at DESC, a.activity_audit_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.audit_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record;
BEGIN
    IF NOT sims_private.can_global(ARRAY['AUDIT.ALL.READ']::text[]) THEN RAISE EXCEPTION 'Not authorised (AUDIT.ALL.READ)' USING ERRCODE = '42501'; END IF;
    SELECT x.*, u.username INTO a FROM activity_audit x LEFT JOIN user_account u ON u.user_id = x.user_id WHERE x.activity_audit_id = p_id;
    IF a.activity_audit_id IS NULL THEN RAISE EXCEPTION 'Unknown audit entry' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('activity_audit_id', a.activity_audit_id, 'activity_at', a.activity_at, 'username', a.username, 'module_code', a.module_code, 'action_code', a.action_code,
        'entity_name', a.entity_name, 'entity_id', a.entity_id, 'before_values', a.before_values, 'after_values', a.after_values, 'details', a.details);
END $$;

CREATE FUNCTION public.audit_modules() RETURNS TABLE (module_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT DISTINCT a.module_code::text FROM activity_audit a WHERE sims_private.can_global(ARRAY['AUDIT.ALL.READ']::text[]) ORDER BY 1
$$;

REVOKE ALL ON FUNCTION sims_private.caller_has_role(text), sims_private.other_super_admins(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.iam_roles(), public.iam_user_list(text, text, integer, integer), public.iam_user_detail(bigint), public.iam_set_account_status(bigint, text, text),
    public.iam_assign_role(bigint, integer, text, integer, text), public.iam_revoke_role(bigint, text),
    public.audit_list(text, text, text, timestamptz, timestamptz, integer, integer), public.audit_get(bigint), public.audit_modules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iam_roles(), public.iam_user_list(text, text, integer, integer), public.iam_user_detail(bigint), public.iam_set_account_status(bigint, text, text),
    public.iam_assign_role(bigint, integer, text, integer, text), public.iam_revoke_role(bigint, text),
    public.audit_list(text, text, text, timestamptz, timestamptz, integer, integer), public.audit_get(bigint), public.audit_modules() TO authenticated;
