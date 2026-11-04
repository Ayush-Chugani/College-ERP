-- Attendance workflow. Hand-written (not from the MySQL source).
--
-- * student_attendance and attendance_correction_request become RPC-only for clients: marking must be validated against the roster,
--   stamped with the acting user, and corrections must change attendance atomically with their decision.
-- * ASSUMPTIONS (the source defines none of these): saving attendance marks a PLANNED session as CONDUCTED; the attendance percentage is
--   present / CONDUCTED sessions, where "present" = attendance_status.counts_as_present; a correction can only be decided while the
--   attendance still has the status it had when the correction was requested; the teaching roster is the course registrations of
--   students whose term registration is in the section (and batch, when the teaching section has one).
-- * attendance_status has no seed data in the source; a global administrator defines the statuses.
-- * student_attendance rows are not audited row-by-row (high volume; each row already carries marked_at / marked_by_user_id).

-- ---------------------------------------------------------------
-- Ownership checks the schema implies but does not enforce
-- ---------------------------------------------------------------
CREATE FUNCTION sims_attendance_session_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cos bigint;
BEGIN
    IF NEW.faculty_assignment_id IS NOT NULL THEN
        SELECT course_offering_section_id INTO v_cos FROM faculty_course_assignment WHERE faculty_assignment_id = NEW.faculty_assignment_id;
        IF v_cos IS NOT NULL AND v_cos <> NEW.course_offering_section_id THEN
            RAISE EXCEPTION 'The instructor assignment belongs to a different teaching section' USING ERRCODE = '45000';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_class_session_guard BEFORE INSERT OR UPDATE ON class_session FOR EACH ROW EXECUTE FUNCTION sims_attendance_session_guard();

CREATE TRIGGER trg_course_offering_section_audit AFTER INSERT OR UPDATE OR DELETE ON course_offering_section
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('TEACHING', 'course_offering_section_id');
CREATE TRIGGER trg_faculty_course_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON faculty_course_assignment
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('TEACHING', 'faculty_assignment_id');
CREATE TRIGGER trg_class_session_audit AFTER INSERT OR UPDATE OR DELETE ON class_session
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ATTENDANCE', 'class_session_id');
CREATE TRIGGER trg_attendance_correction_audit AFTER INSERT OR UPDATE OR DELETE ON attendance_correction_request
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ATTENDANCE', 'attendance_correction_id');
CREATE TRIGGER trg_attendance_status_audit AFTER INSERT OR UPDATE OR DELETE ON attendance_status
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ATTENDANCE', 'attendance_status_id');

