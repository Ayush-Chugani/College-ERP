-- Account features: MFA enforcement, login audit, self-service profile, notifications, global search. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * MFA: Supabase Auth owns the factors (TOTP). The database enforces them: once user_account.multi_factor_enabled is set (only mfa_sync() sets it, from the verified factors in auth.mfa_factors, never from a
--    client claim) sims_private.current_user_id() resolves an identity only for sessions whose JWT says aal2. A password-only session therefore sees nothing until the TOTP code is verified.
--  * login_audit is written by RPCs only (clients have no write grant). Failures can be reported by anonymous callers, so they are throttled and never change user_account.
--  * Notifications are computed from live data (no stored notification rows); only dismissals are stored, in sims_private.
--  * global_search() is SECURITY INVOKER, so row level security decides what each caller finds.
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-57):
--  1  A session counts as MFA-verified when request.jwt.claims has aal = 'aal2'. Users without a verified TOTP factor are unaffected.
--  2  Failed logins are kept per attempted name: at most 20 per name and 5000 in total per hour are stored; beyond that they are dropped silently.
--  3  Self-service profile editing covers primary_email and primary_phone of the caller's own student or employee record only.
--  4  Notification sources: announcements published in the last 14 days; own document, activity, staff-record and grievance decisions of the last 30 days; review queues (counts) for reviewers.

-- ---------------------------------------------------------------
-- MFA
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.jwt_aal() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(CASE WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NULL THEN NULL
                         ELSE NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal' END, 'aal1')
$$;

CREATE OR REPLACE FUNCTION sims_private.current_user_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT m.user_id
    FROM sims_private.auth_identity_map m
    JOIN public.user_account u ON u.user_id = m.user_id
    WHERE m.auth_user_id = auth.uid()
      AND u.account_status = 'ACTIVE'
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (NOT u.multi_factor_enabled OR sims_private.jwt_aal() = 'aal2')
$$;

-- Mirrors "has a verified factor" into user_account.multi_factor_enabled. Takes no argument on purpose: a client can neither switch enforcement off nor lock itself out.
CREATE FUNCTION public.mfa_sync() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); v_has boolean;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified') INTO v_has;
    UPDATE user_account SET multi_factor_enabled = v_has WHERE user_id = v_uid AND multi_factor_enabled IS DISTINCT FROM v_has;
    RETURN v_has;
END $$;

-- ---------------------------------------------------------------
-- Login audit
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.request_header(p_name text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN NULLIF(btrim(current_setting('request.headers', true)::jsonb ->> p_name), '');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END $$;

CREATE FUNCTION public.auth_login_record() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); v_name text; v_id bigint;
BEGIN
    IF v_uid IS NULL THEN RETURN NULL; END IF;
    SELECT username INTO v_name FROM user_account WHERE user_id = v_uid;
    INSERT INTO login_audit (user_id, username_attempted, was_successful, ip_address, user_agent)
    VALUES (v_uid, v_name, true, left(split_part(COALESCE(sims_private.request_header('x-forwarded-for'), ''), ',', 1), 45), left(sims_private.request_header('user-agent'), 500)) RETURNING login_audit_id INTO v_id;
    UPDATE user_account SET last_login_at = now(), failed_login_count = 0 WHERE user_id = v_uid;
    RETURN v_id;
END $$;

CREATE FUNCTION public.auth_logout_record() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id();
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;
    UPDATE login_audit SET logout_at = now()
    WHERE login_audit_id = (SELECT max(login_audit_id) FROM login_audit WHERE user_id = v_uid AND was_successful AND logout_at IS NULL);
END $$;

