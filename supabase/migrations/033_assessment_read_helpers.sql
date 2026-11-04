-- Read helpers for the assessment / results screens. Hand-written (not from the MySQL source).
-- Examination staff hold ASSESSMENT / RESULT permissions but not necessarily TEACHING / REGISTRATION read access, so they cannot list
-- course offerings directly. These functions return only what the screens need, authorised at the programme's scope.

CREATE FUNCTION public.assessment_offerings(p_term bigint DEFAULT NULL, p_programme integer DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (course_offering_id bigint, programme_term_offering_id bigint, offering_code text, course_code text, course_title text, term_name text,
               programme_name text, semester_name text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH visible AS (
        SELECT co.course_offering_id, co.programme_term_offering_id, co.offering_code, c.course_code, c.course_title, t.term_name, p.programme_name, s.semester_name
        FROM course_offering co
        JOIN programme_term_offering pto ON pto.programme_term_offering_id = co.programme_term_offering_id
        JOIN course_catalog c ON c.course_id = co.course_id
        JOIN academic_term t ON t.academic_term_id = pto.academic_term_id
        JOIN programme p ON p.programme_id = pto.programme_id
        JOIN semester s ON s.semester_id = pto.semester_id
        WHERE (p_term IS NULL OR pto.academic_term_id = p_term) AND (p_programme IS NULL OR pto.programme_id = p_programme)
          AND (sims_private.can_programme(ARRAY['ASSESSMENT.ALL.READ']::text[], pto.programme_id) OR sims_private.can_programme(ARRAY['RESULT.ALL.READ']::text[], pto.programme_id))
    )
    SELECT v.course_offering_id, v.programme_term_offering_id, v.offering_code::text, v.course_code::text, v.course_title::text, v.term_name::text, v.programme_name::text, v.semester_name::text,
           count(*) OVER ()
    FROM visible v ORDER BY v.course_offering_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.assessment_offering_info(p_course_offering_id bigint)
RETURNS TABLE (course_offering_id bigint, programme_term_offering_id bigint, programme_id integer, offering_code text, course_code text, course_title text, credits numeric,
               term_name text, programme_name text, semester_name text, internal_max_marks numeric, external_max_marks numeric, passing_marks numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer := sims_private.programme_of_offering(p_course_offering_id);
BEGIN
    IF v_prog IS NULL OR NOT (sims_private.can_programme(ARRAY['ASSESSMENT.ALL.READ']::text[], v_prog) OR sims_private.can_programme(ARRAY['RESULT.ALL.READ']::text[], v_prog)) THEN
        RAISE EXCEPTION 'Not authorised (ASSESSMENT.ALL.READ / RESULT.ALL.READ) or unknown offering' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT co.course_offering_id, co.programme_term_offering_id::bigint, pto.programme_id::integer, co.offering_code::text, c.course_code::text, c.course_title::text, c.credits,
           t.term_name::text, p.programme_name::text, s.semester_name::text, cc.internal_max_marks, cc.external_max_marks, cc.passing_marks
    FROM course_offering co
    JOIN programme_term_offering pto ON pto.programme_term_offering_id = co.programme_term_offering_id
    JOIN course_catalog c ON c.course_id = co.course_id
    JOIN academic_term t ON t.academic_term_id = pto.academic_term_id
    JOIN programme p ON p.programme_id = pto.programme_id
    JOIN semester s ON s.semester_id = pto.semester_id
    LEFT JOIN curriculum_course cc ON cc.curriculum_course_id = co.curriculum_course_id
    WHERE co.course_offering_id = p_course_offering_id;
END $$;

-- The signed-in student's own PUBLISHED results (nothing else), shaped for display
CREATE FUNCTION public.my_results() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(jsonb_agg(term_obj ORDER BY t_start DESC, term_registration_id DESC), '[]'::jsonb)
    FROM (
        SELECT tr.term_registration_id, t.start_date AS t_start,
               jsonb_build_object(
                   'term_registration_id', tr.term_registration_id, 'term_name', t.term_name, 'semester_name', s.semester_name, 'programme_name', p.programme_name,
                   'credits_registered', r.credits_registered, 'credits_earned', r.credits_earned, 'sgpa', r.sgpa, 'cgpa', r.cgpa, 'result_status', r.result_status, 'published_at', r.published_at,
                   'courses', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object('course_code', c.course_code, 'course_title', c.course_title, 'credits', c.credits, 'internal_marks', x.internal_marks,
                                                           'external_marks', x.external_marks, 'total_marks', x.total_marks, 'grade_letter', x.grade_letter, 'grade_point', x.grade_point,
                                                           'credits_earned', x.credits_earned, 'result_status', x.result_status) ORDER BY c.course_code)
                       FROM student_course_registration cr
                       JOIN course_offering co ON co.course_offering_id = cr.course_offering_id
                       JOIN course_catalog c ON c.course_id = co.course_id
                       JOIN LATERAL (SELECT y.* FROM student_course_result y WHERE y.course_registration_id = cr.course_registration_id ORDER BY y.attempt_number DESC LIMIT 1) x ON true
                       WHERE cr.term_registration_id = tr.term_registration_id), '[]'::jsonb)
               ) AS term_obj
        FROM student_term_registration tr
        JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
        JOIN student_term_result r ON r.term_registration_id = tr.term_registration_id AND r.published_at IS NOT NULL
        JOIN programme_term_offering pto ON pto.programme_term_offering_id = tr.programme_term_offering_id
        JOIN academic_term t ON t.academic_term_id = pto.academic_term_id
        JOIN semester s ON s.semester_id = pto.semester_id
        JOIN programme p ON p.programme_id = pto.programme_id
        WHERE e.student_id = sims_private.current_student_id()
    ) q
$$;

REVOKE ALL ON FUNCTION public.assessment_offerings(bigint, integer, integer, integer), public.assessment_offering_info(bigint), public.my_results() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_offerings(bigint, integer, integer, integer), public.assessment_offering_info(bigint), public.my_results() TO authenticated;