-- ---------------------------------------------------------------
-- RPC-only tables
-- ---------------------------------------------------------------
DROP POLICY student_attendance_insert ON student_attendance;
DROP POLICY student_attendance_update ON student_attendance;
DROP POLICY student_attendance_delete ON student_attendance;
DROP POLICY attendance_correction_request_insert ON attendance_correction_request;
DROP POLICY attendance_correction_request_update ON attendance_correction_request;
DROP POLICY attendance_correction_request_delete ON attendance_correction_request;
REVOKE INSERT, UPDATE, DELETE ON student_attendance, attendance_correction_request FROM authenticated;

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.programme_of_cos(p_cos_id bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT pto.programme_id FROM public.course_offering_section cos
    JOIN public.programme_term_offering pto ON pto.programme_term_offering_id = cos.programme_term_offering_id
    WHERE cos.course_offering_section_id = p_cos_id
$$;

CREATE FUNCTION sims_private.att_authorize_cos(p_cos_id bigint, p_module text, p_action text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer := sims_private.programme_of_cos(p_cos_id);
BEGIN
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY[p_module || '.ALL.' || p_action]::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (%.ALL.%) or unknown teaching section', p_module, p_action USING ERRCODE = '42501';
    END IF;
    RETURN v_prog;
END $$;

CREATE FUNCTION sims_private.att_session_cos(p_session_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT course_offering_section_id FROM public.class_session WHERE class_session_id = p_session_id
$$;
REVOKE ALL ON FUNCTION sims_private.programme_of_cos(bigint), sims_private.att_authorize_cos(bigint, text, text), sims_private.att_session_cos(bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- Roster population from course registrations
-- ---------------------------------------------------------------
CREATE FUNCTION public.teaching_populate_roster(p_cos_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
    PERFORM sims_private.att_authorize_cos(p_cos_id, 'TEACHING', 'UPDATE');
    INSERT INTO course_offering_section_student (course_offering_section_id, course_registration_id, course_offering_id, effective_from)
    SELECT cos.course_offering_section_id, cr.course_registration_id, cr.course_offering_id, current_date
    FROM course_offering_section cos
    JOIN student_course_registration cr ON cr.course_offering_id = cos.course_offering_id AND cr.registration_status IN ('REGISTERED', 'APPROVED')
    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
         AND tr.registration_status IN ('REGISTERED', 'APPROVED')
         AND tr.class_section_id = cos.class_section_id
         AND (cos.class_batch_id IS NULL OR tr.class_batch_id = cos.class_batch_id)
    WHERE cos.course_offering_section_id = p_cos_id
    ON CONFLICT (course_offering_section_id, course_registration_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- ---------------------------------------------------------------
-- Marking sheet (names live in the STUDENT module the marker may not read)
-- ---------------------------------------------------------------
CREATE FUNCTION public.attendance_sheet(p_session_id bigint)
RETURNS TABLE (roster_id bigint, student_id bigint, student_number text, display_name text, attendance_status_id integer, remarks text, marked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cos bigint := sims_private.att_session_cos(p_session_id);
BEGIN
    IF v_cos IS NULL THEN RAISE EXCEPTION 'Not authorised (ATTENDANCE.ALL.READ) or unknown session' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.att_authorize_cos(v_cos, 'ATTENDANCE', 'READ');
    RETURN QUERY
    SELECT r.course_offering_section_student_id, s.student_id, s.student_number::text, s.display_name::text, a.attendance_status_id::integer, a.remarks::text, a.marked_at
    FROM course_offering_section_student r
    JOIN student_course_registration cr ON cr.course_registration_id = r.course_registration_id
    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    LEFT JOIN student_attendance a ON a.class_session_id = p_session_id AND a.course_offering_section_student_id = r.course_offering_section_student_id
    WHERE r.course_offering_section_id = v_cos AND r.roster_status = 'ACTIVE'
    ORDER BY s.display_name, r.course_offering_section_student_id;
END $$;

-- ---------------------------------------------------------------
-- Mark attendance: p_marks = [{"roster_id": n, "status_id": n, "remarks": "..."}]
-- ---------------------------------------------------------------
CREATE FUNCTION public.attendance_mark(p_session_id bigint, p_marks jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cos bigint := sims_private.att_session_cos(p_session_id);
    v_prog integer; v_status text; v_can_update boolean; m jsonb; v_roster bigint; v_st integer; v_seen bigint[] := '{}'; v_n integer := 0;
BEGIN
    IF v_cos IS NULL THEN RAISE EXCEPTION 'Not authorised (ATTENDANCE.ALL.CREATE) or unknown session' USING ERRCODE = '42501'; END IF;
    v_prog := sims_private.att_authorize_cos(v_cos, 'ATTENDANCE', 'CREATE');
    v_can_update := sims_private.can_programme(ARRAY['ATTENDANCE.ALL.UPDATE']::text[], v_prog);
    IF p_marks IS NULL OR jsonb_typeof(p_marks) <> 'array' OR jsonb_array_length(p_marks) = 0 OR jsonb_array_length(p_marks) > 1000 THEN
        RAISE EXCEPTION 'p_marks must be a non-empty array of at most 1000 entries' USING ERRCODE = '22023';
    END IF;
    SELECT session_status INTO v_status FROM class_session WHERE class_session_id = p_session_id FOR UPDATE;
    IF v_status IN ('CANCELLED', 'RESCHEDULED') THEN
        RAISE EXCEPTION 'Attendance cannot be marked for a % session', v_status USING ERRCODE = '45000';
    END IF;

    FOR m IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
        v_roster := (m ->> 'roster_id')::bigint;
        v_st := (m ->> 'status_id')::integer;
        IF v_roster IS NULL OR v_st IS NULL THEN RAISE EXCEPTION 'Each mark needs roster_id and status_id' USING ERRCODE = '22023'; END IF;
        IF v_roster = ANY (v_seen) THEN RAISE EXCEPTION 'Duplicate roster entry % in the payload', v_roster USING ERRCODE = '22023'; END IF;
        v_seen := v_seen || v_roster;
        IF NOT EXISTS (SELECT 1 FROM course_offering_section_student WHERE course_offering_section_student_id = v_roster AND course_offering_section_id = v_cos AND roster_status = 'ACTIVE') THEN
            RAISE EXCEPTION 'Roster entry % is not an active member of this teaching section', v_roster USING ERRCODE = '45000';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM attendance_status WHERE attendance_status_id = v_st AND is_active) THEN
            RAISE EXCEPTION 'Unknown or inactive attendance status %', v_st USING ERRCODE = '22023';
        END IF;
        IF NOT v_can_update AND EXISTS (SELECT 1 FROM student_attendance WHERE class_session_id = p_session_id AND course_offering_section_student_id = v_roster) THEN
            RAISE EXCEPTION 'Not authorised (ATTENDANCE.ALL.UPDATE) to change attendance that is already marked' USING ERRCODE = '42501';
        END IF;
        INSERT INTO student_attendance (class_session_id, course_offering_section_student_id, course_offering_section_id, attendance_status_id, marked_by_user_id, remarks)
        VALUES (p_session_id, v_roster, v_cos, v_st, sims_private.current_user_id(), NULLIF(btrim(m ->> 'remarks'), ''))
        ON CONFLICT (class_session_id, course_offering_section_student_id)
        DO UPDATE SET attendance_status_id = EXCLUDED.attendance_status_id, marked_at = now(), marked_by_user_id = EXCLUDED.marked_by_user_id, remarks = EXCLUDED.remarks;
        v_n := v_n + 1;
    END LOOP;
    IF v_status = 'PLANNED' THEN UPDATE class_session SET session_status = 'CONDUCTED' WHERE class_session_id = p_session_id; END IF;
    RETURN v_n;
END $$;

-- ---------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------
CREATE FUNCTION public.attendance_request_correction(p_session_id bigint, p_roster_id bigint, p_requested_status_id integer, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cos bigint := sims_private.att_session_cos(p_session_id); v_old integer; v_id bigint; v_pending record;
BEGIN
    IF v_cos IS NULL THEN RAISE EXCEPTION 'Not authorised (ATTENDANCE.ALL.CREATE) or unknown session' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.att_authorize_cos(v_cos, 'ATTENDANCE', 'CREATE');
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM attendance_status WHERE attendance_status_id = p_requested_status_id AND is_active) THEN
        RAISE EXCEPTION 'Unknown or inactive attendance status' USING ERRCODE = '22023';
    END IF;
    SELECT attendance_status_id INTO v_old FROM student_attendance WHERE class_session_id = p_session_id AND course_offering_section_student_id = p_roster_id;
    IF v_old IS NULL THEN RAISE EXCEPTION 'No attendance has been marked for this student in this session' USING ERRCODE = '45000'; END IF;
    IF v_old = p_requested_status_id THEN RAISE EXCEPTION 'The requested status is the same as the current one' USING ERRCODE = '45000'; END IF;
    SELECT attendance_correction_id, requested_status_id INTO v_pending FROM attendance_correction_request
     WHERE class_session_id = p_session_id AND course_offering_section_student_id = p_roster_id AND request_status = 'PENDING';
    IF FOUND THEN
        IF v_pending.requested_status_id = p_requested_status_id THEN RETURN v_pending.attendance_correction_id; END IF;  -- idempotent replay
        RAISE EXCEPTION 'A different correction is already pending for this student and session' USING ERRCODE = '45000';
    END IF;
    INSERT INTO attendance_correction_request (class_session_id, course_offering_section_student_id, old_status_id, requested_status_id, reason)
    VALUES (p_session_id, p_roster_id, v_old, p_requested_status_id, btrim(p_reason)) RETURNING attendance_correction_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.attendance_decide_correction(p_correction_id bigint, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c record; v_cos bigint; v_current integer;
BEGIN
    SELECT * INTO v_c FROM attendance_correction_request WHERE attendance_correction_id = p_correction_id FOR UPDATE;
    v_cos := CASE WHEN v_c IS NULL THEN NULL ELSE sims_private.att_session_cos(v_c.class_session_id) END;
    IF v_cos IS NULL THEN RAISE EXCEPTION 'Not authorised (ATTENDANCE.ALL.APPROVE) or unknown correction' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.att_authorize_cos(v_cos, 'ATTENDANCE', 'APPROVE');
    IF v_c.request_status = (CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END) THEN RETURN; END IF;  -- idempotent replay
    IF v_c.request_status <> 'PENDING' THEN RAISE EXCEPTION 'The correction is already %', v_c.request_status USING ERRCODE = '45000'; END IF;
    IF p_approve THEN
        SELECT attendance_status_id INTO v_current FROM student_attendance WHERE class_session_id = v_c.class_session_id AND course_offering_section_student_id = v_c.course_offering_section_student_id FOR UPDATE;
        IF v_current IS DISTINCT FROM v_c.old_status_id THEN
            RAISE EXCEPTION 'The attendance has changed since this correction was requested' USING ERRCODE = '45000';
        END IF;
        UPDATE student_attendance SET attendance_status_id = v_c.requested_status_id, marked_at = now(), marked_by_user_id = sims_private.current_user_id()
         WHERE class_session_id = v_c.class_session_id AND course_offering_section_student_id = v_c.course_offering_section_student_id;
    END IF;
    UPDATE attendance_correction_request SET request_status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END, resolved_at = now() WHERE attendance_correction_id = p_correction_id;
END $$;

-- ---------------------------------------------------------------
-- Summary per student for a teaching section
-- ---------------------------------------------------------------
CREATE FUNCTION public.attendance_summary(p_cos_id bigint)
RETURNS TABLE (roster_id bigint, student_id bigint, student_number text, display_name text, conducted_sessions integer, present_sessions integer, percentage numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total integer;
BEGIN
    PERFORM sims_private.att_authorize_cos(p_cos_id, 'ATTENDANCE', 'READ');
    SELECT count(*)::integer INTO v_total FROM class_session WHERE course_offering_section_id = p_cos_id AND session_status = 'CONDUCTED';
    RETURN QUERY
    SELECT r.course_offering_section_student_id, s.student_id, s.student_number::text, s.display_name::text, v_total,
           count(*) FILTER (WHERE st.counts_as_present AND cs.session_status = 'CONDUCTED')::integer,
           CASE WHEN v_total = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE st.counts_as_present AND cs.session_status = 'CONDUCTED') / v_total, 1) END
    FROM course_offering_section_student r
    JOIN student_course_registration cr ON cr.course_registration_id = r.course_registration_id
    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    LEFT JOIN student_attendance a ON a.course_offering_section_student_id = r.course_offering_section_student_id
    LEFT JOIN attendance_status st ON st.attendance_status_id = a.attendance_status_id
    LEFT JOIN class_session cs ON cs.class_session_id = a.class_session_id
    WHERE r.course_offering_section_id = p_cos_id AND r.roster_status = 'ACTIVE'
    GROUP BY r.course_offering_section_student_id, s.student_id, s.student_number, s.display_name
    ORDER BY s.display_name;
END $$;

REVOKE ALL ON FUNCTION public.teaching_populate_roster(bigint), public.attendance_sheet(bigint), public.attendance_mark(bigint, jsonb),
    public.attendance_request_correction(bigint, bigint, integer, text), public.attendance_decide_correction(bigint, boolean), public.attendance_summary(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teaching_populate_roster(bigint), public.attendance_sheet(bigint), public.attendance_mark(bigint, jsonb),
    public.attendance_request_correction(bigint, bigint, integer, text), public.attendance_decide_correction(bigint, boolean), public.attendance_summary(bigint) TO authenticated;
