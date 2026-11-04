-- Registration and offering integrity. Hand-written (not from the MySQL source).
--
-- The source defines composite "owner" keys (e.g. uq_course_offering_owner, uq_course_registration_owner) that point at the intent
-- "a registration may only use things belonging to the same programme-term", but does not enforce these two relationships:
--   (a) student_course_registration.course_offering must belong to the same programme_term_offering as its term registration
--   (b) the enrolment behind a term registration must be in the offering's programme (and specialisation, when the offering has one)
-- and it stores capacities without enforcing them. These triggers close the gaps. They are INFERENCES from the schema's intent, flagged
-- in KNOWN_ISSUES (KI-31), and apply to every writer (clients, RPCs and the service role).
--
-- The guards are SECURITY DEFINER: they must see every related row regardless of the caller's read access, otherwise a writer without
-- read access to enrolments would silently skip the check.
-- Capacity checks lock the capacity-bearing row (FOR UPDATE) before counting, so concurrent registrations serialise instead of overbooking.
-- Not enforced (not stated in the source): prerequisites, credit limits, timetable clashes.

CREATE FUNCTION sims_registration_term_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_off record; v_enr record; v_cap integer; v_used integer;
BEGIN
    SELECT programme_id, specialization_id, status INTO v_off FROM programme_term_offering WHERE programme_term_offering_id = NEW.programme_term_offering_id;
    SELECT programme_id, specialization_id, enrolment_status INTO v_enr FROM student_programme_enrolment WHERE enrolment_id = NEW.enrolment_id;
    IF v_off IS NULL OR v_enr IS NULL THEN RETURN NEW; END IF;  -- foreign keys report missing parents

    IF v_enr.programme_id <> v_off.programme_id THEN
        RAISE EXCEPTION 'The student is enrolled in a different programme than this offering' USING ERRCODE = '45000';
    END IF;
    IF v_off.specialization_id IS NOT NULL AND v_enr.specialization_id IS DISTINCT FROM v_off.specialization_id THEN
        RAISE EXCEPTION 'The student is not in the specialisation this offering is for' USING ERRCODE = '45000';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF v_off.status IN ('COMPLETED', 'CANCELLED') THEN
            RAISE EXCEPTION 'This offering is % and no longer accepts registrations', v_off.status USING ERRCODE = '45000';
        END IF;
        IF v_enr.enrolment_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Only students with an ACTIVE enrolment can register (enrolment is %)', v_enr.enrolment_status USING ERRCODE = '45000';
        END IF;
    END IF;

    IF NEW.class_section_id IS NOT NULL AND NEW.registration_status <> 'CANCELLED'
       AND (TG_OP = 'INSERT' OR NEW.class_section_id IS DISTINCT FROM OLD.class_section_id OR OLD.registration_status = 'CANCELLED') THEN
        SELECT capacity INTO v_cap FROM class_section WHERE class_section_id = NEW.class_section_id FOR UPDATE;
        IF v_cap IS NOT NULL THEN
            SELECT count(*) INTO v_used FROM student_term_registration
             WHERE class_section_id = NEW.class_section_id AND registration_status <> 'CANCELLED'
               AND (TG_OP = 'INSERT' OR term_registration_id <> NEW.term_registration_id);
            IF v_used >= v_cap THEN RAISE EXCEPTION 'The section is full (capacity %)', v_cap USING ERRCODE = '45000'; END IF;
        END IF;
    END IF;
    IF NEW.class_batch_id IS NOT NULL AND NEW.registration_status <> 'CANCELLED'
       AND (TG_OP = 'INSERT' OR NEW.class_batch_id IS DISTINCT FROM OLD.class_batch_id OR OLD.registration_status = 'CANCELLED') THEN
        SELECT capacity INTO v_cap FROM class_batch WHERE class_batch_id = NEW.class_batch_id FOR UPDATE;
        IF v_cap IS NOT NULL THEN
            SELECT count(*) INTO v_used FROM student_term_registration
             WHERE class_batch_id = NEW.class_batch_id AND registration_status <> 'CANCELLED'
               AND (TG_OP = 'INSERT' OR term_registration_id <> NEW.term_registration_id);
            IF v_used >= v_cap THEN RAISE EXCEPTION 'The batch is full (capacity %)', v_cap USING ERRCODE = '45000'; END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_term_registration_guard BEFORE INSERT OR UPDATE ON student_term_registration
    FOR EACH ROW EXECUTE FUNCTION sims_registration_term_guard();

