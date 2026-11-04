-- Financial holds are enforced in other modules (KI-42). Hand-written (not from the MySQL source).
--
-- A hold (M047) puts a fee account ON_HOLD for a purpose. Enforced here, in the database, so no screen can bypass it:
--   REGISTRATION  - a student with an active REGISTRATION hold cannot be registered for a term (insert into student_term_registration is refused).
--   RESULT        - my_results() returns no published results while a RESULT hold is active (staff views are not affected).
--   CERTIFICATE   - a certificate request cannot be approved or issued while a CERTIFICATE hold is active (M060).
-- Not enforced because the feature does not exist yet: EXAMINATION and HALL_TICKET (no hall tickets or exam enrolment), HOSTEL_CHECKOUT, GRADUATION (KI-69).
-- Releasing the hold lifts the block at once. The refusal message names the hold and tells the student to contact the fee office.

CREATE FUNCTION sims_private.fin_hold_active(p_student_id bigint, p_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM student_financial_hold h JOIN student_financial_account a ON a.student_account_id = h.student_account_id WHERE a.student_id = p_student_id AND h.hold_type = p_type AND h.hold_status = 'ACTIVE')
$$;
REVOKE ALL ON FUNCTION sims_private.fin_hold_active(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.fin_hold_active(bigint, text) TO authenticated;

CREATE FUNCTION sims_guard_term_registration_hold() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_student bigint;
BEGIN
    SELECT student_id INTO v_student FROM student_programme_enrolment WHERE enrolment_id = NEW.enrolment_id;
    IF v_student IS NOT NULL AND sims_private.fin_hold_active(v_student, 'REGISTRATION') THEN
        RAISE EXCEPTION 'Registration is blocked by a fee hold. Please contact the fee office.' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_a_term_registration_fee_hold BEFORE INSERT ON student_term_registration FOR EACH ROW EXECUTE FUNCTION sims_guard_term_registration_hold();

CREATE FUNCTION sims_guard_certificate_hold() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.request_status IN ('APPROVED', 'ISSUED') AND NEW.request_status IS DISTINCT FROM OLD.request_status AND sims_private.fin_hold_active(NEW.student_id, 'CERTIFICATE') THEN
        RAISE EXCEPTION 'Certificates are blocked by a fee hold. Please contact the fee office.' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_a_certificate_request_fee_hold BEFORE UPDATE ON certificate_request FOR EACH ROW EXECUTE FUNCTION sims_guard_certificate_hold();

-- my_results() as in migration 033, plus the RESULT hold
CREATE OR REPLACE FUNCTION public.my_results() RETURNS jsonb
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
        WHERE e.student_id = sims_private.current_student_id() AND NOT sims_private.fin_hold_active(e.student_id, 'RESULT')
    ) q
$$;