-- Anyone may report a failed sign-in (there is no session yet). The reason is mapped to a fixed list; volume is capped.
CREATE FUNCTION public.auth_failure_record(p_username text, p_reason text DEFAULT 'INVALID_CREDENTIALS') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text := left(btrim(regexp_replace(COALESCE(p_username, ''), '[[:cntrl:]]', '', 'g')), 100); v_reason text; v_uid bigint;
BEGIN
    IF v_name = '' THEN RETURN; END IF;
    v_reason := CASE WHEN p_reason IN ('INVALID_CREDENTIALS', 'EMAIL_NOT_CONFIRMED', 'MFA_FAILED') THEN p_reason ELSE 'OTHER' END;
    IF (SELECT count(*) FROM login_audit WHERE NOT was_successful AND login_at > now() - interval '1 hour') >= 5000 THEN RETURN; END IF;
    IF (SELECT count(*) FROM login_audit WHERE NOT was_successful AND lower(username_attempted) = lower(v_name) AND login_at > now() - interval '1 hour') >= 20 THEN RETURN; END IF;
    SELECT user_id INTO v_uid FROM user_account WHERE lower(email) = lower(v_name) OR lower(username) = lower(v_name) LIMIT 1;
    INSERT INTO login_audit (user_id, username_attempted, was_successful, failure_reason, ip_address, user_agent)
    VALUES (v_uid, v_name, false, v_reason, left(split_part(COALESCE(sims_private.request_header('x-forwarded-for'), ''), ',', 1), 45), left(sims_private.request_header('user-agent'), 500));
END $$;

CREATE FUNCTION public.my_recent_logins(p_limit integer DEFAULT 10) RETURNS TABLE (login_at timestamptz, logout_at timestamptz, was_successful boolean, failure_reason text, ip_address text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT l.login_at, l.logout_at, l.was_successful, l.failure_reason::text, l.ip_address::text FROM login_audit l
    WHERE l.user_id = sims_private.current_user_id() ORDER BY l.login_at DESC, l.login_audit_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50)
$$;

CREATE FUNCTION public.login_audit_list(p_search text DEFAULT NULL, p_success boolean DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS TABLE (login_audit_id bigint, login_at timestamptz, logout_at timestamptz, username_attempted text, username text, was_successful boolean, failure_reason text, ip_address text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT l.login_audit_id::bigint, l.login_at, l.logout_at, l.username_attempted::text, u.username::text, l.was_successful, l.failure_reason::text, l.ip_address::text, count(*) OVER ()
    FROM login_audit l LEFT JOIN user_account u ON u.user_id = l.user_id
    WHERE sims_private.can_global(ARRAY['AUDIT.ALL.READ']::text[]) AND (p_success IS NULL OR l.was_successful = p_success)
      AND (p_from IS NULL OR l.login_at >= p_from) AND (p_to IS NULL OR l.login_at < p_to)
      AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(l.username_attempted || ' ' || COALESCE(l.ip_address, ''))) > 0)
    ORDER BY l.login_at DESC, l.login_audit_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- ---------------------------------------------------------------
-- Self-service profile
-- ---------------------------------------------------------------
CREATE FUNCTION public.my_profile() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(
        (SELECT jsonb_build_object('kind', 'student', 'name', s.display_name, 'number', s.student_number, 'primary_email', s.primary_email, 'primary_phone', s.primary_phone) FROM student s WHERE s.student_id = sims_private.current_student_id()),
        (SELECT jsonb_build_object('kind', 'employee', 'name', e.display_name, 'number', e.employee_number, 'primary_email', e.primary_email, 'primary_phone', e.primary_phone) FROM employee e WHERE e.employee_id = sims_private.current_employee_id()),
        jsonb_build_object('kind', 'none'))
$$;

