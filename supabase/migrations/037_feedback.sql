-- Feedback. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * Configuration (categories, questions, choices, questionnaires, items, cycles) stays in the generated global-only reference policies.
--  * feedback_response / feedback_response_item become RPC-only for clients: a submission must be validated against the cycle, the
--    student's registration and the questionnaire, and anonymity must be enforced by the server, never by the browser.
--  * ANONYMITY: for an anonymous questionnaire the response row does NOT carry term_registration_id, and submitted_at is truncated to the
--    day. "Who has already submitted" lives in sims_private.feedback_submission, which clients cannot read and which holds no answers
--    and no link to the response row.
--  * Results are aggregated by feedback_results(); raw free text is only returned together with enough respondents.
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-46):
--  1  A cycle moves SCHEDULED -> OPEN | CANCELLED and OPEN -> CLOSED | CANCELLED; CLOSED and CANCELLED are final. It can open only when its
--     questionnaire is ACTIVE and has items. Submissions are accepted only while OPEN and inside [start_at, end_at].
--  2  A questionnaire's items (and its status) are locked once any of its cycles is OPEN or CLOSED or has responses.
--  3  COURSE questionnaires need a course offering the student is registered in (REGISTERED / APPROVED / COMPLETED) in the cycle's term;
--     FACULTY questionnaires also need an instructor of that offering; other types take neither. One submission per (cycle, term
--     registration, course offering, instructor).
--  4  RATING answers are whole numbers 1..5; SINGLE_CHOICE uses an active choice of the question (its score is recorded); MULTIPLE_CHOICE
--     stores the chosen choice ids comma-separated in text_response (the table allows one row per question); TEXT is 1..2000 characters.
--  5  Result visibility: HIDDEN = global CONFIGURE holders only; ADMIN_ONLY = FEEDBACK read at the course's programme, except the
--     rated instructor; FACULTY = additionally the rated instructor sees their own results; PUBLIC = additionally any signed-in user
--     sees the numeric aggregates (never free text). Feedback not tied to a course offering is visible to global readers only.
--  6  Results are suppressed (counts only) while fewer than 5 responses are visible, for everybody.

CREATE FUNCTION sims_private.feedback_min_responses() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;
CREATE FUNCTION sims_private.feedback_rating_max() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- ---------------------------------------------------------------
-- Who has submitted (no answers, no link to the response)
-- ---------------------------------------------------------------
CREATE TABLE sims_private.feedback_submission (
    feedback_cycle_id bigint NOT NULL REFERENCES public.feedback_cycle(feedback_cycle_id),
    term_registration_id bigint NOT NULL REFERENCES public.student_term_registration(term_registration_id),
    course_offering_id bigint NOT NULL DEFAULT 0,
    faculty_assignment_id bigint NOT NULL DEFAULT 0,
    submitted_on date NOT NULL DEFAULT current_date,
    PRIMARY KEY (feedback_cycle_id, term_registration_id, course_offering_id, faculty_assignment_id)
);
ALTER TABLE sims_private.feedback_submission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sims_private.feedback_submission FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- Clients can no longer write responses directly
-- ---------------------------------------------------------------
DROP POLICY feedback_response_insert ON feedback_response;
DROP POLICY feedback_response_update ON feedback_response;
DROP POLICY feedback_response_delete ON feedback_response;
DROP POLICY feedback_response_item_insert ON feedback_response_item;
DROP POLICY feedback_response_item_update ON feedback_response_item;
DROP POLICY feedback_response_item_delete ON feedback_response_item;
REVOKE INSERT, UPDATE, DELETE ON feedback_response, feedback_response_item FROM authenticated;

