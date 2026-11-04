-- Personal dashboard data (R-DASH-5 faculty, R-DASH-6 student). Hand-written (not from the MySQL source).
-- One read-only function that describes the CALLER'S OWN teaching or studies by identity, with no parameters (like my_context): a student gets their attendance per course and today's classes,
-- an employee gets the sessions they instruct in the next seven days and how many of their past sessions are still unmarked. Nothing here reads fees: the seed gives students no FEES
-- permission (KNOWN_ISSUES KI-41, owner decision D-5), so a "my fees" card waits for that decision.

CREATE FUNCTION public.my_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_stu bigint := sims_private.current_student_id(); v_emp bigint := sims_private.current_employee_id(); v_out jsonb := '{}'::jsonb;
BEGIN
    IF sims_private.current_user_id() IS NULL THEN RETURN NULL; END IF;
    IF v_stu IS NOT NULL THEN
        v_out := v_out || jsonb_build_object(
            'attendance', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('course', x.course, 'section_id', x.cos, 'conducted', x.conducted, 'present', x.present,
                                                    'percentage', CASE WHEN x.conducted = 0 THEN NULL ELSE round(100.0 * x.present / x.conducted, 1) END) ORDER BY x.course)
                FROM (
                    SELECT (c.course_code || ' — ' || c.course_title) AS course, cos.course_offering_section_id AS cos,
                           count(DISTINCT cs.class_session_id) AS conducted,
                           count(DISTINCT cs.class_session_id) FILTER (WHERE st.counts_as_present) AS present
                    FROM course_offering_section_student r
                    JOIN student_course_registration cr ON cr.course_registration_id = r.course_registration_id
                    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
                    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
                    JOIN course_offering_section cos ON cos.course_offering_section_id = r.course_offering_section_id
                    JOIN course_offering co ON co.course_offering_id = cos.course_offering_id
                    JOIN course_catalog c ON c.course_id = co.course_id
                    LEFT JOIN class_session cs ON cs.course_offering_section_id = cos.course_offering_section_id AND cs.session_status = 'CONDUCTED'
                    LEFT JOIN student_attendance a ON a.class_session_id = cs.class_session_id AND a.course_offering_section_student_id = r.course_offering_section_student_id
                    LEFT JOIN attendance_status st ON st.attendance_status_id = a.attendance_status_id
                    WHERE e.student_id = v_stu AND r.roster_status = 'ACTIVE'
                    GROUP BY c.course_code, c.course_title, cos.course_offering_section_id
                ) x), '[]'::jsonb),
            'today', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('course', (c.course_code || ' — ' || c.course_title), 'start', cs.start_time, 'end', cs.end_time, 'type', cs.session_type, 'status', cs.session_status,
                                                    'room', CASE WHEN rm.room_id IS NULL THEN NULL ELSE bl.building_code || '-' || rm.room_code END) ORDER BY cs.start_time)
                FROM course_offering_section_student r
                JOIN student_course_registration cr ON cr.course_registration_id = r.course_registration_id
                JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
                JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
                JOIN course_offering_section cos ON cos.course_offering_section_id = r.course_offering_section_id
                JOIN course_offering co ON co.course_offering_id = cos.course_offering_id
                JOIN course_catalog c ON c.course_id = co.course_id
                JOIN class_session cs ON cs.course_offering_section_id = cos.course_offering_section_id AND cs.session_date = current_date AND cs.session_status <> 'CANCELLED'
                LEFT JOIN room rm ON rm.room_id = cs.room_id LEFT JOIN building bl ON bl.building_id = rm.building_id
                WHERE e.student_id = v_stu AND r.roster_status = 'ACTIVE'), '[]'::jsonb));
    END IF;
    IF v_emp IS NOT NULL THEN
        v_out := v_out || jsonb_build_object(
            'upcoming', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('session_id', cs.class_session_id, 'course', (c.course_code || ' — ' || c.course_title), 'section', csec.section_code, 'date', cs.session_date, 'start', cs.start_time,
                                                    'end', cs.end_time, 'type', cs.session_type, 'status', cs.session_status) ORDER BY cs.session_date, cs.start_time)
                FROM class_session cs
                JOIN faculty_course_assignment fa ON fa.faculty_assignment_id = cs.faculty_assignment_id
                JOIN course_offering_section cos ON cos.course_offering_section_id = cs.course_offering_section_id
                JOIN course_offering co ON co.course_offering_id = cos.course_offering_id
                JOIN course_catalog c ON c.course_id = co.course_id
                JOIN class_section csec ON csec.class_section_id = cos.class_section_id
                WHERE fa.employee_id = v_emp AND cs.session_date BETWEEN current_date AND current_date + 7 AND cs.session_status <> 'CANCELLED'), '[]'::jsonb),
            'unmarked', (SELECT count(*) FROM class_session cs JOIN faculty_course_assignment fa ON fa.faculty_assignment_id = cs.faculty_assignment_id
                         WHERE fa.employee_id = v_emp AND cs.session_status = 'PLANNED' AND cs.session_date < current_date AND cs.session_date >= current_date - 30),
            'sections', (SELECT count(DISTINCT fa.course_offering_section_id) FROM faculty_course_assignment fa WHERE fa.employee_id = v_emp AND (fa.end_date IS NULL OR fa.end_date >= current_date)));
    END IF;
    RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.my_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_dashboard() TO authenticated;
