-- Admissions workflow. Hand-written (not from the MySQL source).
--
-- Why this supersedes parts of migration 018:
--   * 018 anchored admission_application to the *admitted student*, which is NULL until someone is admitted, so pre-admission
--     applications were visible to global administrators only. The correct tenancy anchor is the application's PROGRAMME.
--   * admission_applicant has no tenant column; an applicant is visible only through applications in programmes the caller may read.
--   * Writes to both tables are RPC-only (below) so the status workflow cannot be bypassed.
--
-- ASSUMPTION (not stated in the source, which only lists the status values): the allowed status transitions in
-- sims_private.admission_transition_ok(). Permission per target status: SUBMITTED/UNDER_REVIEW/CANCELLED = ADMISSION.ALL.UPDATE,
-- ELIGIBLE/INELIGIBLE = VERIFY, SELECTED/WAITLISTED/REJECTED = APPROVE, ADMITTED only through admission_admit().
-- There is no table linking an applicant to a login, so applicant self-service is not possible with this schema.

-- ---------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.can_see_applicant(p_applicant_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_global(ARRAY['ADMISSION.ALL.READ']::text[])
        OR EXISTS (SELECT 1 FROM public.admission_application a
                   WHERE a.admission_applicant_id = p_applicant_id
                     AND sims_private.can_programme(ARRAY['ADMISSION.ALL.READ']::text[], a.programme_id))
$$;
REVOKE ALL ON FUNCTION sims_private.can_see_applicant(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.can_see_applicant(bigint) TO authenticated, service_role;

DROP POLICY admission_applicant_select ON admission_applicant;
CREATE POLICY admission_applicant_select ON admission_applicant FOR SELECT TO authenticated
    USING (sims_private.can_see_applicant(admission_applicant_id));

DROP POLICY admission_application_select ON admission_application;
DROP POLICY admission_application_insert ON admission_application;
DROP POLICY admission_application_update ON admission_application;
DROP POLICY admission_application_delete ON admission_application;
CREATE POLICY admission_application_select ON admission_application FOR SELECT TO authenticated
    USING (sims_private.can_programme(ARRAY['ADMISSION.ALL.READ']::text[], programme_id));
REVOKE INSERT, UPDATE, DELETE ON admission_application, admission_applicant FROM authenticated;

CREATE TRIGGER trg_admission_applicant_audit AFTER INSERT OR UPDATE OR DELETE ON admission_applicant
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ADMISSION', 'admission_applicant_id');
CREATE TRIGGER trg_admission_application_audit AFTER INSERT OR UPDATE OR DELETE ON admission_application
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ADMISSION', 'application_id');

-- ---------------------------------------------------------------
-- Status workflow (assumed matrix, see header)
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.admission_transition_ok(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_from, p_to) IN (
        ('DRAFT', 'SUBMITTED'), ('DRAFT', 'CANCELLED'),
        ('SUBMITTED', 'UNDER_REVIEW'), ('SUBMITTED', 'REJECTED'), ('SUBMITTED', 'CANCELLED'),
        ('UNDER_REVIEW', 'ELIGIBLE'), ('UNDER_REVIEW', 'INELIGIBLE'), ('UNDER_REVIEW', 'REJECTED'), ('UNDER_REVIEW', 'CANCELLED'),
        ('ELIGIBLE', 'SELECTED'), ('ELIGIBLE', 'WAITLISTED'), ('ELIGIBLE', 'REJECTED'), ('ELIGIBLE', 'CANCELLED'),
        ('INELIGIBLE', 'REJECTED'), ('INELIGIBLE', 'CANCELLED'),
        ('WAITLISTED', 'SELECTED'), ('WAITLISTED', 'REJECTED'), ('WAITLISTED', 'CANCELLED'),
        ('SELECTED', 'REJECTED'), ('SELECTED', 'CANCELLED')
    )  -- SELECTED -> ADMITTED happens only inside admission_admit()
$$;

CREATE FUNCTION sims_private.admission_action_for(p_to text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_to
        WHEN 'SUBMITTED' THEN 'UPDATE' WHEN 'UNDER_REVIEW' THEN 'UPDATE' WHEN 'CANCELLED' THEN 'UPDATE'
        WHEN 'ELIGIBLE' THEN 'VERIFY' WHEN 'INELIGIBLE' THEN 'VERIFY'
        WHEN 'SELECTED' THEN 'APPROVE' WHEN 'WAITLISTED' THEN 'APPROVE' WHEN 'REJECTED' THEN 'APPROVE'
    END
$$;

-- caller may act on an application at its programme's scope with ADMISSION.ALL.<action>
CREATE FUNCTION sims_private.admission_authorize(p_application_id bigint, p_action text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prog integer;
BEGIN
    SELECT programme_id INTO v_prog FROM admission_application WHERE application_id = p_application_id;
    IF v_prog IS NULL OR NOT sims_private.can_programme(ARRAY['ADMISSION.ALL.' || p_action]::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised (ADMISSION.ALL.%) or unknown application', p_action USING ERRCODE = '42501';
    END IF;
    RETURN v_prog;
END $$;
REVOKE ALL ON FUNCTION sims_private.admission_transition_ok(text, text), sims_private.admission_action_for(text), sims_private.admission_authorize(bigint, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- admission_apply: new applicant (or an existing visible one) + a DRAFT application, atomically
-- ---------------------------------------------------------------
CREATE FUNCTION public.admission_apply(p_applicant jsonb, p_application jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_prog integer := (p_application ->> 'programme_id')::integer;
    v_number text := NULLIF(btrim(p_application ->> 'application_number'), '');
    v_applicant bigint := NULLIF(p_application ->> 'admission_applicant_id', '')::bigint;
    v_first text := NULLIF(btrim(p_applicant ->> 'first_name'), '');
    v_mid text := NULLIF(btrim(p_applicant ->> 'middle_name'), '');
    v_last text := NULLIF(btrim(p_applicant ->> 'last_name'), '');
    v_email text := NULLIF(btrim(p_applicant ->> 'primary_email'), '');
    v_dob date := NULLIF(p_applicant ->> 'date_of_birth', '')::date;
    v_id bigint; v_constraint text;
BEGIN
    IF p_application IS NULL OR jsonb_typeof(p_application) <> 'object' OR v_prog IS NULL THEN
        RAISE EXCEPTION 'p_application with programme_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT sims_private.can_programme(ARRAY['ADMISSION.ALL.CREATE']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised to register applications for this programme' USING ERRCODE = '42501';
    END IF;
    IF v_number IS NULL OR (p_application ->> 'academic_year_id') IS NULL OR (p_application ->> 'application_date') IS NULL THEN
        RAISE EXCEPTION 'application_number, academic_year_id and application_date are required' USING ERRCODE = '22023';
    END IF;

    IF v_applicant IS NOT NULL THEN
        IF NOT sims_private.can_see_applicant(v_applicant) THEN
            RAISE EXCEPTION 'Not authorised to use this applicant, or it does not exist' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF p_applicant IS NULL OR jsonb_typeof(p_applicant) <> 'object' OR v_first IS NULL THEN
            RAISE EXCEPTION 'first_name is required for a new applicant' USING ERRCODE = '22023';
        END IF;
        IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
            RAISE EXCEPTION 'primary_email is not a valid email address' USING ERRCODE = '22023';
        END IF;
        IF v_dob IS NOT NULL AND (v_dob >= current_date OR v_dob < DATE '1900-01-01') THEN
            RAISE EXCEPTION 'date_of_birth is not plausible' USING ERRCODE = '22023';
        END IF;
        INSERT INTO admission_applicant (first_name, middle_name, last_name, display_name, date_of_birth, gender_id, primary_email, primary_phone,
                                         nationality_country_id, social_category_id)
        VALUES (v_first, v_mid, v_last, btrim(concat_ws(' ', v_first, v_mid, v_last)), v_dob, NULLIF(p_applicant ->> 'gender_id', '')::smallint, v_email,
                NULLIF(btrim(p_applicant ->> 'primary_phone'), ''), NULLIF(p_applicant ->> 'nationality_country_id', '')::integer,
                NULLIF(p_applicant ->> 'social_category_id', '')::integer)
        RETURNING admission_applicant_id INTO v_applicant;
    END IF;

    BEGIN
        INSERT INTO admission_application (application_number, admission_applicant_id, programme_id, academic_year_id, admission_category_id, application_date, remarks)
        VALUES (v_number, v_applicant, v_prog, (p_application ->> 'academic_year_id')::integer, NULLIF(p_application ->> 'admission_category_id', '')::integer,
                (p_application ->> 'application_date')::date, NULLIF(btrim(p_application ->> 'remarks'), ''))
        RETURNING application_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'admission_application_application_number_key' THEN
            RAISE EXCEPTION 'Application number is already in use' USING ERRCODE = '23505';
        END IF;
        RAISE;
    END;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- admission_update_applicant / admission_update_application (partial updates)
-- ---------------------------------------------------------------
CREATE FUNCTION public.admission_update_applicant(p_applicant_id bigint, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ok boolean; v_email text := NULLIF(btrim(p ->> 'primary_email'), ''); v_dob date := NULLIF(p ->> 'date_of_birth', '')::date;
BEGIN
    SELECT sims_private.can_global(ARRAY['ADMISSION.ALL.UPDATE']::text[])
        OR EXISTS (SELECT 1 FROM admission_application a WHERE a.admission_applicant_id = p_applicant_id
                   AND sims_private.can_programme(ARRAY['ADMISSION.ALL.UPDATE']::text[], a.programme_id)) INTO v_ok;
    IF NOT v_ok OR NOT EXISTS (SELECT 1 FROM admission_applicant WHERE admission_applicant_id = p_applicant_id) THEN
        RAISE EXCEPTION 'Not authorised to update this applicant, or it does not exist' USING ERRCODE = '42501';
    END IF;
    IF p ? 'first_name' AND NULLIF(btrim(p ->> 'first_name'), '') IS NULL THEN RAISE EXCEPTION 'first_name cannot be blank' USING ERRCODE = '22023'; END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'primary_email is not a valid email address' USING ERRCODE = '22023'; END IF;
    IF v_dob IS NOT NULL AND (v_dob >= current_date OR v_dob < DATE '1900-01-01') THEN RAISE EXCEPTION 'date_of_birth is not plausible' USING ERRCODE = '22023'; END IF;
    UPDATE admission_applicant SET
        first_name = CASE WHEN p ? 'first_name' THEN btrim(p ->> 'first_name') ELSE first_name END,
        middle_name = CASE WHEN p ? 'middle_name' THEN NULLIF(btrim(p ->> 'middle_name'), '') ELSE middle_name END,
        last_name = CASE WHEN p ? 'last_name' THEN NULLIF(btrim(p ->> 'last_name'), '') ELSE last_name END,
        date_of_birth = CASE WHEN p ? 'date_of_birth' THEN v_dob ELSE date_of_birth END,
        gender_id = CASE WHEN p ? 'gender_id' THEN NULLIF(p ->> 'gender_id', '')::smallint ELSE gender_id END,
        primary_email = CASE WHEN p ? 'primary_email' THEN v_email ELSE primary_email END,
        primary_phone = CASE WHEN p ? 'primary_phone' THEN NULLIF(btrim(p ->> 'primary_phone'), '') ELSE primary_phone END,
        nationality_country_id = CASE WHEN p ? 'nationality_country_id' THEN NULLIF(p ->> 'nationality_country_id', '')::integer ELSE nationality_country_id END,
        social_category_id = CASE WHEN p ? 'social_category_id' THEN NULLIF(p ->> 'social_category_id', '')::integer ELSE social_category_id END
    WHERE admission_applicant_id = p_applicant_id;
    UPDATE admission_applicant SET display_name = btrim(concat_ws(' ', first_name, middle_name, last_name)) WHERE admission_applicant_id = p_applicant_id;
END $$;

CREATE FUNCTION public.admission_update_application(p_application_id bigint, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM sims_private.admission_authorize(p_application_id, 'UPDATE');
    SELECT application_status INTO v_status FROM admission_application WHERE application_id = p_application_id FOR UPDATE;
    IF v_status IN ('ADMITTED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'A % application can no longer be edited', v_status USING ERRCODE = '45000';
    END IF;
    UPDATE admission_application SET
        remarks = CASE WHEN p ? 'remarks' THEN NULLIF(btrim(p ->> 'remarks'), '') ELSE remarks END,
        admission_category_id = CASE WHEN p ? 'admission_category_id' THEN NULLIF(p ->> 'admission_category_id', '')::integer ELSE admission_category_id END
    WHERE application_id = p_application_id;
END $$;

-- ---------------------------------------------------------------
-- admission_set_status
-- ---------------------------------------------------------------
CREATE FUNCTION public.admission_set_status(p_application_id bigint, p_new_status text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_action text := sims_private.admission_action_for(p_new_status);
BEGIN
    IF p_new_status = 'ADMITTED' THEN
        RAISE EXCEPTION 'Use admission_admit() to admit an applicant' USING ERRCODE = '45000';
    END IF;
    IF v_action IS NULL THEN RAISE EXCEPTION 'Unknown or unsupported target status %', p_new_status USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.admission_authorize(p_application_id, v_action);
    SELECT application_status INTO v_old FROM admission_application WHERE application_id = p_application_id FOR UPDATE;
    IF v_old = p_new_status THEN RETURN; END IF;  -- idempotent replay
    IF NOT sims_private.admission_transition_ok(v_old, p_new_status) THEN
        RAISE EXCEPTION 'An application cannot move from % to %', v_old, p_new_status USING ERRCODE = '45000';
    END IF;
    UPDATE admission_application SET
        application_status = p_new_status,
        eligibility_status = CASE p_new_status WHEN 'ELIGIBLE' THEN 'ELIGIBLE' WHEN 'INELIGIBLE' THEN 'INELIGIBLE' ELSE eligibility_status END,
        remarks = COALESCE(NULLIF(btrim(p_remarks), ''), remarks)
    WHERE application_id = p_application_id;
END $$;

-- ---------------------------------------------------------------
-- admission_admit: SELECTED application -> student + enrolment, atomically
-- ---------------------------------------------------------------
CREATE FUNCTION public.admission_admit(p_application_id bigint, p_student jsonb, p_enrolment jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_app record; v_prog integer; v_app_row record; v_applicant record; v_student bigint; v_stu jsonb;
BEGIN
    v_prog := sims_private.admission_authorize(p_application_id, 'APPROVE');
    IF NOT sims_private.can_programme(ARRAY['STUDENT.ALL.CREATE']::text[], v_prog) THEN
        RAISE EXCEPTION 'Not authorised to create students in this programme' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_app FROM admission_application WHERE application_id = p_application_id FOR UPDATE;
    IF v_app.application_status = 'ADMITTED' AND v_app.admitted_student_id IS NOT NULL THEN RETURN v_app.admitted_student_id; END IF;  -- idempotent replay
    IF v_app.application_status <> 'SELECTED' THEN
        RAISE EXCEPTION 'Only a SELECTED application can be admitted (status is %)', v_app.application_status USING ERRCODE = '45000';
    END IF;
    IF p_student IS NULL OR NULLIF(btrim(p_student ->> 'student_number'), '') IS NULL THEN
        RAISE EXCEPTION 'student_number is required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_applicant FROM admission_applicant WHERE admission_applicant_id = v_app.admission_applicant_id;

    -- applicant details are defaults; explicit values in p_student win
    v_stu := jsonb_strip_nulls(jsonb_build_object(
        'first_name', v_applicant.first_name, 'middle_name', v_applicant.middle_name, 'last_name', v_applicant.last_name,
        'date_of_birth', v_applicant.date_of_birth, 'gender_id', v_applicant.gender_id, 'primary_email', v_applicant.primary_email,
        'primary_phone', v_applicant.primary_phone, 'nationality_country_id', v_applicant.nationality_country_id,
        'social_category_id', v_applicant.social_category_id)) || p_student;

    v_student := public.student_register(
        v_stu,
        jsonb_strip_nulls(jsonb_build_object('programme_id', v_app.programme_id, 'specialization_id', v_app.specialization_id,
                                             'admission_category_id', v_app.admission_category_id)) || COALESCE(p_enrolment, '{}'::jsonb));

    UPDATE admission_application SET application_status = 'ADMITTED', admitted_student_id = v_student WHERE application_id = p_application_id;
    RETURN v_student;
END $$;

REVOKE ALL ON FUNCTION public.admission_apply(jsonb, jsonb), public.admission_update_applicant(bigint, jsonb), public.admission_update_application(bigint, jsonb),
    public.admission_set_status(bigint, text, text), public.admission_admit(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_apply(jsonb, jsonb), public.admission_update_applicant(bigint, jsonb), public.admission_update_application(bigint, jsonb),
    public.admission_set_status(bigint, text, text), public.admission_admit(bigint, jsonb, jsonb) TO authenticated;