-- ---------------------------------------------------------------
-- Configuration guards
-- ---------------------------------------------------------------
CREATE FUNCTION sims_feedback_cycle_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q record; v_items integer;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status <> NEW.status AND NOT (
               (OLD.status = 'SCHEDULED' AND NEW.status IN ('OPEN', 'CANCELLED')) OR (OLD.status = 'OPEN' AND NEW.status IN ('CLOSED', 'CANCELLED'))) THEN
            RAISE EXCEPTION 'A % feedback cycle cannot become %', OLD.status, NEW.status USING ERRCODE = '45000';
        END IF;
        IF OLD.status IN ('CLOSED', 'CANCELLED') AND (NEW.questionnaire_id, NEW.academic_term_id, NEW.start_at, NEW.end_at) IS DISTINCT FROM (OLD.questionnaire_id, OLD.academic_term_id, OLD.start_at, OLD.end_at) THEN
            RAISE EXCEPTION 'A % feedback cycle cannot be changed', OLD.status USING ERRCODE = '45000';
        END IF;
        IF OLD.status <> 'SCHEDULED' AND NEW.questionnaire_id <> OLD.questionnaire_id THEN
            RAISE EXCEPTION 'The questionnaire of a cycle that has opened cannot be changed' USING ERRCODE = '45000';
        END IF;
        IF EXISTS (SELECT 1 FROM feedback_response WHERE feedback_cycle_id = OLD.feedback_cycle_id) AND NEW.academic_term_id <> OLD.academic_term_id THEN
            RAISE EXCEPTION 'The term of a cycle with responses cannot be changed' USING ERRCODE = '45000';
        END IF;
    END IF;
    IF NEW.status = 'OPEN' AND (TG_OP = 'INSERT' OR OLD.status <> 'OPEN') THEN
        SELECT status INTO v_q FROM feedback_questionnaire WHERE questionnaire_id = NEW.questionnaire_id;
        SELECT count(*) INTO v_items FROM feedback_questionnaire_item WHERE questionnaire_id = NEW.questionnaire_id;
        IF v_q.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Only a cycle with an ACTIVE questionnaire can be opened' USING ERRCODE = '45000'; END IF;
        IF v_items = 0 THEN RAISE EXCEPTION 'The questionnaire has no questions' USING ERRCODE = '45000'; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_feedback_cycle_guard BEFORE INSERT OR UPDATE ON feedback_cycle FOR EACH ROW EXECUTE FUNCTION sims_feedback_cycle_guard();

CREATE FUNCTION sims_private.feedback_questionnaire_locked(p_questionnaire_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM feedback_cycle c WHERE c.questionnaire_id = p_questionnaire_id
                   AND (c.status IN ('OPEN', 'CLOSED') OR EXISTS (SELECT 1 FROM feedback_response r WHERE r.feedback_cycle_id = c.feedback_cycle_id)))
$$;

CREATE FUNCTION sims_feedback_item_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF sims_private.feedback_questionnaire_locked(CASE WHEN TG_OP = 'DELETE' THEN OLD.questionnaire_id ELSE NEW.questionnaire_id END)
       OR (TG_OP = 'UPDATE' AND NEW.questionnaire_id <> OLD.questionnaire_id AND sims_private.feedback_questionnaire_locked(OLD.questionnaire_id)) THEN
        RAISE EXCEPTION 'The questions of a questionnaire used by an open or closed cycle (or with responses) cannot be changed' USING ERRCODE = '45000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_feedback_item_guard BEFORE INSERT OR UPDATE OR DELETE ON feedback_questionnaire_item FOR EACH ROW EXECUTE FUNCTION sims_feedback_item_guard();

CREATE FUNCTION sims_feedback_questionnaire_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF (NEW.status, NEW.is_anonymous, NEW.questionnaire_type) IS DISTINCT FROM (OLD.status, OLD.is_anonymous, OLD.questionnaire_type)
       AND sims_private.feedback_questionnaire_locked(OLD.questionnaire_id) AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND NEW.is_anonymous = OLD.is_anonymous AND NEW.questionnaire_type = OLD.questionnaire_type) THEN
        RAISE EXCEPTION 'The status, type and anonymity of a questionnaire used by an open or closed cycle (or with responses) cannot be changed, except retiring it' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_feedback_questionnaire_guard BEFORE UPDATE ON feedback_questionnaire FOR EACH ROW EXECUTE FUNCTION sims_feedback_questionnaire_guard();