-- p may hold primary_email and primary_phone; an empty string clears the value. Anything else is rejected.
CREATE FUNCTION public.my_profile_update(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint := sims_private.current_student_id(); v_employee bigint := sims_private.current_employee_id(); v_bad text;
        v_has_email boolean; v_has_phone boolean; v_email text; v_phone text;
BEGIN
    IF v_student IS NULL AND v_employee IS NULL THEN RAISE EXCEPTION 'Only students and employees have a profile to edit' USING ERRCODE = '42501'; END IF;
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'p must be an object' USING ERRCODE = '22023'; END IF;
    SELECT string_agg(k, ', ') INTO v_bad FROM jsonb_object_keys(p) k WHERE k NOT IN ('primary_email', 'primary_phone');
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'These fields cannot be changed here: %', v_bad USING ERRCODE = '22023'; END IF;
    v_has_email := p ? 'primary_email'; v_has_phone := p ? 'primary_phone';
    v_email := lower(NULLIF(btrim(p ->> 'primary_email'), '')); v_phone := NULLIF(btrim(p ->> 'primary_phone'), '');
    IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023'; END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{6,25}$' THEN RAISE EXCEPTION 'Enter a valid phone number (digits, spaces, + ( ) - only)' USING ERRCODE = '22023'; END IF;
    BEGIN
        IF v_student IS NOT NULL THEN
            UPDATE student SET primary_email = CASE WHEN v_has_email THEN v_email ELSE primary_email END, primary_phone = CASE WHEN v_has_phone THEN v_phone ELSE primary_phone END WHERE student_id = v_student;
        ELSE
            UPDATE employee SET primary_email = CASE WHEN v_has_email THEN v_email ELSE primary_email END, primary_phone = CASE WHEN v_has_phone THEN v_phone ELSE primary_phone END WHERE employee_id = v_employee;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'That email address is already used by another record' USING ERRCODE = '23505';
    END;
END $$;

-- ---------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------
CREATE TABLE sims_private.notification_dismissal (
    user_id bigint NOT NULL,
    notif_key text NOT NULL,
    dismissed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notif_key)
);
REVOKE ALL ON sims_private.notification_dismissal FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sims_private.notifications_all() RETURNS TABLE (notif_key text, kind text, title text, body text, href text, at timestamptz)
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
    SELECT count(*) INTO n FROM student_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND aps.status_code = 'SUBMITTED' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.VERIFY']::text[], a.student_id, true);
    IF n > 0 THEN RETURN QUERY SELECT 'task:act-verify:' || n, 'TASK', n || ' student ' || CASE WHEN n = 1 THEN 'activity awaits' ELSE 'activities await' END || ' verification', ''::text, '/activities?status=SUBMITTED', now(); END IF;
    SELECT count(*) INTO n FROM student_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND aps.status_code = 'UNDER_REVIEW' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.APPROVE']::text[], a.student_id, true);
    IF n > 0 THEN RETURN QUERY SELECT 'task:act-approve:' || n, 'TASK', n || ' student ' || CASE WHEN n = 1 THEN 'activity awaits' ELSE 'activities await' END || ' approval', ''::text, '/activities?status=UNDER_REVIEW', now(); END IF;
    SELECT count(*) INTO n FROM staff_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND aps.status_code = 'SUBMITTED' AND a.employee_id IS DISTINCT FROM v_emp AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.VERIFY']::text[], a.employee_id, true);
    IF n > 0 THEN RETURN QUERY SELECT 'task:staff-verify:' || n, 'TASK', n || ' staff ' || CASE WHEN n = 1 THEN 'record awaits' ELSE 'records await' END || ' verification', ''::text, '/staff-profile?status=SUBMITTED', now(); END IF;
    SELECT count(*) INTO n FROM staff_activity a JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND aps.status_code = 'UNDER_REVIEW' AND a.employee_id IS DISTINCT FROM v_emp AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.APPROVE']::text[], a.employee_id, true);
    IF n > 0 THEN RETURN QUERY SELECT 'task:staff-approve:' || n, 'TASK', n || ' staff ' || CASE WHEN n = 1 THEN 'record awaits' ELSE 'records await' END || ' approval', ''::text, '/staff-profile?status=UNDER_REVIEW', now(); END IF;
    SELECT count(*) INTO n FROM grievance g WHERE g.status = 'SUBMITTED' AND sims_private.can_student(ARRAY['GRIEVANCE.ALL.UPDATE']::text[], g.student_id, true);
    IF n > 0 THEN RETURN QUERY SELECT 'task:grv:' || n, 'TASK', n || ' new ' || CASE WHEN n = 1 THEN 'grievance awaits' ELSE 'grievances await' END || ' attention', ''::text, '/grievances?status=SUBMITTED', now(); END IF;
END $$;

