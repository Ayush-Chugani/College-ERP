-- Per-transaction memoisation of the caller's identity and effective permissions. Hand-written (not from the MySQL source). Found by tools/perf/run.ts on a real PostgreSQL (docs/PERFORMANCE_REPORT.md).
--
-- PROBLEM: row level security calls sims_private.can_student / can_employee / ... once PER ROW. Each call resolved the caller's identity (three lookups) and their effective permissions (a multi-join view over
-- roles, role permissions, overrides and delegations) again. With 20,000 students a registrar's student list did not finish in 20 seconds.
-- FIX: the answers cannot change inside one transaction in any way the policies rely on (a PostgREST request is one transaction), so they are computed once per transaction and kept in a transaction-local
-- setting (set_config(..., is_local => true)). The setting disappears when the transaction ends, so a role change, a disabled account or an expired grant takes effect on the very next request. Keys carry the
-- auth user, the MFA assurance level and the permission codes asked for, so one caller can never read another caller's entry. The functions return exactly what they returned before.
--
-- LIMITS (KNOWN_ISSUES KI-61): inside ONE transaction a permission change is not seen by later checks of the same user; RPCs that change permissions (iam_assign_role ...) never rely on the changed user's own
-- checks in the same transaction. Do not add such a dependency.

CREATE OR REPLACE FUNCTION sims_private.current_user_id() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text; v_hit text; v_id bigint;
BEGIN
    v_key := 'sims.uid_' || md5(COALESCE(auth.uid()::text, '') || '|' || sims_private.jwt_aal());
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN RETURN NULLIF(v_hit, '-')::bigint; END IF;
    SELECT m.user_id INTO v_id
    FROM sims_private.auth_identity_map m
    JOIN public.user_account u ON u.user_id = m.user_id
    WHERE m.auth_user_id = auth.uid()
      AND u.account_status = 'ACTIVE'
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (NOT u.multi_factor_enabled OR sims_private.jwt_aal() = 'aal2');
    PERFORM set_config(v_key, COALESCE(v_id::text, '-'), true);
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION sims_private.current_student_id() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text; v_hit text; v_id bigint; v_uid bigint := sims_private.current_user_id();
BEGIN
    IF v_uid IS NULL THEN RETURN NULL; END IF;
    v_key := 'sims.stu_' || v_uid;
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN RETURN NULLIF(v_hit, '-')::bigint; END IF;
    SELECT s.student_id INTO v_id FROM public.student_user_account s WHERE s.user_id = v_uid;
    PERFORM set_config(v_key, COALESCE(v_id::text, '-'), true);
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION sims_private.current_employee_id() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text; v_hit text; v_id bigint; v_uid bigint := sims_private.current_user_id();
BEGIN
    IF v_uid IS NULL THEN RETURN NULL; END IF;
    v_key := 'sims.emp_' || v_uid;
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN RETURN NULLIF(v_hit, '-')::bigint; END IF;
    SELECT e.employee_id INTO v_id FROM public.employee_user_account e WHERE e.user_id = v_uid;
    PERFORM set_config(v_key, COALESCE(v_id::text, '-'), true);
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION sims_private.eff(p_codes text[]) RETURNS TABLE (scope_type text, scope_entity_id bigint, permission_effect text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); v_key text; v_hit text; v_json jsonb;
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;
    v_key := 'sims.eff_' || md5(v_uid::text || '|' || array_to_string(p_codes, ','));
    v_hit := current_setting(v_key, true);
    IF v_hit IS NULL OR v_hit = '' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_array(v.scope_type, v.scope_entity_id, v.permission_effect)), '[]'::jsonb) INTO v_json
        FROM public.v_effective_user_permission v WHERE v.user_id = v_uid AND v.permission_code = ANY (p_codes);
        v_hit := v_json::text;
        PERFORM set_config(v_key, v_hit, true);
    END IF;
    RETURN QUERY SELECT x ->> 0, (x ->> 1)::bigint, x ->> 2 FROM jsonb_array_elements(v_hit::jsonb) x;
END $$;

-- ---------------------------------------------------------------
-- Decoded permission set (no JSON parsing per row) and flatter can_* functions
-- ---------------------------------------------------------------
-- The caller's effective rows for a set of permission codes, folded into what covers() needs: per scope level the ids that are ALLOWed and the ids that are DENYed (a GLOBAL row has no id).
CREATE TYPE sims_private.eff_set AS (ga boolean, gd boolean, sa boolean, sd boolean, ai bigint[], di bigint[], ac bigint[], dc bigint[], ad bigint[], dd bigint[], ap bigint[], dp bigint[]);