CREATE TRIGGER trg_feedback_cycle_audit AFTER INSERT OR UPDATE OR DELETE ON feedback_cycle FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('FEEDBACK', 'feedback_cycle_id');
CREATE TRIGGER trg_feedback_questionnaire_audit AFTER INSERT OR UPDATE OR DELETE ON feedback_questionnaire FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('FEEDBACK', 'questionnaire_id');
CREATE TRIGGER trg_feedback_questionnaire_item_audit AFTER INSERT OR UPDATE OR DELETE ON feedback_questionnaire_item FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('FEEDBACK', 'questionnaire_item_id');
CREATE TRIGGER trg_feedback_question_audit AFTER INSERT OR UPDATE OR DELETE ON feedback_question FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('FEEDBACK', 'feedback_question_id');
CREATE TRIGGER trg_feedback_choice_audit AFTER INSERT OR UPDATE OR DELETE ON feedback_choice FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('FEEDBACK', 'feedback_choice_id');

-- ---------------------------------------------------------------
-- Student side
-- ---------------------------------------------------------------
-- The feedback the signed-in student can give now (open cycles in terms they are registered in) and whether they already did.
CREATE FUNCTION public.feedback_my_tasks()
RETURNS TABLE (feedback_cycle_id bigint, cycle_name text, questionnaire_type text, is_anonymous boolean, end_at timestamptz,
               course_offering_id bigint, course_label text, faculty_assignment_id bigint, instructor_name text, submitted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_student_id() AS sid),
    cyc AS (
        SELECT c.feedback_cycle_id, c.cycle_name, c.academic_term_id, c.end_at, q.questionnaire_type, q.is_anonymous
        FROM feedback_cycle c JOIN feedback_questionnaire q ON q.questionnaire_id = c.questionnaire_id
        WHERE c.status = 'OPEN' AND now() >= c.start_at AND now() <= c.end_at AND q.status = 'ACTIVE'
    ),
    trs AS (
        SELECT tr.term_registration_id, pto.academic_term_id
        FROM student_term_registration tr
        JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
        JOIN programme_term_offering pto ON pto.programme_term_offering_id = tr.programme_term_offering_id
        WHERE e.student_id = (SELECT sid FROM me) AND tr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
    ),
    targets AS (
        -- COURSE: one task per registered course
        SELECT cyc.feedback_cycle_id, trs.term_registration_id, cr.course_offering_id, NULL::bigint AS faculty_assignment_id
        FROM cyc JOIN trs ON trs.academic_term_id = cyc.academic_term_id
        JOIN student_course_registration cr ON cr.term_registration_id = trs.term_registration_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
        WHERE cyc.questionnaire_type = 'COURSE'
        UNION ALL
        -- FACULTY: one task per active instructor of each registered course
        SELECT cyc.feedback_cycle_id, trs.term_registration_id, cr.course_offering_id, fa.faculty_assignment_id
        FROM cyc JOIN trs ON trs.academic_term_id = cyc.academic_term_id
        JOIN student_course_registration cr ON cr.term_registration_id = trs.term_registration_id AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
        JOIN course_offering_section cos ON cos.course_offering_id = cr.course_offering_id
        JOIN faculty_course_assignment fa ON fa.course_offering_section_id = cos.course_offering_section_id AND fa.assignment_status IN ('ACTIVE', 'COMPLETED')
        WHERE cyc.questionnaire_type = 'FACULTY'
        UNION ALL
        -- other types: one task per cycle (the student's most recent registration in the term)
        (SELECT DISTINCT ON (cyc.feedback_cycle_id) cyc.feedback_cycle_id, trs.term_registration_id, NULL::bigint, NULL::bigint
         FROM cyc JOIN trs ON trs.academic_term_id = cyc.academic_term_id
         WHERE cyc.questionnaire_type NOT IN ('COURSE', 'FACULTY') ORDER BY cyc.feedback_cycle_id, trs.term_registration_id DESC)
    )
    SELECT DISTINCT ON (cyc.feedback_cycle_id, t.course_offering_id, t.faculty_assignment_id)
           cyc.feedback_cycle_id, cyc.cycle_name::text, cyc.questionnaire_type::text, cyc.is_anonymous, cyc.end_at,
           t.course_offering_id, (cc.course_code || ' — ' || cc.course_title)::text, t.faculty_assignment_id, emp.display_name::text,
           EXISTS (SELECT 1 FROM sims_private.feedback_submission s WHERE s.feedback_cycle_id = t.feedback_cycle_id AND s.term_registration_id = t.term_registration_id
                   AND s.course_offering_id = COALESCE(t.course_offering_id, 0) AND s.faculty_assignment_id = COALESCE(t.faculty_assignment_id, 0))
    FROM targets t
    JOIN cyc ON cyc.feedback_cycle_id = t.feedback_cycle_id
    LEFT JOIN course_offering co ON co.course_offering_id = t.course_offering_id
    LEFT JOIN course_catalog cc ON cc.course_id = co.course_id
    LEFT JOIN faculty_course_assignment fa ON fa.faculty_assignment_id = t.faculty_assignment_id
    LEFT JOIN employee emp ON emp.employee_id = fa.employee_id
    WHERE (SELECT sid FROM me) IS NOT NULL
    ORDER BY cyc.feedback_cycle_id, t.course_offering_id, t.faculty_assignment_id
$$;

-- p_answers = [{"questionnaire_item_id": n, "choice_id": n | "choice_ids": [n,...] | "score": n | "text": "..."}]
-- Returns a receipt token. For an anonymous questionnaire the token is the only trace of the response the student keeps.
CREATE FUNCTION public.feedback_submit(p_cycle_id bigint, p_course_offering_id bigint, p_faculty_assignment_id bigint, p_answers jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_student bigint := sims_private.current_student_id(); v_cycle record; v_tr bigint; v_resp bigint; v_token text := gen_random_uuid()::text;
    v_item record; a jsonb; v_seen bigint[] := '{}'; v_id bigint; v_choice record; v_score numeric; v_text text; v_choice_id bigint; v_ids bigint[]; v_n integer;
BEGIN
    IF v_student IS NULL THEN RAISE EXCEPTION 'Only students can submit feedback' USING ERRCODE = '42501'; END IF;
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) > 200 THEN RAISE EXCEPTION 'p_answers must be an array of at most 200 answers' USING ERRCODE = '22023'; END IF;

    SELECT c.feedback_cycle_id, c.academic_term_id, c.status, c.start_at, c.end_at, q.questionnaire_id, q.questionnaire_type, q.is_anonymous, q.status AS q_status
    INTO v_cycle FROM feedback_cycle c JOIN feedback_questionnaire q ON q.questionnaire_id = c.questionnaire_id WHERE c.feedback_cycle_id = p_cycle_id;
    IF v_cycle IS NULL THEN RAISE EXCEPTION 'Unknown feedback cycle' USING ERRCODE = '45000'; END IF;
    IF v_cycle.status <> 'OPEN' OR now() < v_cycle.start_at OR now() > v_cycle.end_at OR v_cycle.q_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'This feedback cycle is not open for responses' USING ERRCODE = '45000';
    END IF;

    IF v_cycle.questionnaire_type IN ('COURSE', 'FACULTY') THEN
        IF p_course_offering_id IS NULL THEN RAISE EXCEPTION 'A course is required for this feedback' USING ERRCODE = '22023'; END IF;
        SELECT tr.term_registration_id INTO v_tr
        FROM student_course_registration cr
        JOIN student_term_registration tr ON tr.term_registration_id = cr.term_registration_id
        JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
        JOIN programme_term_offering pto ON pto.programme_term_offering_id = tr.programme_term_offering_id
        WHERE e.student_id = v_student AND cr.course_offering_id = p_course_offering_id AND pto.academic_term_id = v_cycle.academic_term_id
          AND cr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED') AND tr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
        ORDER BY tr.term_registration_id DESC LIMIT 1;
        IF v_tr IS NULL THEN RAISE EXCEPTION 'You are not registered for that course in this cycle''s term' USING ERRCODE = '45000'; END IF;
        IF v_cycle.questionnaire_type = 'FACULTY' THEN
            IF p_faculty_assignment_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM faculty_course_assignment fa JOIN course_offering_section cos ON cos.course_offering_section_id = fa.course_offering_section_id
                WHERE fa.faculty_assignment_id = p_faculty_assignment_id AND cos.course_offering_id = p_course_offering_id AND fa.assignment_status IN ('ACTIVE', 'COMPLETED')) THEN
                RAISE EXCEPTION 'That instructor does not teach this course' USING ERRCODE = '45000';
            END IF;
        ELSIF p_faculty_assignment_id IS NOT NULL THEN
            RAISE EXCEPTION 'This feedback is not about an instructor' USING ERRCODE = '22023';
        END IF;
    ELSE
        IF p_course_offering_id IS NOT NULL OR p_faculty_assignment_id IS NOT NULL THEN RAISE EXCEPTION 'This feedback is not about a course or an instructor' USING ERRCODE = '22023'; END IF;
        SELECT tr.term_registration_id INTO v_tr
        FROM student_term_registration tr JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
        JOIN programme_term_offering pto ON pto.programme_term_offering_id = tr.programme_term_offering_id
        WHERE e.student_id = v_student AND pto.academic_term_id = v_cycle.academic_term_id AND tr.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
        ORDER BY tr.term_registration_id DESC LIMIT 1;
        IF v_tr IS NULL THEN RAISE EXCEPTION 'You are not registered in this cycle''s term' USING ERRCODE = '45000'; END IF;
    END IF;

    -- One submission per (cycle, registration, course, instructor); the primary key is the arbiter under concurrency.
    BEGIN
        INSERT INTO sims_private.feedback_submission (feedback_cycle_id, term_registration_id, course_offering_id, faculty_assignment_id)
        VALUES (p_cycle_id, v_tr, COALESCE(p_course_offering_id, 0), COALESCE(p_faculty_assignment_id, 0));
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You have already submitted this feedback' USING ERRCODE = '45000';
    END;

    INSERT INTO feedback_response (feedback_cycle_id, term_registration_id, course_offering_id, faculty_assignment_id, submitted_at, response_token)
    VALUES (p_cycle_id, CASE WHEN v_cycle.is_anonymous THEN NULL ELSE v_tr END, p_course_offering_id, p_faculty_assignment_id,
            CASE WHEN v_cycle.is_anonymous THEN date_trunc('day', now()) ELSE now() END, v_token)
    RETURNING feedback_response_id INTO v_resp;

    FOR a IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
        IF jsonb_typeof(a) <> 'object' OR (a ->> 'questionnaire_item_id') !~ '^[0-9]{1,15}$' THEN RAISE EXCEPTION 'Invalid answer: %', left(a::text, 100) USING ERRCODE = '22023'; END IF;
        v_id := (a ->> 'questionnaire_item_id')::bigint;
        IF v_id = ANY (v_seen) THEN RAISE EXCEPTION 'A question was answered twice' USING ERRCODE = '22023'; END IF;
        v_seen := v_seen || v_id;
        SELECT i.questionnaire_item_id, i.is_required, q.response_type, q.feedback_question_id INTO v_item
        FROM feedback_questionnaire_item i JOIN feedback_question q ON q.feedback_question_id = i.feedback_question_id
        WHERE i.questionnaire_item_id = v_id AND i.questionnaire_id = v_cycle.questionnaire_id;
        IF v_item IS NULL THEN RAISE EXCEPTION 'Question % is not part of this questionnaire', v_id USING ERRCODE = '22023'; END IF;

        v_score := NULL; v_text := NULL; v_choice_id := NULL;
        IF v_item.response_type = 'RATING' THEN
            IF (a ->> 'score') !~ '^[0-9]{1,2}$' OR (a ->> 'score')::int < 1 OR (a ->> 'score')::int > sims_private.feedback_rating_max() THEN
                RAISE EXCEPTION 'A rating must be a whole number from 1 to %', sims_private.feedback_rating_max() USING ERRCODE = '22023';
            END IF;
            v_score := (a ->> 'score')::numeric;
        ELSIF v_item.response_type = 'SINGLE_CHOICE' THEN
            IF (a ->> 'choice_id') !~ '^[0-9]{1,15}$' THEN RAISE EXCEPTION 'Choose an option for every answered choice question' USING ERRCODE = '22023'; END IF;
            SELECT feedback_choice_id, score INTO v_choice FROM feedback_choice WHERE feedback_choice_id = (a ->> 'choice_id')::bigint AND feedback_question_id = v_item.feedback_question_id AND is_active;
            IF v_choice IS NULL THEN RAISE EXCEPTION 'That option does not belong to the question' USING ERRCODE = '22023'; END IF;
            v_choice_id := v_choice.feedback_choice_id; v_score := v_choice.score;
        ELSIF v_item.response_type = 'MULTIPLE_CHOICE' THEN
            IF jsonb_typeof(a -> 'choice_ids') <> 'array' OR jsonb_array_length(a -> 'choice_ids') = 0 OR jsonb_array_length(a -> 'choice_ids') > 50 THEN RAISE EXCEPTION 'Choose at least one option' USING ERRCODE = '22023'; END IF;
            SELECT array_agg(DISTINCT x::bigint ORDER BY x::bigint) INTO v_ids FROM jsonb_array_elements_text(a -> 'choice_ids') x WHERE x ~ '^[0-9]{1,15}$';
            SELECT count(*) INTO v_n FROM feedback_choice WHERE feedback_choice_id = ANY (v_ids) AND feedback_question_id = v_item.feedback_question_id AND is_active;
            IF v_ids IS NULL OR v_n <> cardinality(v_ids) OR cardinality(v_ids) <> jsonb_array_length(a -> 'choice_ids') THEN RAISE EXCEPTION 'Some chosen options do not belong to the question' USING ERRCODE = '22023'; END IF;
            v_text := array_to_string(v_ids, ',');
        ELSE
            v_text := btrim(a ->> 'text');
            IF v_text IS NULL OR v_text = '' OR length(v_text) > 2000 THEN RAISE EXCEPTION 'A written answer must be 1 to 2000 characters' USING ERRCODE = '22023'; END IF;
        END IF;
        INSERT INTO feedback_response_item (feedback_response_id, questionnaire_item_id, feedback_choice_id, numeric_score, text_response)
        VALUES (v_resp, v_id, v_choice_id, v_score, v_text);
    END LOOP;

    IF EXISTS (SELECT 1 FROM feedback_questionnaire_item i WHERE i.questionnaire_id = v_cycle.questionnaire_id AND i.is_required AND NOT (i.questionnaire_item_id = ANY (v_seen))) THEN
        RAISE EXCEPTION 'Please answer every required question' USING ERRCODE = '22023';
    END IF;
    RETURN v_token;
