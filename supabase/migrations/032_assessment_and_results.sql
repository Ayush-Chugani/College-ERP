-- Assessment and results. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * student_assessment_mark, student_course_result and student_term_result become RPC-only for clients: marks and grades must be
--    validated, derived from data (grade scale bands, curriculum marks) and never typed in as a computed value.
--  * Students may read their own marks / results only AFTER publication (the generated SELF policies would show drafts).
--  * Published data is immutable until explicitly unpublished by a holder of the PUBLISH permission.
--
-- ASSUMPTIONS (the source defines none of these; each is documented in KNOWN_ISSUES KI-38):
--  1  marks_obtained <= event maximum (reduced_marks <= reduced maximum); absent / exempted / malpractice entries carry no marks.
--  2  saving marks moves a PLANNED event to CONDUCTED; an event can be PUBLISHED only from CONDUCTED.
--  3  course percentage = (internal + external) / (internal_max + external_max of the curriculum course) * 100; the grade comes from the
--     active grade scale's band (inclusive bounds; if bands overlap the highest minimum wins). A total below the curriculum course's
--     passing_marks makes the result FAIL even if the band says PASS (the band's letter/point are still recorded).
--  4  credits_earned = the course's credits when the result is PASS, otherwise 0.
--  5  SGPA/CGPA weight grade points by course credits over graded courses whose category has contributes_to_gpa (category from the
--     curriculum course, else the course); CGPA uses the latest result per course across the student's enrolment.
--  6  term result status: INCOMPLETE if any registered course lacks a result, WITHHELD if any is withheld, FAIL if any FAIL/ABSENT, else PASS.
--     PROMOTED is a policy decision and is never computed. INCOMPLETE and WITHHELD term results cannot be published.

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.programme_of_offering(p_course_offering_id bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT pto.programme_id FROM public.course_offering co JOIN public.programme_term_offering pto ON pto.programme_term_offering_id = co.programme_term_offering_id
    WHERE co.course_offering_id = p_course_offering_id
$$;

CREATE FUNCTION sims_private.asm_authorize(p_course_offering_id bigint, p_module text, p_action text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer := sims_private.programme_of_offering(p_course_offering_id);
BEGIN
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY[p_module || '.ALL.' || p_action]::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (%.ALL.%) or unknown record', p_module, p_action USING ERRCODE = '42501';
    END IF;
    RETURN v_prog;
END $$;

CREATE FUNCTION sims_private.event_published(p_event_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT status = 'PUBLISHED' FROM public.assessment_event WHERE assessment_event_id = p_event_id), false)
$$;

CREATE FUNCTION sims_private.course_result_published(p_course_registration_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.student_course_registration cr
        JOIN public.student_term_result tr ON tr.term_registration_id = cr.term_registration_id
        WHERE cr.course_registration_id = p_course_registration_id AND tr.published_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION sims_private.programme_of_offering(bigint), sims_private.asm_authorize(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sims_private.event_published(bigint), sims_private.course_result_published(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.event_published(bigint), sims_private.course_result_published(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------
-- RPC-only writes; SELF reads only after publication
-- ---------------------------------------------------------------
DROP POLICY student_assessment_mark_insert ON student_assessment_mark;
DROP POLICY student_assessment_mark_update ON student_assessment_mark;
DROP POLICY student_assessment_mark_delete ON student_assessment_mark;
DROP POLICY student_course_result_insert ON student_course_result;
DROP POLICY student_course_result_update ON student_course_result;
DROP POLICY student_course_result_delete ON student_course_result;
DROP POLICY student_term_result_insert ON student_term_result;
DROP POLICY student_term_result_update ON student_term_result;
DROP POLICY student_term_result_delete ON student_term_result;
REVOKE INSERT, UPDATE, DELETE ON student_assessment_mark, student_course_result, student_term_result FROM authenticated;

DO $$
DECLARE
    v_mark text; v_course text; v_term text;
BEGIN
    -- rebuild the three SELECT policies: staff scope as before; the student's own rows only once published
    SELECT pg_get_expr(polqual, polrelid) INTO v_mark FROM pg_policy WHERE polname = 'student_assessment_mark_select';
    SELECT pg_get_expr(polqual, polrelid) INTO v_course FROM pg_policy WHERE polname = 'student_course_result_select';
    SELECT pg_get_expr(polqual, polrelid) INTO v_term FROM pg_policy WHERE polname = 'student_term_result_select';
    -- the stored expressions end with ", false)" (read mode); the staff-only variant is the same call in write mode ("true")
    EXECUTE 'DROP POLICY student_assessment_mark_select ON student_assessment_mark';
    EXECUTE 'DROP POLICY student_course_result_select ON student_course_result';
    EXECUTE 'DROP POLICY student_term_result_select ON student_term_result';
    EXECUTE format('CREATE POLICY student_assessment_mark_select ON student_assessment_mark FOR SELECT TO authenticated USING ((%s) AND (%s OR sims_private.event_published(assessment_event_id)))',
                   v_mark, regexp_replace(v_mark, ', false\)$', ', true)'));
    EXECUTE format('CREATE POLICY student_course_result_select ON student_course_result FOR SELECT TO authenticated USING ((%s) AND (%s OR sims_private.course_result_published(course_registration_id)))',
                   v_course, regexp_replace(v_course, ', false\)$', ', true)'));
    EXECUTE format('CREATE POLICY student_term_result_select ON student_term_result FOR SELECT TO authenticated USING ((%s) AND (%s OR published_at IS NOT NULL))',
                   v_term, regexp_replace(v_term, ', false\)$', ', true)'));
END $$;

-- ---------------------------------------------------------------
-- Integrity guards (apply to every writer)
-- ---------------------------------------------------------------
CREATE FUNCTION sims_assessment_mark_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ev record; v_event_id bigint := COALESCE(NEW.assessment_event_id, OLD.assessment_event_id);
BEGIN
    SELECT status, maximum_marks, reduced_maximum_marks INTO v_ev FROM assessment_event WHERE assessment_event_id = v_event_id;
    IF v_ev IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
    IF v_ev.status IN ('PUBLISHED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Marks of a % assessment event are locked', v_ev.status USING ERRCODE = '45000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.attendance_status <> 'PRESENT' AND (NEW.marks_obtained IS NOT NULL OR NEW.reduced_marks IS NOT NULL) THEN
        RAISE EXCEPTION 'A % entry cannot carry marks', NEW.attendance_status USING ERRCODE = '45000';
    END IF;
    IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained > v_ev.maximum_marks THEN
        RAISE EXCEPTION 'Marks (%) exceed the event maximum (%)', NEW.marks_obtained, v_ev.maximum_marks USING ERRCODE = '45000';
    END IF;
    IF NEW.reduced_marks IS NOT NULL AND (v_ev.reduced_maximum_marks IS NULL OR NEW.reduced_marks > v_ev.reduced_maximum_marks) THEN
        RAISE EXCEPTION 'Reduced marks (%) exceed the reduced maximum (%)', NEW.reduced_marks, COALESCE(v_ev.reduced_maximum_marks::text, 'not set') USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_student_assessment_mark_guard BEFORE INSERT OR UPDATE OR DELETE ON student_assessment_mark FOR EACH ROW EXECUTE FUNCTION sims_assessment_mark_guard();

CREATE FUNCTION sims_assessment_event_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'PUBLISHED' AND OLD.status <> 'PUBLISHED' AND OLD.status <> 'CONDUCTED' THEN
        RAISE EXCEPTION 'An event can be published only after it is CONDUCTED (status is %)', OLD.status USING ERRCODE = '45000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'PUBLISHED' AND NEW.status = 'PUBLISHED'
       AND (NEW.maximum_marks IS DISTINCT FROM OLD.maximum_marks OR NEW.reduced_maximum_marks IS DISTINCT FROM OLD.reduced_maximum_marks) THEN
        RAISE EXCEPTION 'The maximum marks of a PUBLISHED event are locked' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_event_guard BEFORE UPDATE ON assessment_event FOR EACH ROW EXECUTE FUNCTION sims_assessment_event_guard();

CREATE FUNCTION sims_course_result_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reg bigint := COALESCE(NEW.course_registration_id, OLD.course_registration_id);
BEGIN
    IF sims_private.course_result_published(v_reg) THEN
        RAISE EXCEPTION 'The term result is published; unpublish it before changing course results' USING ERRCODE = '45000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_student_course_result_lock BEFORE INSERT OR UPDATE OR DELETE ON student_course_result FOR EACH ROW EXECUTE FUNCTION sims_course_result_lock();

CREATE FUNCTION sims_term_result_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'A published term result cannot be deleted' USING ERRCODE = '45000'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL AND NEW.published_at IS NOT NULL
       AND (NEW.credits_registered, NEW.credits_earned, NEW.sgpa, NEW.cgpa, NEW.result_status) IS DISTINCT FROM (OLD.credits_registered, OLD.credits_earned, OLD.sgpa, OLD.cgpa, OLD.result_status) THEN
        RAISE EXCEPTION 'The term result is published; unpublish it before recomputing' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_student_term_result_lock BEFORE INSERT OR UPDATE OR DELETE ON student_term_result FOR EACH ROW EXECUTE FUNCTION sims_term_result_lock();

-- ---------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------
CREATE TRIGGER trg_assessment_component_audit AFTER INSERT OR UPDATE OR DELETE ON assessment_component FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ASSESSMENT', 'assessment_component_id');
CREATE TRIGGER trg_assessment_event_audit AFTER INSERT OR UPDATE OR DELETE ON assessment_event FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ASSESSMENT', 'assessment_event_id');
CREATE TRIGGER trg_student_assessment_mark_audit AFTER INSERT OR UPDATE OR DELETE ON student_assessment_mark FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ASSESSMENT', 'student_assessment_mark_id');
CREATE TRIGGER trg_grade_scale_audit AFTER INSERT OR UPDATE OR DELETE ON grade_scale FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('RESULT', 'grade_scale_id');
CREATE TRIGGER trg_grade_rule_audit AFTER INSERT OR UPDATE OR DELETE ON grade_rule FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('RESULT', 'grade_rule_id');
CREATE TRIGGER trg_student_course_result_audit AFTER INSERT OR UPDATE OR DELETE ON student_course_result FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('RESULT', 'student_course_result_id');
CREATE TRIGGER trg_student_term_result_audit AFTER INSERT OR UPDATE OR DELETE ON student_term_result FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('RESULT', 'student_term_result_id');

-- ---------------------------------------------------------------
-- Marks entry
-- ---------------------------------------------------------------
CREATE FUNCTION public.assessment_sheet(p_event_id bigint)
RETURNS TABLE (course_registration_id bigint, student_id bigint, student_number text, display_name text, attendance_status text,
               marks_obtained numeric, reduced_marks numeric, remarks text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_off bigint;
BEGIN
    SELECT course_offering_id INTO v_off FROM assessment_event WHERE assessment_event_id = p_event_id;
    IF v_off IS NULL THEN RAISE EXCEPTION 'Not authorised (ASSESSMENT.ALL.READ) or unknown event' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.asm_authorize(v_off, 'ASSESSMENT', 'READ');
    RETURN QUERY
    SELECT cr.course_registration_id, s.student_id, s.student_number::text, s.display_name::text, m.attendance_status::text, m.marks_obtained, m.reduced_marks, m.remarks::text
    FROM student_course_registration cr
    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    LEFT JOIN student_assessment_mark m ON m.assessment_event_id = p_event_id AND m.course_registration_id = cr.course_registration_id
    WHERE cr.course_offering_id = v_off AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
    ORDER BY s.display_name, cr.course_registration_id;
END $$;

-- p_marks = [{"course_registration_id": n, "attendance_status": "PRESENT", "marks_obtained": 12.5, "reduced_marks": null, "remarks": "..."}]
CREATE FUNCTION public.assessment_enter_marks(p_event_id bigint, p_marks jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_ev record; v_prog integer; v_can_update boolean; m jsonb; v_reg bigint; v_att text; v_marks numeric; v_red numeric; v_seen bigint[] := '{}'; v_n integer := 0;
BEGIN
    SELECT assessment_event_id, course_offering_id, status INTO v_ev FROM assessment_event WHERE assessment_event_id = p_event_id FOR UPDATE;
    IF v_ev IS NULL THEN RAISE EXCEPTION 'Not authorised (ASSESSMENT.ALL.CREATE) or unknown event' USING ERRCODE = '42501'; END IF;
    v_prog := sims_private.asm_authorize(v_ev.course_offering_id, 'ASSESSMENT', 'CREATE');
    v_can_update := sims_private.can_programme(ARRAY['ASSESSMENT.ALL.UPDATE']::text[], v_prog);
    IF v_ev.status IN ('PUBLISHED', 'CANCELLED') THEN RAISE EXCEPTION 'Marks of a % event cannot be changed', v_ev.status USING ERRCODE = '45000'; END IF;
    IF p_marks IS NULL OR jsonb_typeof(p_marks) <> 'array' OR jsonb_array_length(p_marks) = 0 OR jsonb_array_length(p_marks) > 1000 THEN
        RAISE EXCEPTION 'p_marks must be a non-empty array of at most 1000 entries' USING ERRCODE = '22023';
    END IF;
    FOR m IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
        v_reg := (m ->> 'course_registration_id')::bigint;
        v_att := COALESCE(NULLIF(m ->> 'attendance_status', ''), 'PRESENT');
        v_marks := NULLIF(m ->> 'marks_obtained', '')::numeric;
        v_red := NULLIF(m ->> 'reduced_marks', '')::numeric;
        IF v_reg IS NULL THEN RAISE EXCEPTION 'Each entry needs course_registration_id' USING ERRCODE = '22023'; END IF;
        IF v_reg = ANY (v_seen) THEN RAISE EXCEPTION 'Duplicate course registration % in the payload', v_reg USING ERRCODE = '22023'; END IF;
        v_seen := v_seen || v_reg;
        IF v_att NOT IN ('PRESENT', 'ABSENT', 'EXEMPTED', 'MALPRACTICE') THEN RAISE EXCEPTION 'Unknown attendance status %', v_att USING ERRCODE = '22023'; END IF;
        IF v_marks IS NOT NULL AND (v_marks < 0 OR v_marks <> round(v_marks, 2)) OR v_red IS NOT NULL AND (v_red < 0 OR v_red <> round(v_red, 2)) THEN
            RAISE EXCEPTION 'Marks must be non-negative with at most 2 decimals' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM student_course_registration WHERE course_registration_id = v_reg AND course_offering_id = v_ev.course_offering_id
                       AND registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')) THEN
            RAISE EXCEPTION 'Course registration % is not an active registration for this course offering', v_reg USING ERRCODE = '45000';
        END IF;
        IF NOT v_can_update AND EXISTS (SELECT 1 FROM student_assessment_mark WHERE assessment_event_id = p_event_id AND course_registration_id = v_reg) THEN
            RAISE EXCEPTION 'Not authorised (ASSESSMENT.ALL.UPDATE) to change marks that are already entered' USING ERRCODE = '42501';
        END IF;
        INSERT INTO student_assessment_mark (assessment_event_id, course_registration_id, course_offering_id, attendance_status, marks_obtained, reduced_marks, remarks, evaluated_at)
        VALUES (p_event_id, v_reg, v_ev.course_offering_id, v_att, v_marks, v_red, NULLIF(btrim(m ->> 'remarks'), ''), now())
        ON CONFLICT (assessment_event_id, course_registration_id)
        DO UPDATE SET attendance_status = EXCLUDED.attendance_status, marks_obtained = EXCLUDED.marks_obtained, reduced_marks = EXCLUDED.reduced_marks,
                      remarks = EXCLUDED.remarks, evaluated_at = now();
        v_n := v_n + 1;
    END LOOP;
    IF v_ev.status = 'PLANNED' THEN UPDATE assessment_event SET status = 'CONDUCTED' WHERE assessment_event_id = p_event_id; END IF;
    RETURN v_n;
END $$;

-- ---------------------------------------------------------------
-- Course results
-- ---------------------------------------------------------------
CREATE FUNCTION public.result_course_sheet(p_course_offering_id bigint)
RETURNS TABLE (course_registration_id bigint, student_id bigint, student_number text, display_name text, internal_marks numeric, external_marks numeric,
               total_marks numeric, grade_letter text, grade_point numeric, result_status text, attempt_number integer, published boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM sims_private.asm_authorize(p_course_offering_id, 'RESULT', 'READ');
    RETURN QUERY
    SELECT cr.course_registration_id, s.student_id, s.student_number::text, s.display_name::text, r.internal_marks, r.external_marks, r.total_marks,
           r.grade_letter::text, r.grade_point, r.result_status::text, r.attempt_number::integer, sims_private.course_result_published(cr.course_registration_id)
    FROM student_course_registration cr
    JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    LEFT JOIN LATERAL (SELECT x.* FROM student_course_result x WHERE x.course_registration_id = cr.course_registration_id ORDER BY x.attempt_number DESC LIMIT 1) r ON true
    WHERE cr.course_offering_id = p_course_offering_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
    ORDER BY s.display_name, cr.course_registration_id;
END $$;

CREATE FUNCTION public.result_record_course(
    p_course_registration_id bigint, p_internal numeric DEFAULT NULL, p_external numeric DEFAULT NULL,
    p_attempt integer DEFAULT 1, p_status text DEFAULT NULL, p_remarks text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_reg record; v_cc record; v_credits numeric; v_scale bigint; v_rule record; v_total numeric; v_pct numeric; v_status text; v_letter text; v_point numeric;
    v_earned numeric := 0; v_existing bigint; v_id bigint;
BEGIN
    SELECT cr.course_offering_id, cr.registration_status, co.curriculum_course_id, co.course_id INTO v_reg
      FROM student_course_registration cr JOIN course_offering co ON co.course_offering_id = cr.course_offering_id WHERE cr.course_registration_id = p_course_registration_id;
    IF v_reg IS NULL THEN RAISE EXCEPTION 'Not authorised (RESULT.ALL.CREATE) or unknown registration' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.asm_authorize(v_reg.course_offering_id, 'RESULT', 'CREATE');
    SELECT student_course_result_id INTO v_existing FROM student_course_result WHERE course_registration_id = p_course_registration_id AND attempt_number = p_attempt;
    IF v_existing IS NOT NULL AND NOT sims_private.can_programme(ARRAY['RESULT.ALL.UPDATE']::text[], sims_private.programme_of_offering(v_reg.course_offering_id)) THEN
        RAISE EXCEPTION 'Not authorised (RESULT.ALL.UPDATE) to change a recorded result' USING ERRCODE = '42501';
    END IF;
    IF v_reg.registration_status NOT IN ('REGISTERED', 'APPROVED', 'COMPLETED') THEN
        RAISE EXCEPTION 'The course registration is %', v_reg.registration_status USING ERRCODE = '45000';
    END IF;
    IF p_attempt IS NULL OR p_attempt < 1 OR p_attempt > 255 THEN RAISE EXCEPTION 'attempt must be from 1 to 255' USING ERRCODE = '22023'; END IF;
    IF p_internal IS NOT NULL AND (p_internal < 0 OR p_internal <> round(p_internal, 2)) OR p_external IS NOT NULL AND (p_external < 0 OR p_external <> round(p_external, 2)) THEN
        RAISE EXCEPTION 'Marks must be non-negative with at most 2 decimals' USING ERRCODE = '22023';
    END IF;
    SELECT credits INTO v_credits FROM course_catalog WHERE course_id = v_reg.course_id;

    IF p_status IS NOT NULL THEN
        IF p_status NOT IN ('ABSENT', 'WITHHELD', 'EXEMPTED', 'INCOMPLETE') THEN
            RAISE EXCEPTION 'p_status may only be ABSENT, WITHHELD, EXEMPTED or INCOMPLETE (PASS/FAIL come from the marks)' USING ERRCODE = '22023';
        END IF;
        v_status := p_status; v_total := NULL; v_letter := NULL; v_point := NULL;
    ELSE
        IF p_internal IS NULL OR p_external IS NULL THEN RAISE EXCEPTION 'Internal and external marks are required (or give an explicit status)' USING ERRCODE = '22023'; END IF;
        IF v_reg.curriculum_course_id IS NULL THEN RAISE EXCEPTION 'This course offering is not linked to a curriculum course, so its maximum marks are unknown' USING ERRCODE = '45000'; END IF;
        SELECT internal_max_marks, external_max_marks, passing_marks INTO v_cc FROM curriculum_course WHERE curriculum_course_id = v_reg.curriculum_course_id;
        IF v_cc.internal_max_marks + v_cc.external_max_marks <= 0 THEN RAISE EXCEPTION 'The curriculum course has no maximum marks defined' USING ERRCODE = '45000'; END IF;
        IF p_internal > v_cc.internal_max_marks THEN RAISE EXCEPTION 'Internal marks (%) exceed the maximum (%)', p_internal, v_cc.internal_max_marks USING ERRCODE = '45000'; END IF;
        IF p_external > v_cc.external_max_marks THEN RAISE EXCEPTION 'External marks (%) exceed the maximum (%)', p_external, v_cc.external_max_marks USING ERRCODE = '45000'; END IF;
        v_total := p_internal + p_external;
        v_pct := round(100.0 * v_total / (v_cc.internal_max_marks + v_cc.external_max_marks), 2);
        SELECT grade_scale_id INTO v_scale FROM grade_scale WHERE is_active AND effective_from <= current_date AND (effective_to IS NULL OR effective_to >= current_date)
         ORDER BY effective_from DESC, grade_scale_id DESC LIMIT 1;
        IF v_scale IS NULL THEN RAISE EXCEPTION 'No active grade scale is defined' USING ERRCODE = '45000'; END IF;
        SELECT grade_letter, grade_point, result_status INTO v_rule FROM grade_rule WHERE grade_scale_id = v_scale AND v_pct >= minimum_percentage AND v_pct <= maximum_percentage
         ORDER BY minimum_percentage DESC LIMIT 1;
        IF v_rule IS NULL THEN RAISE EXCEPTION 'No grade rule in the active scale covers % percent', v_pct USING ERRCODE = '45000'; END IF;
        v_letter := v_rule.grade_letter; v_point := v_rule.grade_point; v_status := v_rule.result_status;
        IF v_cc.passing_marks IS NOT NULL AND v_total < v_cc.passing_marks THEN v_status := 'FAIL'; END IF;
        IF v_status = 'PASS' THEN v_earned := COALESCE(v_credits, 0); END IF;
    END IF;

    INSERT INTO student_course_result (course_registration_id, attempt_number, internal_marks, external_marks, total_marks, grade_letter, grade_point, credits_earned, result_status, result_date, remarks)
    VALUES (p_course_registration_id, p_attempt, CASE WHEN p_status IS NULL THEN p_internal END, CASE WHEN p_status IS NULL THEN p_external END, v_total, v_letter, v_point, v_earned, v_status, current_date, NULLIF(btrim(p_remarks), ''))
    ON CONFLICT (course_registration_id, attempt_number)
    DO UPDATE SET internal_marks = EXCLUDED.internal_marks, external_marks = EXCLUDED.external_marks, total_marks = EXCLUDED.total_marks, grade_letter = EXCLUDED.grade_letter,
                  grade_point = EXCLUDED.grade_point, credits_earned = EXCLUDED.credits_earned, result_status = EXCLUDED.result_status, result_date = EXCLUDED.result_date, remarks = EXCLUDED.remarks
    RETURNING student_course_result_id INTO v_id;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Term results
-- ---------------------------------------------------------------
CREATE FUNCTION public.result_compute_term(p_term_registration_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tr record; v_prog integer; v_registered numeric; v_earned numeric; v_sgpa numeric; v_cgpa numeric; v_status text; v_missing integer; v_withheld integer; v_failed integer; v_id bigint; v_n integer;
BEGIN
    SELECT tr.enrolment_id, o.programme_id INTO v_tr FROM student_term_registration tr JOIN programme_term_offering o ON o.programme_term_offering_id = tr.programme_term_offering_id
     WHERE tr.term_registration_id = p_term_registration_id;
    IF v_tr IS NULL THEN RAISE EXCEPTION 'Not authorised (RESULT.ALL.CREATE) or unknown registration' USING ERRCODE = '42501'; END IF;
    v_prog := v_tr.programme_id;
    IF NOT sims_private.can_programme(ARRAY['RESULT.ALL.CREATE']::text[], v_prog) THEN RAISE EXCEPTION 'Not authorised (RESULT.ALL.CREATE) or unknown registration' USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM student_term_result WHERE term_registration_id = p_term_registration_id AND published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'The term result is published; unpublish it before recomputing' USING ERRCODE = '45000';
    END IF;

    WITH regs AS (
        SELECT cr.course_registration_id, c.credits, r.result_status, r.credits_earned
        FROM student_course_registration cr
        JOIN course_offering co ON co.course_offering_id = cr.course_offering_id
        JOIN course_catalog c ON c.course_id = co.course_id
        LEFT JOIN LATERAL (SELECT x.result_status, x.credits_earned FROM student_course_result x WHERE x.course_registration_id = cr.course_registration_id ORDER BY x.attempt_number DESC LIMIT 1) r ON true
        WHERE cr.term_registration_id = p_term_registration_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
    )
    SELECT count(*), COALESCE(sum(credits), 0), COALESCE(sum(CASE WHEN result_status = 'PASS' THEN credits_earned ELSE 0 END), 0),
           count(*) FILTER (WHERE result_status IS NULL OR result_status = 'INCOMPLETE'),
           count(*) FILTER (WHERE result_status = 'WITHHELD'),
           count(*) FILTER (WHERE result_status IN ('FAIL', 'ABSENT'))
    INTO v_n, v_registered, v_earned, v_missing, v_withheld, v_failed FROM regs;
    IF v_n = 0 THEN v_status := 'INCOMPLETE';
    ELSIF v_missing > 0 THEN v_status := 'INCOMPLETE';
    ELSIF v_withheld > 0 THEN v_status := 'WITHHELD';
    ELSIF v_failed > 0 THEN v_status := 'FAIL';
    ELSE v_status := 'PASS';
    END IF;

    -- SGPA: this term's latest results, graded courses of GPA-contributing categories, weighted by course credits
    SELECT round(sum(r.grade_point * c.credits) / NULLIF(sum(c.credits), 0), 2) INTO v_sgpa
    FROM student_course_registration cr
    JOIN course_offering co ON co.course_offering_id = cr.course_offering_id JOIN course_catalog c ON c.course_id = co.course_id
    LEFT JOIN curriculum_course cc ON cc.curriculum_course_id = co.curriculum_course_id
    JOIN course_category cat ON cat.course_category_id = COALESCE(cc.course_category_id, c.course_category_id)
    JOIN LATERAL (SELECT x.* FROM student_course_result x WHERE x.course_registration_id = cr.course_registration_id ORDER BY x.attempt_number DESC LIMIT 1) r ON true
    WHERE cr.term_registration_id = p_term_registration_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
      AND cat.contributes_to_gpa AND cat.is_graded AND r.grade_point IS NOT NULL;

    -- CGPA: the latest result per course across the student's enrolment
    SELECT round(sum(t.grade_point * t.credits) / NULLIF(sum(t.credits), 0), 2) INTO v_cgpa FROM (
        SELECT DISTINCT ON (c.course_id) r.grade_point, c.credits
        FROM student_term_registration tr2
        JOIN student_course_registration cr ON cr.term_registration_id = tr2.term_registration_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
        JOIN course_offering co ON co.course_offering_id = cr.course_offering_id JOIN course_catalog c ON c.course_id = co.course_id
        LEFT JOIN curriculum_course cc ON cc.curriculum_course_id = co.curriculum_course_id
        JOIN course_category cat ON cat.course_category_id = COALESCE(cc.course_category_id, c.course_category_id)
        JOIN LATERAL (SELECT x.* FROM student_course_result x WHERE x.course_registration_id = cr.course_registration_id ORDER BY x.attempt_number DESC LIMIT 1) r ON true
        WHERE tr2.enrolment_id = v_tr.enrolment_id AND cat.contributes_to_gpa AND cat.is_graded AND r.grade_point IS NOT NULL
        ORDER BY c.course_id, r.result_date DESC NULLS LAST, r.attempt_number DESC, r.student_course_result_id DESC
    ) t;

    INSERT INTO student_term_result (term_registration_id, credits_registered, credits_earned, sgpa, cgpa, result_status)
    VALUES (p_term_registration_id, v_registered, v_earned, v_sgpa, v_cgpa, v_status)
    ON CONFLICT (term_registration_id)
    DO UPDATE SET credits_registered = EXCLUDED.credits_registered, credits_earned = EXCLUDED.credits_earned, sgpa = EXCLUDED.sgpa, cgpa = EXCLUDED.cgpa, result_status = EXCLUDED.result_status
    RETURNING student_term_result_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.result_publish_term(p_term_registration_id bigint, p_publish boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer; v_tr record;
BEGIN
    SELECT o.programme_id INTO v_prog FROM student_term_registration tr JOIN programme_term_offering o ON o.programme_term_offering_id = tr.programme_term_offering_id WHERE tr.term_registration_id = p_term_registration_id;
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY['RESULT.ALL.PUBLISH']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (RESULT.ALL.PUBLISH) or unknown registration' USING ERRCODE = '42501';
    END IF;
    SELECT result_status, published_at INTO v_tr FROM student_term_result WHERE term_registration_id = p_term_registration_id FOR UPDATE;
    IF v_tr IS NULL THEN RAISE EXCEPTION 'No term result has been computed for this registration' USING ERRCODE = '45000'; END IF;
    IF p_publish THEN
        IF v_tr.published_at IS NOT NULL THEN RETURN; END IF;  -- idempotent replay
        IF v_tr.result_status IN ('INCOMPLETE', 'WITHHELD') THEN RAISE EXCEPTION 'A % term result cannot be published', v_tr.result_status USING ERRCODE = '45000'; END IF;
        UPDATE student_term_result SET published_at = now() WHERE term_registration_id = p_term_registration_id;
    ELSE
        UPDATE student_term_result SET published_at = NULL WHERE term_registration_id = p_term_registration_id;
    END IF;
END $$;

CREATE FUNCTION public.result_term_sheet(p_offering_id bigint)
RETURNS TABLE (term_registration_id bigint, student_id bigint, student_number text, display_name text, credits_registered numeric, credits_earned numeric,
               sgpa numeric, cgpa numeric, result_status text, published_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer;
BEGIN
    SELECT programme_id INTO v_prog FROM programme_term_offering WHERE programme_term_offering_id = p_offering_id;
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY['RESULT.ALL.READ']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (RESULT.ALL.READ) or unknown offering' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT tr.term_registration_id, s.student_id, s.student_number::text, s.display_name::text, r.credits_registered, r.credits_earned, r.sgpa, r.cgpa, r.result_status::text, r.published_at
    FROM student_term_registration tr
    JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    LEFT JOIN student_term_result r ON r.term_registration_id = tr.term_registration_id
    WHERE tr.programme_term_offering_id = p_offering_id AND tr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
    ORDER BY s.display_name, tr.term_registration_id;
END $$;

REVOKE ALL ON FUNCTION public.assessment_sheet(bigint), public.assessment_enter_marks(bigint, jsonb), public.result_course_sheet(bigint),
    public.result_record_course(bigint, numeric, numeric, integer, text, text), public.result_compute_term(bigint), public.result_publish_term(bigint, boolean), public.result_term_sheet(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_sheet(bigint), public.assessment_enter_marks(bigint, jsonb), public.result_course_sheet(bigint),
    public.result_record_course(bigint, numeric, numeric, integer, text, text), public.result_compute_term(bigint), public.result_publish_term(bigint, boolean), public.result_term_sheet(bigint) TO authenticated;
