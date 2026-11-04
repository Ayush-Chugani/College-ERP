-- Read helpers for the registration screens. Hand-written (not from the MySQL source).
-- Registration staff need student names and eligible enrolments, which live in other modules (STUDENT / ADMISSION) that a registration
-- user may not be allowed to read directly. These functions return ONLY what the registration screens need, for ONE offering,
-- authorised by REGISTRATION permissions at the offering's programme scope.

CREATE FUNCTION public.registration_roster(p_offering_id bigint)
RETURNS TABLE (term_registration_id bigint, enrolment_id bigint, student_id bigint, student_number text, display_name text,
               roll_number text, class_section_id bigint, class_batch_id bigint, registration_date date, registration_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer;
BEGIN
    SELECT programme_id INTO v_prog FROM programme_term_offering WHERE programme_term_offering_id = p_offering_id;
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY['REGISTRATION.ALL.READ']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (REGISTRATION.ALL.READ) or unknown offering' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT r.term_registration_id, r.enrolment_id::bigint, s.student_id, s.student_number::text, s.display_name::text,
           r.roll_number::text, r.class_section_id::bigint, r.class_batch_id::bigint, r.registration_date, r.registration_status::text
    FROM student_term_registration r
    JOIN student_programme_enrolment e ON e.enrolment_id = r.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    WHERE r.programme_term_offering_id = p_offering_id
    ORDER BY s.display_name, r.term_registration_id;
END $$;

CREATE FUNCTION public.registration_term_info(p_term_registration_id bigint)
RETURNS TABLE (term_registration_id bigint, enrolment_id bigint, student_id bigint, student_number text, display_name text,
               programme_term_offering_id bigint, class_section_id bigint, class_batch_id bigint, roll_number text, registration_date date, registration_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer;
BEGIN
    SELECT o.programme_id INTO v_prog FROM student_term_registration r JOIN programme_term_offering o ON o.programme_term_offering_id = r.programme_term_offering_id
     WHERE r.term_registration_id = p_term_registration_id;
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY['REGISTRATION.ALL.READ']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (REGISTRATION.ALL.READ) or unknown registration' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT r.term_registration_id, r.enrolment_id::bigint, s.student_id, s.student_number::text, s.display_name::text, r.programme_term_offering_id::bigint,
           r.class_section_id::bigint, r.class_batch_id::bigint, r.roll_number::text, r.registration_date, r.registration_status::text
    FROM student_term_registration r
    JOIN student_programme_enrolment e ON e.enrolment_id = r.enrolment_id
    JOIN student s ON s.student_id = e.student_id
    WHERE r.term_registration_id = p_term_registration_id;
END $$;

-- ACTIVE enrolments of the offering's programme (and specialisation) that are not yet registered for it; at most 50, optional name/number search
CREATE FUNCTION public.registration_candidates(p_offering_id bigint, p_q text DEFAULT NULL)
RETURNS TABLE (enrolment_id bigint, student_id bigint, student_number text, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_off record; v_q text := NULLIF(btrim(p_q), '');
BEGIN
    SELECT programme_id, specialization_id INTO v_off FROM programme_term_offering WHERE programme_term_offering_id = p_offering_id;
    IF v_off IS NULL OR NOT sims_private.can_programme(ARRAY['REGISTRATION.ALL.CREATE']::text[], v_off.programme_id) THEN
        RAISE EXCEPTION 'Not authorised (REGISTRATION.ALL.CREATE) or unknown offering' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT e.enrolment_id::bigint, s.student_id, s.student_number::text, s.display_name::text
    FROM student_programme_enrolment e JOIN student s ON s.student_id = e.student_id
    WHERE e.programme_id = v_off.programme_id AND e.enrolment_status = 'ACTIVE'
      AND (v_off.specialization_id IS NULL OR e.specialization_id = v_off.specialization_id)
      AND NOT EXISTS (SELECT 1 FROM student_term_registration r WHERE r.enrolment_id = e.enrolment_id AND r.programme_term_offering_id = p_offering_id)
      AND (v_q IS NULL OR s.display_name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                       OR s.student_number ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    ORDER BY s.display_name
    LIMIT 50;
END $$;

REVOKE ALL ON FUNCTION public.registration_roster(bigint), public.registration_term_info(bigint), public.registration_candidates(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_roster(bigint), public.registration_term_info(bigint), public.registration_candidates(bigint, text) TO authenticated;