END $$;

-- The questions of a cycle's questionnaire with their choices. SECURITY INVOKER: the configuration tables are readable by every active member.
CREATE FUNCTION public.feedback_form(p_cycle_id bigint)
RETURNS TABLE (questionnaire_item_id bigint, display_order integer, is_required boolean, question_text text, response_type text, category_name text, choices jsonb)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT i.questionnaire_item_id::bigint, i.display_order::integer, i.is_required, q.question_text::text, q.response_type::text, k.category_name::text,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.feedback_choice_id, 'text', c.choice_text) ORDER BY c.display_order NULLS LAST, c.feedback_choice_id)
                     FROM feedback_choice c WHERE c.feedback_question_id = q.feedback_question_id AND c.is_active), '[]'::jsonb)
    FROM feedback_cycle cy
    JOIN feedback_questionnaire_item i ON i.questionnaire_id = cy.questionnaire_id
    JOIN feedback_question q ON q.feedback_question_id = i.feedback_question_id
    JOIN feedback_question_category k ON k.feedback_category_id = q.feedback_category_id
    WHERE cy.feedback_cycle_id = p_cycle_id ORDER BY i.display_order, i.questionnaire_item_id
$$;

-- ---------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------
-- Offerings of the cycle's term whose results the caller may open, with the number of responses (a count only).
CREATE FUNCTION public.feedback_cycle_offerings(p_cycle_id bigint)
RETURNS TABLE (course_offering_id bigint, course_label text, programme_name text, responses bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT co.course_offering_id::bigint, (cc.course_code || ' — ' || cc.course_title)::text, p.programme_name::text,
           (SELECT count(*) FROM feedback_response r WHERE r.feedback_cycle_id = p_cycle_id AND r.course_offering_id = co.course_offering_id)
    FROM feedback_cycle cy
    JOIN programme_term_offering pto ON pto.academic_term_id = cy.academic_term_id
    JOIN course_offering co ON co.programme_term_offering_id = pto.programme_term_offering_id
    JOIN course_catalog cc ON cc.course_id = co.course_id
    JOIN programme p ON p.programme_id = pto.programme_id
    WHERE cy.feedback_cycle_id = p_cycle_id AND cy.result_visibility <> 'HIDDEN'
      AND sims_private.can_programme(ARRAY['FEEDBACK.ALL.READ']::text[], pto.programme_id)
    ORDER BY cc.course_code, co.course_offering_id
$$;

-- Aggregated results of one cycle, optionally for one course offering (see assumptions 5 and 6 in the header).
CREATE FUNCTION public.feedback_results(p_cycle_id bigint, p_course_offering_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cycle record; v_emp bigint := sims_private.current_employee_id(); v_gl boolean := sims_private.can_global(ARRAY['FEEDBACK.ALL.CONFIGURE']::text[]);
    v_glread boolean := sims_private.can_global(ARRAY['FEEDBACK.ALL.READ']::text[]); v_member boolean := sims_private.is_active_member();
    v_visible bigint[]; v_full bigint[]; v_count integer; v_out jsonb;
BEGIN
    SELECT c.feedback_cycle_id, c.cycle_name, c.result_visibility AS vis, c.status, q.questionnaire_id, q.questionnaire_type, q.is_anonymous
    INTO v_cycle FROM feedback_cycle c JOIN feedback_questionnaire q ON q.questionnaire_id = c.questionnaire_id WHERE c.feedback_cycle_id = p_cycle_id;
    IF v_cycle IS NULL OR NOT v_member THEN RAISE EXCEPTION 'Not authorised (FEEDBACK.ALL.READ) or unknown cycle' USING ERRCODE = '42501'; END IF;

    WITH r AS (
        SELECT fr.feedback_response_id,
               EXISTS (SELECT 1 FROM faculty_course_assignment fa WHERE fa.faculty_assignment_id = fr.faculty_assignment_id AND fa.employee_id = v_emp) AS own,
               (fr.course_offering_id IS NOT NULL AND sims_private.can_programme(ARRAY['FEEDBACK.ALL.READ']::text[], sims_private.programme_of_offering(fr.course_offering_id))) AS prog_read
        FROM feedback_response fr
        WHERE fr.feedback_cycle_id = p_cycle_id AND (p_course_offering_id IS NULL OR fr.course_offering_id = p_course_offering_id)
    ), f AS (
        SELECT r.feedback_response_id,
               (v_gl OR (v_cycle.vis <> 'HIDDEN' AND (r.prog_read OR v_glread) AND (NOT r.own OR v_cycle.vis IN ('FACULTY', 'PUBLIC')))
                     OR (v_cycle.vis IN ('FACULTY', 'PUBLIC') AND r.own)) AS full_access
        FROM r
    )
    SELECT array_agg(feedback_response_id) FILTER (WHERE full_access OR v_cycle.vis = 'PUBLIC'), array_agg(feedback_response_id) FILTER (WHERE full_access)
    INTO v_visible, v_full FROM f;
    v_visible := COALESCE(v_visible, '{}'); v_full := COALESCE(v_full, '{}');
    v_count := cardinality(v_visible);

    IF v_count < sims_private.feedback_min_responses() THEN
        RETURN jsonb_build_object('cycle_name', v_cycle.cycle_name, 'visibility', v_cycle.vis, 'questionnaire_type', v_cycle.questionnaire_type, 'anonymous', v_cycle.is_anonymous,
                                  'response_count', v_count, 'suppressed', true, 'minimum', sims_private.feedback_min_responses(), 'questions', '[]'::jsonb);
    END IF;

    SELECT jsonb_build_object('cycle_name', v_cycle.cycle_name, 'visibility', v_cycle.vis, 'questionnaire_type', v_cycle.questionnaire_type, 'anonymous', v_cycle.is_anonymous,
                              'response_count', v_count, 'suppressed', false, 'minimum', sims_private.feedback_min_responses(),
        'questions', COALESCE(jsonb_agg(jsonb_build_object(
            'questionnaire_item_id', i.questionnaire_item_id, 'question_text', q.question_text, 'response_type', q.response_type,
            'answered', (SELECT count(*) FROM feedback_response_item x WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_visible)),
            'average', (SELECT round(avg(x.numeric_score), 2) FROM feedback_response_item x WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_visible) AND x.numeric_score IS NOT NULL),
            'distribution', CASE q.response_type
                WHEN 'RATING' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('label', s.score::text, 'count', s.n) ORDER BY s.score)
                    FROM (SELECT x.numeric_score AS score, count(*) AS n FROM feedback_response_item x WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_visible) GROUP BY x.numeric_score) s), '[]'::jsonb)
                WHEN 'SINGLE_CHOICE' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('label', s.choice_text, 'count', s.n) ORDER BY s.n DESC, s.choice_text)
                    FROM (SELECT c.choice_text, count(*) AS n FROM feedback_response_item x JOIN feedback_choice c ON c.feedback_choice_id = x.feedback_choice_id
                          WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_visible) GROUP BY c.choice_text) s), '[]'::jsonb)
                WHEN 'MULTIPLE_CHOICE' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('label', s.choice_text, 'count', s.n) ORDER BY s.n DESC, s.choice_text)
                    FROM (SELECT c.choice_text, count(*) AS n FROM feedback_response_item x
                          CROSS JOIN LATERAL unnest(string_to_array(x.text_response, ',')) AS sel(id)
                          JOIN feedback_choice c ON c.feedback_choice_id = sel.id::bigint
                          WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_visible) GROUP BY c.choice_text) s), '[]'::jsonb)
                ELSE '[]'::jsonb END,
            'texts', CASE q.response_type WHEN 'TEXT' THEN COALESCE((SELECT jsonb_agg(x.text_response ORDER BY x.feedback_response_item_id)
                    FROM feedback_response_item x WHERE x.questionnaire_item_id = i.questionnaire_item_id AND x.feedback_response_id = ANY (v_full) AND x.text_response IS NOT NULL), '[]'::jsonb) ELSE '[]'::jsonb END
        ) ORDER BY i.display_order, i.questionnaire_item_id), '[]'::jsonb))
    INTO v_out
    FROM feedback_questionnaire_item i JOIN feedback_question q ON q.feedback_question_id = i.feedback_question_id
    WHERE i.questionnaire_id = v_cycle.questionnaire_id;
    RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.feedback_my_tasks(), public.feedback_submit(bigint, bigint, bigint, jsonb), public.feedback_form(bigint),
    public.feedback_cycle_offerings(bigint), public.feedback_results(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_my_tasks(), public.feedback_submit(bigint, bigint, bigint, jsonb), public.feedback_form(bigint),
    public.feedback_cycle_offerings(bigint), public.feedback_results(bigint, bigint) TO authenticated;
REVOKE ALL ON FUNCTION sims_private.feedback_questionnaire_locked(bigint), sims_private.feedback_min_responses(), sims_private.feedback_rating_max() FROM PUBLIC, anon;