CREATE FUNCTION public.my_notifications(p_limit integer DEFAULT 50) RETURNS TABLE (notif_key text, kind text, title text, body text, href text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT n.notif_key, n.kind, n.title, n.body, n.href, n.at FROM sims_private.notifications_all() n
    WHERE NOT EXISTS (SELECT 1 FROM sims_private.notification_dismissal d WHERE d.user_id = sims_private.current_user_id() AND d.notif_key = n.notif_key)
    ORDER BY n.at DESC NULLS LAST, n.notif_key LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

CREATE FUNCTION public.my_notification_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT count(*)::integer FROM sims_private.notifications_all() n
    WHERE NOT EXISTS (SELECT 1 FROM sims_private.notification_dismissal d WHERE d.user_id = sims_private.current_user_id() AND d.notif_key = n.notif_key)
$$;

CREATE FUNCTION public.notification_dismiss(p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    IF p_key IS NULL OR btrim(p_key) = '' OR length(p_key) > 200 THEN RAISE EXCEPTION 'Invalid notification' USING ERRCODE = '22023'; END IF;
    INSERT INTO sims_private.notification_dismissal (user_id, notif_key) VALUES (v_uid, p_key) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION public.notification_dismiss_all() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid bigint := sims_private.current_user_id(); n integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    INSERT INTO sims_private.notification_dismissal (user_id, notif_key) SELECT v_uid, a.notif_key FROM sims_private.notifications_all() a ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM sims_private.notification_dismissal WHERE user_id = v_uid AND dismissed_at < now() - interval '90 days';
    RETURN n;
END $$;

-- ---------------------------------------------------------------
-- Global search (SECURITY INVOKER: row level security decides what is found)
-- ---------------------------------------------------------------
CREATE FUNCTION public.global_search(p_q text, p_limit integer DEFAULT 8) RETURNS TABLE (kind text, id bigint, title text, subtitle text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
    WITH q AS (SELECT '%' || replace(replace(replace(lower(btrim(COALESCE(p_q, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat, length(btrim(COALESCE(p_q, ''))) AS n, LEAST(GREATEST(p_limit, 1), 25) AS lim)
    SELECT * FROM (
        (SELECT 'student'::text, s.student_id::bigint, s.display_name::text, s.student_number::text FROM student s, q WHERE q.n >= 2 AND (lower(s.display_name) LIKE q.pat OR lower(s.student_number) LIKE q.pat) ORDER BY s.display_name LIMIT (SELECT lim FROM q))
        UNION ALL
        (SELECT 'employee'::text, e.employee_id::bigint, e.display_name::text, e.employee_number::text FROM employee e, q WHERE q.n >= 2 AND (lower(e.display_name) LIKE q.pat OR lower(e.employee_number) LIKE q.pat) ORDER BY e.display_name LIMIT (SELECT lim FROM q))
        UNION ALL
        (SELECT 'course'::text, c.course_id::bigint, c.course_title::text, c.course_code::text FROM course_catalog c, q WHERE q.n >= 2 AND (lower(c.course_title) LIKE q.pat OR lower(c.course_code) LIKE q.pat) ORDER BY c.course_title LIMIT (SELECT lim FROM q))
        UNION ALL
        (SELECT 'programme'::text, p.programme_id::bigint, p.programme_name::text, p.programme_code::text FROM programme p, q WHERE q.n >= 2 AND (lower(p.programme_name) LIKE q.pat OR lower(p.programme_code) LIKE q.pat) ORDER BY p.programme_name LIMIT (SELECT lim FROM q))
        UNION ALL
        (SELECT 'department'::text, d.department_id::bigint, d.department_name::text, d.department_code::text FROM department d, q WHERE q.n >= 2 AND (lower(d.department_name) LIKE q.pat OR lower(d.department_code) LIKE q.pat) ORDER BY d.department_name LIMIT (SELECT lim FROM q))
    ) r
$$;

REVOKE ALL ON FUNCTION sims_private.jwt_aal(), sims_private.request_header(text), sims_private.notifications_all() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mfa_sync(), public.auth_login_record(), public.auth_logout_record(), public.my_recent_logins(integer), public.login_audit_list(text, boolean, timestamptz, timestamptz, integer, integer),
    public.my_profile(), public.my_profile_update(jsonb), public.my_notifications(integer), public.my_notification_count(), public.notification_dismiss(text), public.notification_dismiss_all(), public.global_search(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_failure_record(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_sync(), public.auth_login_record(), public.auth_logout_record(), public.my_recent_logins(integer), public.login_audit_list(text, boolean, timestamptz, timestamptz, integer, integer),
    public.my_profile(), public.my_profile_update(jsonb), public.my_notifications(integer), public.my_notification_count(), public.notification_dismiss(text), public.notification_dismiss_all(), public.global_search(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_failure_record(text, text) TO anon, authenticated;
