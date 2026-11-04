-- Mentoring. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * mentor_assignment writes and ALL counselling_session access are RPC-only for clients. Counselling notes are confidential: the
--    generated policies would let every department reader read every note, so no client policy exists on counselling_session at all.
--  * The notes themselves are never copied into the audit log (the generic audit trigger records full rows); the RPCs write an
--    identity-free "who did what to which session" entry instead.
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-49):
--  1  A student has at most one ACTIVE mentor; the mentor must be an ACTIVE employee of the institution the student's programme
--     belongs to; the student needs an ACTIVE enrolment.
--  2  Only the assigned mentor (while the assignment is ACTIVE) or a global MENTORING.CREATE holder records or edits sessions.
--  3  Who sees the content of a session (observations and action plan): NORMAL = the mentor and MENTORING.READ holders at the student's
--     scope; RESTRICTED = the mentor and global MENTORING.READ holders; HIGHLY_RESTRICTED = the mentor only. Everyone else sees only
--     the date, status and level of the session.
--  4  A FOLLOW_UP_REQUIRED session needs a follow-up date, and a follow-up date cannot precede the session.
--  5  Students cannot see their own assignment or sessions (no MENTORING permission exists at SELF scope in the seed).

CREATE FUNCTION sims_private.programme_institution(p_programme integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT c.institution_id::integer FROM public.programme p JOIN public.department d ON d.department_id = p.department_id JOIN public.campus c ON c.campus_id = d.campus_id WHERE p.programme_id = p_programme
$$;

DROP POLICY mentor_assignment_insert ON mentor_assignment;
DROP POLICY mentor_assignment_update ON mentor_assignment;
DROP POLICY mentor_assignment_delete ON mentor_assignment;
REVOKE INSERT, UPDATE, DELETE ON mentor_assignment FROM authenticated;
DROP POLICY counselling_session_select ON counselling_session;
DROP POLICY counselling_session_insert ON counselling_session;
DROP POLICY counselling_session_update ON counselling_session;
DROP POLICY counselling_session_delete ON counselling_session;
REVOKE ALL ON counselling_session FROM authenticated;
-- Keep the 'every table has a policy' invariant explicit: no client row access at all, whatever grants appear later.
CREATE POLICY counselling_session_no_client_access ON counselling_session FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_mentor_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON mentor_assignment
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('MENTORING', 'mentor_assignment_id');

CREATE FUNCTION sims_private.mentoring_audit(p_action text, p_session_id bigint, p_assignment_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO public.activity_audit (user_id, module_code, action_code, entity_name, entity_id, after_values)
    VALUES (sims_private.current_user_id(), 'MENTORING', p_action, 'counselling_session', p_session_id::text, jsonb_build_object('mentor_assignment_id', p_assignment_id))
$$;

-- Is the caller the assigned mentor of this assignment?
CREATE FUNCTION sims_private.is_mentor_of(p_assignment_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.mentor_assignment a WHERE a.mentor_assignment_id = p_assignment_id AND a.employee_id = sims_private.current_employee_id())
$$;

-- Can the caller see that the assignment exists (reader at the student's scope, or the mentor)?
CREATE FUNCTION sims_private.mentoring_can_see(p_assignment_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT sims_private.can_student(ARRAY['MENTORING.ALL.READ']::text[], a.student_id, false) OR a.employee_id = sims_private.current_employee_id()
                     FROM public.mentor_assignment a WHERE a.mentor_assignment_id = p_assignment_id), false)
$$;

-- ---------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------
CREATE FUNCTION public.mentoring_assign(p_student_number text, p_employee_number text, p_start date DEFAULT current_date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint; v_emp record; v_prog integer; v_id bigint;
BEGIN
    IF p_student_number IS NULL OR btrim(p_student_number) = '' OR p_employee_number IS NULL OR btrim(p_employee_number) = '' THEN
        RAISE EXCEPTION 'Student number and employee number are required' USING ERRCODE = '22023';
    END IF;
    SELECT student_id INTO v_student FROM student WHERE student_number = btrim(p_student_number);
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['MENTORING.ALL.ASSIGN']::text[], v_student, true) THEN
        RAISE EXCEPTION 'Not authorised (MENTORING.ALL.ASSIGN) or unknown student' USING ERRCODE = '42501';
    END IF;
    SELECT e.programme_id INTO v_prog FROM student_programme_enrolment e WHERE e.student_id = v_student AND e.enrolment_status = 'ACTIVE' ORDER BY e.enrolment_id DESC LIMIT 1;
    IF v_prog IS NULL THEN RAISE EXCEPTION 'The student has no ACTIVE enrolment' USING ERRCODE = '45000'; END IF;
    SELECT employee_id, institution_id, employment_status INTO v_emp FROM employee WHERE employee_number = btrim(p_employee_number);
    IF v_emp IS NULL THEN RAISE EXCEPTION 'Unknown employee number' USING ERRCODE = '22023'; END IF;
    IF v_emp.employment_status <> 'ACTIVE' THEN RAISE EXCEPTION 'The employee is not ACTIVE' USING ERRCODE = '45000'; END IF;
    IF v_emp.institution_id <> sims_private.programme_institution(v_prog) THEN RAISE EXCEPTION 'The mentor belongs to a different institution from the student' USING ERRCODE = '45000'; END IF;

    SELECT mentor_assignment_id INTO v_id FROM mentor_assignment WHERE student_id = v_student AND employee_id = v_emp.employee_id AND assignment_status = 'ACTIVE';
    IF v_id IS NOT NULL THEN RETURN v_id; END IF; -- idempotent replay
    PERFORM pg_advisory_xact_lock(hashtextextended('mentor:' || v_student, 0));
    IF EXISTS (SELECT 1 FROM mentor_assignment WHERE student_id = v_student AND assignment_status = 'ACTIVE') THEN
        RAISE EXCEPTION 'The student already has an ACTIVE mentor; end that assignment first' USING ERRCODE = '45000';
    END IF;
    INSERT INTO mentor_assignment (student_id, employee_id, start_date) VALUES (v_student, v_emp.employee_id, COALESCE(p_start, current_date)) RETURNING mentor_assignment_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.mentoring_end_assignment(p_assignment_id bigint, p_status text, p_end_date date DEFAULT current_date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT student_id, start_date, assignment_status INTO v FROM mentor_assignment WHERE mentor_assignment_id = p_assignment_id FOR UPDATE;
    IF v IS NULL OR NOT sims_private.can_student(ARRAY['MENTORING.ALL.ASSIGN']::text[], v.student_id, true) THEN
        RAISE EXCEPTION 'Not authorised (MENTORING.ALL.ASSIGN) or unknown assignment' USING ERRCODE = '42501';
    END IF;
    IF p_status NOT IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'The status must be COMPLETED or CANCELLED' USING ERRCODE = '22023'; END IF;
    IF v.assignment_status <> 'ACTIVE' THEN
        IF v.assignment_status = p_status THEN RETURN; END IF;
        RAISE EXCEPTION 'The assignment is already %', v.assignment_status USING ERRCODE = '45000';
    END IF;
    IF COALESCE(p_end_date, current_date) < v.start_date THEN RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = '45000'; END IF;
    UPDATE mentor_assignment SET assignment_status = p_status, end_date = COALESCE(p_end_date, current_date) WHERE mentor_assignment_id = p_assignment_id;
END $$;

CREATE FUNCTION public.mentoring_assignments(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (mentor_assignment_id bigint, student_id bigint, student_number text, student_name text, employee_id bigint, mentor_name text, start_date date, end_date date,
               assignment_status text, session_count bigint, is_mine boolean, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_employee_id() AS emp),
    visible AS (
        SELECT a.mentor_assignment_id, a.student_id, s.student_number::text, s.display_name::text AS student_name, a.employee_id, e.display_name::text AS mentor_name, a.start_date, a.end_date,
               a.assignment_status::text,
               (SELECT count(*) FROM counselling_session c WHERE c.mentor_assignment_id = a.mentor_assignment_id) AS session_count,
               COALESCE(a.employee_id = (SELECT emp FROM me), false) AS is_mine
        FROM mentor_assignment a JOIN student s ON s.student_id = a.student_id JOIN employee e ON e.employee_id = a.employee_id
        WHERE (p_status IS NULL OR a.assignment_status = p_status)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(s.student_number || ' ' || s.display_name || ' ' || e.display_name)) > 0)
          AND (a.employee_id = (SELECT emp FROM me) OR sims_private.can_student(ARRAY['MENTORING.ALL.READ']::text[], a.student_id, false))
    )
    SELECT v.*, count(*) OVER () FROM visible v ORDER BY v.is_mine DESC, v.mentor_assignment_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.mentoring_assignment_info(p_assignment_id bigint)
RETURNS TABLE (mentor_assignment_id bigint, student_id bigint, student_number text, student_name text, employee_id bigint, mentor_name text, start_date date, end_date date, assignment_status text, is_mine boolean, can_assign boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.mentoring_can_see(p_assignment_id) THEN RAISE EXCEPTION 'Not authorised (MENTORING.ALL.READ) or unknown assignment' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    SELECT a.mentor_assignment_id::bigint, a.student_id::bigint, s.student_number::text, s.display_name::text, a.employee_id::bigint, e.display_name::text, a.start_date, a.end_date, a.assignment_status::text,
           COALESCE(a.employee_id = sims_private.current_employee_id(), false), sims_private.can_student(ARRAY['MENTORING.ALL.ASSIGN']::text[], a.student_id, true)
    FROM mentor_assignment a JOIN student s ON s.student_id = a.student_id JOIN employee e ON e.employee_id = a.employee_id WHERE a.mentor_assignment_id = p_assignment_id;
END $$;

-- ---------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------
CREATE FUNCTION public.mentoring_sessions(p_assignment_id bigint)
RETURNS TABLE (counselling_session_id bigint, session_date timestamptz, session_status text, confidentiality_level text, follow_up_date date, observations text, action_plan text, redacted boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mentor boolean; v_student bigint;
BEGIN
    IF NOT sims_private.mentoring_can_see(p_assignment_id) THEN RAISE EXCEPTION 'Not authorised (MENTORING.ALL.READ) or unknown assignment' USING ERRCODE = '42501'; END IF;
    v_mentor := sims_private.is_mentor_of(p_assignment_id);
    SELECT student_id INTO v_student FROM mentor_assignment WHERE mentor_assignment_id = p_assignment_id;
    RETURN QUERY
    WITH s AS (
        SELECT c.*, (v_mentor OR (c.confidentiality_level = 'NORMAL' AND sims_private.can_student(ARRAY['MENTORING.ALL.READ']::text[], v_student, false))
                     OR (c.confidentiality_level = 'RESTRICTED' AND sims_private.can_global(ARRAY['MENTORING.ALL.READ']::text[]))) AS full_access
        FROM counselling_session c WHERE c.mentor_assignment_id = p_assignment_id
    )
    SELECT s.counselling_session_id::bigint, s.session_date, s.session_status::text, s.confidentiality_level::text, s.follow_up_date,
           CASE WHEN s.full_access THEN s.observations END, CASE WHEN s.full_access THEN s.action_plan END, NOT s.full_access
    FROM s ORDER BY s.session_date DESC, s.counselling_session_id DESC;
END $$;

CREATE FUNCTION sims_private.mentoring_check_session(p_date timestamptz, p_observations text, p_action_plan text, p_follow_up date, p_status text, p_level text) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_date IS NULL THEN RAISE EXCEPTION 'The session date is required' USING ERRCODE = '22023'; END IF;
    IF p_status NOT IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'FOLLOW_UP_REQUIRED') THEN RAISE EXCEPTION 'Invalid session status' USING ERRCODE = '22023'; END IF;
    IF p_level NOT IN ('NORMAL', 'RESTRICTED', 'HIGHLY_RESTRICTED') THEN RAISE EXCEPTION 'Invalid confidentiality level' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_observations, '')) > 10000 OR length(COALESCE(p_action_plan, '')) > 10000 THEN RAISE EXCEPTION 'Notes are limited to 10000 characters' USING ERRCODE = '22023'; END IF;
    IF p_follow_up IS NOT NULL AND p_follow_up < p_date::date THEN RAISE EXCEPTION 'The follow-up date cannot be before the session' USING ERRCODE = '45000'; END IF;
    IF p_status = 'FOLLOW_UP_REQUIRED' AND p_follow_up IS NULL THEN RAISE EXCEPTION 'A follow-up date is required when a follow-up is needed' USING ERRCODE = '45000'; END IF;
END $$;

CREATE FUNCTION public.mentoring_record_session(p_assignment_id bigint, p_date timestamptz, p_observations text, p_action_plan text, p_follow_up date, p_status text DEFAULT 'COMPLETED', p_level text DEFAULT 'RESTRICTED') RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_id bigint;
BEGIN
    IF NOT sims_private.mentoring_can_see(p_assignment_id) THEN RAISE EXCEPTION 'Not authorised (MENTORING.ALL.CREATE) or unknown assignment' USING ERRCODE = '42501'; END IF;
    IF NOT (sims_private.is_mentor_of(p_assignment_id) OR sims_private.can_global(ARRAY['MENTORING.ALL.CREATE']::text[])) THEN
        RAISE EXCEPTION 'Not authorised (MENTORING.ALL.CREATE): only the assigned mentor records sessions' USING ERRCODE = '42501';
    END IF;
    SELECT assignment_status INTO v_status FROM mentor_assignment WHERE mentor_assignment_id = p_assignment_id;
    IF v_status <> 'ACTIVE' THEN RAISE EXCEPTION 'The assignment is %; sessions can only be recorded while it is ACTIVE', v_status USING ERRCODE = '45000'; END IF;
    PERFORM sims_private.mentoring_check_session(p_date, p_observations, p_action_plan, p_follow_up, p_status, p_level);
    INSERT INTO counselling_session (mentor_assignment_id, session_date, observations, action_plan, follow_up_date, session_status, confidentiality_level)
    VALUES (p_assignment_id, p_date, NULLIF(btrim(p_observations), ''), NULLIF(btrim(p_action_plan), ''), p_follow_up, p_status, p_level) RETURNING counselling_session_id INTO v_id;
    PERFORM sims_private.mentoring_audit('INSERT', v_id, p_assignment_id);
    RETURN v_id;
END $$;

CREATE FUNCTION public.mentoring_update_session(p_session_id bigint, p_date timestamptz, p_observations text, p_action_plan text, p_follow_up date, p_status text, p_level text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_assignment bigint; v_status text;
BEGIN
    SELECT mentor_assignment_id INTO v_assignment FROM counselling_session WHERE counselling_session_id = p_session_id FOR UPDATE;
    IF v_assignment IS NULL OR NOT sims_private.mentoring_can_see(v_assignment)
       OR NOT (sims_private.is_mentor_of(v_assignment) OR sims_private.can_global(ARRAY['MENTORING.ALL.UPDATE']::text[])) THEN
        RAISE EXCEPTION 'Not authorised (MENTORING.ALL.UPDATE) or unknown session' USING ERRCODE = '42501';
    END IF;
    SELECT assignment_status INTO v_status FROM mentor_assignment WHERE mentor_assignment_id = v_assignment;
    IF v_status <> 'ACTIVE' THEN RAISE EXCEPTION 'The assignment is %; its sessions can no longer be changed', v_status USING ERRCODE = '45000'; END IF;
    PERFORM sims_private.mentoring_check_session(p_date, p_observations, p_action_plan, p_follow_up, p_status, p_level);
    UPDATE counselling_session SET session_date = p_date, observations = NULLIF(btrim(p_observations), ''), action_plan = NULLIF(btrim(p_action_plan), ''), follow_up_date = p_follow_up,
                                   session_status = p_status, confidentiality_level = p_level WHERE counselling_session_id = p_session_id;
    PERFORM sims_private.mentoring_audit('UPDATE', p_session_id, v_assignment);
END $$;

REVOKE ALL ON FUNCTION public.mentoring_assign(text, text, date), public.mentoring_end_assignment(bigint, text, date), public.mentoring_assignments(text, text, integer, integer),
    public.mentoring_assignment_info(bigint), public.mentoring_sessions(bigint), public.mentoring_record_session(bigint, timestamptz, text, text, date, text, text),
    public.mentoring_update_session(bigint, timestamptz, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mentoring_assign(text, text, date), public.mentoring_end_assignment(bigint, text, date), public.mentoring_assignments(text, text, integer, integer),
    public.mentoring_assignment_info(bigint), public.mentoring_sessions(bigint), public.mentoring_record_session(bigint, timestamptz, text, text, date, text, text),
    public.mentoring_update_session(bigint, timestamptz, text, text, date, text, text) TO authenticated;
REVOKE ALL ON FUNCTION sims_private.programme_institution(integer), sims_private.mentoring_audit(text, bigint, bigint), sims_private.is_mentor_of(bigint), sims_private.mentoring_can_see(bigint),
    sims_private.mentoring_check_session(timestamptz, text, text, date, text, text) FROM PUBLIC, anon;