CREATE FUNCTION sims_private.eff_set_of(p_codes text[]) RETURNS sims_private.eff_set
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); v_key text; v_hit text; v sims_private.eff_set;
BEGIN
    IF v_uid IS NULL THEN RETURN ROW(false, false, false, false, '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}')::sims_private.eff_set; END IF;
    v_key := 'sims.set_' || md5(v_uid::text || '|' || array_to_string(p_codes, ','));
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN RETURN v_hit::sims_private.eff_set; END IF;
    v := (SELECT ROW(
        COALESCE(bool_or(x.scope_type = 'GLOBAL' AND x.permission_effect = 'ALLOW'), false), COALESCE(bool_or(x.scope_type = 'GLOBAL' AND x.permission_effect = 'DENY'), false),
        COALESCE(bool_or(x.scope_type = 'SELF' AND x.permission_effect = 'ALLOW'), false), COALESCE(bool_or(x.scope_type = 'SELF' AND x.permission_effect = 'DENY'), false),
        COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'INSTITUTION' AND x.permission_effect = 'ALLOW'), '{}'), COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'INSTITUTION' AND x.permission_effect = 'DENY'), '{}'),
        COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'CAMPUS' AND x.permission_effect = 'ALLOW'), '{}'), COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'CAMPUS' AND x.permission_effect = 'DENY'), '{}'),
        COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'DEPARTMENT' AND x.permission_effect = 'ALLOW'), '{}'), COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'DEPARTMENT' AND x.permission_effect = 'DENY'), '{}'),
        COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'PROGRAMME' AND x.permission_effect = 'ALLOW'), '{}'), COALESCE(array_agg(x.scope_entity_id) FILTER (WHERE x.scope_type = 'PROGRAMME' AND x.permission_effect = 'DENY'), '{}')
    )::sims_private.eff_set
    FROM public.v_effective_user_permission x WHERE x.user_id = v_uid AND x.permission_code = ANY (p_codes));
    PERFORM set_config(v_key, v::text, true);
    RETURN v;
END $$;