CREATE FUNCTION sims_registration_course_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_term record; v_off record; v_used integer;
BEGIN
    SELECT programme_term_offering_id, registration_status INTO v_term FROM student_term_registration WHERE term_registration_id = NEW.term_registration_id;
    SELECT programme_term_offering_id, registration_capacity, status INTO v_off FROM course_offering WHERE course_offering_id = NEW.course_offering_id;
    IF v_term IS NULL OR v_off IS NULL THEN RETURN NEW; END IF;

    IF v_term.programme_term_offering_id <> v_off.programme_term_offering_id THEN
        RAISE EXCEPTION 'The course offering does not belong to the same programme term as the student''s registration' USING ERRCODE = '45000';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF v_term.registration_status IN ('CANCELLED', 'COMPLETED') THEN
            RAISE EXCEPTION 'The term registration is %; courses cannot be added', v_term.registration_status USING ERRCODE = '45000';
        END IF;
        IF v_off.status IN ('COMPLETED', 'CANCELLED') THEN
            RAISE EXCEPTION 'This course offering is % and no longer accepts registrations', v_off.status USING ERRCODE = '45000';
        END IF;
    END IF;

    IF v_off.registration_capacity IS NOT NULL AND NEW.registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
       AND (TG_OP = 'INSERT' OR OLD.registration_status IN ('DROPPED', 'WITHDRAWN') OR NEW.course_offering_id IS DISTINCT FROM OLD.course_offering_id) THEN
        PERFORM 1 FROM course_offering WHERE course_offering_id = NEW.course_offering_id FOR UPDATE;  -- serialise concurrent registrations
        SELECT count(*) INTO v_used FROM student_course_registration
         WHERE course_offering_id = NEW.course_offering_id AND registration_status IN ('REGISTERED', 'APPROVED', 'COMPLETED')
           AND (TG_OP = 'INSERT' OR course_registration_id <> NEW.course_registration_id);
        IF v_used >= v_off.registration_capacity THEN
            RAISE EXCEPTION 'The course offering is full (capacity %)', v_off.registration_capacity USING ERRCODE = '45000';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_course_registration_guard BEFORE INSERT OR UPDATE ON student_course_registration
    FOR EACH ROW EXECUTE FUNCTION sims_registration_course_guard();

-- ---------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------
CREATE TRIGGER trg_programme_term_offering_audit AFTER INSERT OR UPDATE OR DELETE ON programme_term_offering
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('REGISTRATION', 'programme_term_offering_id');
CREATE TRIGGER trg_class_section_audit AFTER INSERT OR UPDATE OR DELETE ON class_section
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('REGISTRATION', 'class_section_id');
CREATE TRIGGER trg_class_batch_audit AFTER INSERT OR UPDATE OR DELETE ON class_batch
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('REGISTRATION', 'class_batch_id');
CREATE TRIGGER trg_course_offering_audit AFTER INSERT OR UPDATE OR DELETE ON course_offering
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('TEACHING', 'course_offering_id');
CREATE TRIGGER trg_student_term_registration_audit AFTER INSERT OR UPDATE OR DELETE ON student_term_registration
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('REGISTRATION', 'term_registration_id');
CREATE TRIGGER trg_student_course_registration_audit AFTER INSERT OR UPDATE OR DELETE ON student_course_registration
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('REGISTRATION', 'course_registration_id');

-- ---------------------------------------------------------------
-- Convenience: create the course offerings for a programme-term from its curriculum scheme.
-- offering_code is generated as '<programme_term_offering_id>-<course_code>' (the source defines no numbering rule; the code stays editable).
-- Idempotent: existing (programme_term, course) pairs are skipped.
-- ---------------------------------------------------------------
CREATE FUNCTION public.offering_generate_courses(p_programme_term_offering_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pto record; v_n integer;
BEGIN
    SELECT programme_id, curriculum_scheme_id, semester_id, status INTO v_pto FROM programme_term_offering WHERE programme_term_offering_id = p_programme_term_offering_id;
    IF v_pto IS NULL OR NOT sims_private.can_programme(ARRAY['TEACHING.ALL.CREATE']::text[], v_pto.programme_id) THEN
        RAISE EXCEPTION 'Not authorised (TEACHING.ALL.CREATE) or unknown offering' USING ERRCODE = '42501';
    END IF;
    IF v_pto.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'The offering is %', v_pto.status USING ERRCODE = '45000';
    END IF;
    INSERT INTO course_offering (programme_term_offering_id, curriculum_course_id, course_id, offering_code)
    SELECT p_programme_term_offering_id, cc.curriculum_course_id, cc.course_id, left(p_programme_term_offering_id || '-' || c.course_code, 50)
    FROM curriculum_course cc JOIN course_catalog c ON c.course_id = cc.course_id
    WHERE cc.curriculum_scheme_id = v_pto.curriculum_scheme_id AND cc.semester_id = v_pto.semester_id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.offering_generate_courses(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offering_generate_courses(bigint) TO authenticated;