-- Same truth table as before: allowed when some matching row ALLOWs and no matching row DENYs.
CREATE OR REPLACE FUNCTION sims_private.covers(p_codes text[], p_inst bigint, p_campus bigint, p_dept bigint, p_prog bigint, p_self_ok boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sims_private.eff_set := sims_private.eff_set_of(p_codes);
BEGIN
    RETURN (s.ga OR (p_self_ok AND s.sa) OR COALESCE(p_inst = ANY (s.ai), false) OR COALESCE(p_campus = ANY (s.ac), false) OR COALESCE(p_dept = ANY (s.ad), false) OR COALESCE(p_prog = ANY (s.ap), false))
       AND NOT (s.gd OR (p_self_ok AND s.sd) OR COALESCE(p_inst = ANY (s.di), false) OR COALESCE(p_campus = ANY (s.dc), false) OR COALESCE(p_dept = ANY (s.dd), false) OR COALESCE(p_prog = ANY (s.dp), false));
END $$;

CREATE OR REPLACE FUNCTION sims_private.can_student(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sims_private.eff_set := sims_private.eff_set_of(p_codes); r record;
BEGIN
    IF s.ga AND NOT s.gd THEN RETURN true; END IF;                                            -- can_global
    IF NOT p_write AND p_id IS NOT NULL AND (s.ga OR s.sa) AND NOT (s.gd OR s.sd) AND p_id = sims_private.current_student_id() THEN RETURN true; END IF; -- own record (SELF scope)
    IF NOT s.ga AND cardinality(s.ai) + cardinality(s.ac) + cardinality(s.ad) + cardinality(s.ap) = 0 THEN RETURN false; END IF;     -- no scoped grant at all: nothing to look up
    FOR r IN SELECT c.institution_id::bigint AS i, c.campus_id::bigint AS cm, d.department_id::bigint AS dp, p.programme_id::bigint AS pr
             FROM public.student_programme_enrolment e JOIN public.programme p ON p.programme_id = e.programme_id JOIN public.department d ON d.department_id = p.department_id JOIN public.campus c ON c.campus_id = d.campus_id
             WHERE e.student_id = p_id LOOP
        IF (s.ga OR r.i = ANY (s.ai) OR r.cm = ANY (s.ac) OR r.dp = ANY (s.ad) OR r.pr = ANY (s.ap))
           AND NOT (s.gd OR r.i = ANY (s.di) OR r.cm = ANY (s.dc) OR r.dp = ANY (s.dd) OR r.pr = ANY (s.dp)) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
END $$;

CREATE OR REPLACE FUNCTION sims_private.can_employee(p_codes text[], p_id bigint, p_write boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sims_private.eff_set := sims_private.eff_set_of(p_codes); r record;
BEGIN
    IF s.ga AND NOT s.gd THEN RETURN true; END IF;
    IF NOT p_write AND p_id IS NOT NULL AND (s.ga OR s.sa) AND NOT (s.gd OR s.sd) AND p_id = sims_private.current_employee_id() THEN RETURN true; END IF;
    IF NOT s.ga AND cardinality(s.ai) + cardinality(s.ac) + cardinality(s.ad) + cardinality(s.ap) = 0 THEN RETURN false; END IF;
    FOR r IN SELECT e.institution_id::bigint AS i FROM public.employee e WHERE e.employee_id = p_id LOOP                       -- institution scope of the employee record
        IF (s.ga OR r.i = ANY (s.ai)) AND NOT (s.gd OR r.i = ANY (s.di)) THEN RETURN true; END IF;
    END LOOP;
    FOR r IN SELECT c.institution_id::bigint AS i, c.campus_id::bigint AS cm, a.department_id::bigint AS dp                    -- scope through a current assignment
             FROM public.employee_assignment a JOIN public.campus c ON c.campus_id = a.campus_id WHERE a.employee_id = p_id AND a.end_date IS NULL LOOP
        IF (s.ga OR r.i = ANY (s.ai) OR r.cm = ANY (s.ac) OR r.dp = ANY (s.ad)) AND NOT (s.gd OR r.i = ANY (s.di) OR r.cm = ANY (s.dc) OR r.dp = ANY (s.dd)) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
END $$;

REVOKE ALL ON FUNCTION sims_private.eff_set_of(text[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- Cheaper review queues and activity lists (found by tools/perf/run.ts). In the lists an optional filter on a small lookup table made the generic plan scan the big table once per lookup row;
-- the filter is now resolved to an id once (scalar subquery) and applied to the big table.
-- ---------------------------------------------------------------
-- True when the caller holds at least one grant (ALLOW or DENY at any level) for the codes. A review queue is only worth counting row by row when it is.
CREATE FUNCTION sims_private.has_any_grant(p_codes text[]) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sims_private.eff_set := sims_private.eff_set_of(p_codes);
BEGIN
    RETURN s.ga OR s.sa OR cardinality(s.ai) + cardinality(s.ac) + cardinality(s.ad) + cardinality(s.ap) > 0;
END $$;
REVOKE ALL ON FUNCTION sims_private.has_any_grant(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sims_private.notifications_all() RETURNS TABLE (notif_key text, kind text, title text, body text, href text, at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); v_stu bigint := sims_private.current_student_id(); v_emp bigint := sims_private.current_employee_id(); n bigint;
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT 'ann:' || f.announcement_id, 'ANNOUNCEMENT', f.title, left(f.description, 200), '/announcements/' || f.announcement_id, f.publish_from
                 FROM public.announcements_feed(30) f WHERE f.publish_from > now() - interval '14 days';
    IF v_stu IS NOT NULL THEN
        RETURN QUERY SELECT 'doc:' || d.student_document_id || ':' || d.verification_status, 'DOCUMENT', 'Your ' || lower(t.document_name) || ' was ' || lower(d.verification_status), COALESCE(d.remarks, '')::text, '/my-documents', d.verified_at
                     FROM student_document d JOIN document_type t ON t.document_type_id = d.document_type_id
                     WHERE d.student_id = v_stu AND d.verification_status IN ('VERIFIED', 'REJECTED') AND d.verified_at > now() - interval '30 days';
        RETURN QUERY SELECT 'act:' || a.student_activity_id || ':' || aps.status_code || ':' || vs.status_code, 'ACTIVITY',
                            CASE WHEN vs.status_code = 'NEEDS_CORRECTION' THEN 'Your activity needs correction' WHEN aps.status_code = 'APPROVED' THEN 'Your activity was approved' ELSE 'Your activity was rejected' END,
                            a.activity_title::text, '/activities/' || a.student_activity_id, a.updated_at
                     FROM student_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id
                     WHERE a.student_id = v_stu AND a.deleted_at IS NULL AND a.updated_at > now() - interval '30 days' AND (aps.status_code IN ('APPROVED', 'REJECTED') OR vs.status_code = 'NEEDS_CORRECTION');
        RETURN QUERY SELECT 'grv:' || g.grievance_id || ':' || g.status, 'GRIEVANCE', 'Your grievance is ' || lower(replace(g.status, '_', ' ')), g.subject::text, '/grievances/' || g.grievance_id,
                            (SELECT max(ga.action_at) FROM grievance_action ga WHERE ga.grievance_id = g.grievance_id)
                     FROM grievance g WHERE g.student_id = v_stu AND g.status IN ('ASSIGNED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')
                       AND (SELECT max(ga.action_at) FROM grievance_action ga WHERE ga.grievance_id = g.grievance_id) > now() - interval '30 days';
    END IF;
    IF v_emp IS NOT NULL THEN
        RETURN QUERY SELECT 'staff:' || a.staff_activity_id || ':' || aps.status_code || ':' || vs.status_code, 'STAFF_RECORD',
                            CASE WHEN vs.status_code = 'NEEDS_CORRECTION' THEN 'Your record needs correction' WHEN aps.status_code = 'APPROVED' THEN 'Your record was approved' ELSE 'Your record was rejected' END,
                            a.activity_title::text, '/staff-profile/' || a.staff_activity_id, a.updated_at
                     FROM staff_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id
                     WHERE a.employee_id = v_emp AND a.deleted_at IS NULL AND a.updated_at > now() - interval '30 days' AND (aps.status_code IN ('APPROVED', 'REJECTED') OR vs.status_code = 'NEEDS_CORRECTION');
    END IF;
    -- review queues (counts; the key carries the count so a growing queue shows up again after being dismissed)
    IF sims_private.has_any_grant(ARRAY['STUDENT.STUDENT_ACTIVITY.VERIFY']::text[]) THEN
        SELECT count(*) INTO n FROM student_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND aps.status_code = 'SUBMITTED' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.VERIFY']::text[], a.student_id, true);
    ELSE n := 0; END IF;
    IF n > 0 THEN RETURN QUERY SELECT 'task:act-verify:' || n, 'TASK', n || ' student ' || CASE WHEN n = 1 THEN 'activity awaits' ELSE 'activities await' END || ' verification', ''::text, '/activities?status=SUBMITTED', now(); END IF;
    IF sims_private.has_any_grant(ARRAY['STUDENT.STUDENT_ACTIVITY.APPROVE']::text[]) THEN
        SELECT count(*) INTO n FROM student_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND aps.status_code = 'UNDER_REVIEW' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.APPROVE']::text[], a.student_id, true);
    ELSE n := 0; END IF;
    IF n > 0 THEN RETURN QUERY SELECT 'task:act-approve:' || n, 'TASK', n || ' student ' || CASE WHEN n = 1 THEN 'activity awaits' ELSE 'activities await' END || ' approval', ''::text, '/activities?status=UNDER_REVIEW', now(); END IF;
    IF sims_private.has_any_grant(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.VERIFY']::text[]) THEN
        SELECT count(*) INTO n FROM staff_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND aps.status_code = 'SUBMITTED' AND a.employee_id IS DISTINCT FROM v_emp AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.VERIFY']::text[], a.employee_id, true);
    ELSE n := 0; END IF;
    IF n > 0 THEN RETURN QUERY SELECT 'task:staff-verify:' || n, 'TASK', n || ' staff ' || CASE WHEN n = 1 THEN 'record awaits' ELSE 'records await' END || ' verification', ''::text, '/staff-profile?status=SUBMITTED', now(); END IF;
    IF sims_private.has_any_grant(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.APPROVE']::text[]) THEN
        SELECT count(*) INTO n FROM staff_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND aps.status_code = 'UNDER_REVIEW' AND a.employee_id IS DISTINCT FROM v_emp AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.APPROVE']::text[], a.employee_id, true);
    ELSE n := 0; END IF;
    IF n > 0 THEN RETURN QUERY SELECT 'task:staff-approve:' || n, 'TASK', n || ' staff ' || CASE WHEN n = 1 THEN 'record awaits' ELSE 'records await' END || ' approval', ''::text, '/staff-profile?status=UNDER_REVIEW', now(); END IF;
    IF sims_private.has_any_grant(ARRAY['GRIEVANCE.ALL.UPDATE']::text[]) THEN
        SELECT count(*) INTO n FROM grievance g WHERE g.status = 'SUBMITTED' AND sims_private.can_student(ARRAY['GRIEVANCE.ALL.UPDATE']::text[], g.student_id, true);
    ELSE n := 0; END IF;
    IF n > 0 THEN RETURN QUERY SELECT 'task:grv:' || n, 'TASK', n || ' new ' || CASE WHEN n = 1 THEN 'grievance awaits' ELSE 'grievances await' END || ' attention', ''::text, '/grievances?status=SUBMITTED', now(); END IF;
END $$;


CREATE OR REPLACE FUNCTION public.student_activity_list(p_student_id bigint DEFAULT NULL, p_search text DEFAULT NULL, p_approval text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (student_activity_id bigint, student_id bigint, student_number text, student_name text, type_name text, activity_title text, achievement_type text, start_date date, verification_status text, approval_status text, evidence_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT pg.student_activity_id::bigint, pg.student_id::bigint, pg.student_number, pg.student_name, pg.type_name, pg.activity_title, pg.achievement_type, pg.start_date, pg.verification_status, pg.approval_status,
           (SELECT count(*) FROM student_activity_evidence ev WHERE ev.student_activity_id = pg.student_activity_id AND ev.deleted_at IS NULL), pg.total_count
    FROM (
        SELECT v.*, count(*) OVER () AS total_count FROM (
            SELECT a.student_activity_id, a.student_id, s.student_number::text, s.display_name::text AS student_name, t.type_name::text, a.activity_title::text, a.achievement_type::text, a.start_date,
                   vs.status_code::text AS verification_status, aps.status_code::text AS approval_status, a.created_at
            FROM student_activity a JOIN student s ON s.student_id = a.student_id JOIN student_activity_type t ON t.student_activity_type_id = a.student_activity_type_id
            JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND (p_student_id IS NULL OR a.student_id = p_student_id)
              AND (p_approval IS NULL OR a.approval_status_id = (SELECT x.approval_status_id FROM approval_status x WHERE x.status_code = p_approval))
              AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(a.activity_title || ' ' || s.display_name || ' ' || s.student_number)) > 0)
              AND (COALESCE(a.student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.READ']::text[], a.student_id, false))
        ) v
        ORDER BY v.created_at DESC, v.student_activity_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
    ) pg
    ORDER BY pg.created_at DESC, pg.student_activity_id DESC
$$;

CREATE OR REPLACE FUNCTION public.staff_activity_list(p_employee_id bigint DEFAULT NULL, p_search text DEFAULT NULL, p_approval text DEFAULT NULL, p_group text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (staff_activity_id bigint, employee_id bigint, employee_number text, staff_name text, type_name text, activity_group text, activity_title text, start_date date, verification_status text, approval_status text, evidence_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT pg.staff_activity_id::bigint, pg.employee_id::bigint, pg.employee_number, pg.staff_name, pg.type_name, pg.activity_group, pg.activity_title, pg.start_date, pg.verification_status, pg.approval_status,
           (SELECT count(*) FROM evidence_document ev WHERE ev.staff_activity_id = pg.staff_activity_id AND ev.deleted_at IS NULL), pg.total_count
    FROM (
        SELECT v.*, count(*) OVER () AS total_count FROM (
            SELECT a.staff_activity_id, a.employee_id, e.employee_number::text, e.display_name::text AS staff_name, t.activity_type_name::text AS type_name, t.activity_group::text, a.activity_title::text, a.start_date,
                   vs.status_code::text AS verification_status, aps.status_code::text AS approval_status, a.created_at
            FROM staff_activity a JOIN employee e ON e.employee_id = a.employee_id JOIN activity_type t ON t.activity_type_id = a.activity_type_id
            JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
            WHERE a.deleted_at IS NULL AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
              AND (p_approval IS NULL OR a.approval_status_id = (SELECT x.approval_status_id FROM approval_status x WHERE x.status_code = p_approval))
              AND (p_group IS NULL OR a.activity_type_id IN (SELECT y.activity_type_id FROM activity_type y WHERE y.activity_group = p_group))
              AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(a.activity_title || ' ' || e.display_name || ' ' || e.employee_number)) > 0)
              AND (COALESCE(a.employee_id = sims_private.current_employee_id(), false) OR sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.READ']::text[], a.employee_id, false))
        ) v
        ORDER BY v.created_at DESC, v.staff_activity_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
    ) pg
    ORDER BY pg.created_at DESC, pg.staff_activity_id DESC
$$;


-- ---------------------------------------------------------------
-- Indexes for the lists that sort by time (audit viewer, sign-in log): without them every page sorts the whole table.
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_audit_at ON activity_audit (activity_at DESC, activity_audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_audit_module_at ON activity_audit (module_code, activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_at ON login_audit (login_at DESC, login_audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_name_at ON login_audit (lower(username_attempted), login_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_activity_created ON student_activity (created_at DESC, student_activity_id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_activity_created ON staff_activity (created_at DESC, staff_activity_id DESC) WHERE deleted_at IS NULL;
