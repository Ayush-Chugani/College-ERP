-- Student CRUD support. Hand-written (not from the MySQL source).
--  1. sims_private.audit_row(): generic row-change audit into activity_audit (actor = acting SIMS user).
--  2. public.student_register(): create a student and (optionally) the first programme enrolment atomically, authorised at the
--     PROGRAMME scope. Needed because a brand-new student has no enrolment yet, so row-level scope cannot be derived for a direct INSERT.
--  3. public.my_context(): now also returns the caller's ALLOW permission codes so the UI can hide actions (UX only; RLS enforces).

-- ---------------------------------------------------------------
-- 1. Audit trigger function
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_old jsonb; v_new jsonb; v_before jsonb; v_after jsonb; v_id text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_new := to_jsonb(NEW); v_after := v_new; v_id := v_new ->> TG_ARGV[1];
    ELSIF TG_OP = 'DELETE' THEN
        v_old := to_jsonb(OLD); v_before := v_old; v_id := v_old ->> TG_ARGV[1];
    ELSE
        v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := v_new ->> TG_ARGV[1];
        SELECT jsonb_object_agg(n.key, n.value), jsonb_object_agg(n.key, v_old -> n.key)
          INTO v_after, v_before
          FROM jsonb_each(v_new) n
         WHERE n.key <> 'updated_at' AND n.value IS DISTINCT FROM (v_old -> n.key);
        IF v_after IS NULL THEN RETURN NULL; END IF;  -- nothing but updated_at changed
    END IF;
    INSERT INTO public.activity_audit (user_id, module_code, action_code, entity_name, entity_id, before_values, after_values)
    VALUES (sims_private.current_user_id(), TG_ARGV[0], TG_OP, TG_TABLE_NAME, v_id, v_before, v_after);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sims_private.audit_row() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_student_audit AFTER INSERT OR UPDATE OR DELETE ON student
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('STUDENT', 'student_id');
CREATE TRIGGER trg_student_programme_enrolment_audit AFTER INSERT OR UPDATE OR DELETE ON student_programme_enrolment
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ADMISSION', 'enrolment_id');

-- ---------------------------------------------------------------
-- 2. student_register
-- ---------------------------------------------------------------
CREATE FUNCTION public.student_register(p_student jsonb, p_enrolment jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_prog integer; v_scheme_prog integer; v_id bigint;
    v_first text := NULLIF(btrim(p_student ->> 'first_name'), '');
    v_mid text := NULLIF(btrim(p_student ->> 'middle_name'), '');
    v_last text := NULLIF(btrim(p_student ->> 'last_name'), '');
    v_number text := NULLIF(btrim(p_student ->> 'student_number'), '');
    v_email text := NULLIF(btrim(p_student ->> 'primary_email'), '');
    v_dob date := NULLIF(p_student ->> 'date_of_birth', '')::date;
    v_adm date; v_constraint text;
BEGIN
    IF p_student IS NULL OR jsonb_typeof(p_student) <> 'object' THEN
        RAISE EXCEPTION 'p_student must be an object' USING ERRCODE = '22023';
    END IF;
    IF p_enrolment IS NOT NULL THEN
        IF jsonb_typeof(p_enrolment) <> 'object' THEN RAISE EXCEPTION 'p_enrolment must be an object' USING ERRCODE = '22023'; END IF;
        v_prog := (p_enrolment ->> 'programme_id')::integer;
        IF v_prog IS NULL THEN RAISE EXCEPTION 'programme_id is required for an enrolment' USING ERRCODE = '22023'; END IF;
        IF NOT (sims_private.can_programme(ARRAY['STUDENT.ALL.CREATE']::text[], v_prog)
                AND sims_private.can_programme(ARRAY['ADMISSION.ALL.CREATE']::text[], v_prog)) THEN
            RAISE EXCEPTION 'Not authorised to register students in this programme' USING ERRCODE = '42501';
        END IF;
    ELSIF NOT sims_private.can_global(ARRAY['STUDENT.ALL.CREATE']::text[]) THEN
        -- Without an enrolment there is no scope to check against: only global grants may create an unenrolled student.
        RAISE EXCEPTION 'Not authorised to register students without a programme enrolment' USING ERRCODE = '42501';
    END IF;

    IF v_number IS NULL OR v_first IS NULL THEN RAISE EXCEPTION 'student_number and first_name are required' USING ERRCODE = '22023'; END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'primary_email is not a valid email address' USING ERRCODE = '22023';
    END IF;
    IF v_dob IS NOT NULL AND (v_dob >= current_date OR v_dob < DATE '1900-01-01') THEN
        RAISE EXCEPTION 'date_of_birth is not plausible' USING ERRCODE = '22023';
    END IF;

    IF p_enrolment IS NOT NULL THEN
        SELECT programme_id INTO v_scheme_prog FROM curriculum_scheme WHERE curriculum_scheme_id = (p_enrolment ->> 'curriculum_scheme_id')::bigint;
        IF v_scheme_prog IS DISTINCT FROM v_prog THEN
            RAISE EXCEPTION 'The curriculum scheme does not belong to the selected programme' USING ERRCODE = '45000';
        END IF;
    END IF;
    v_adm := COALESCE(NULLIF(p_student ->> 'admission_date', '')::date, NULLIF(p_enrolment ->> 'admission_date', '')::date);

    BEGIN
        INSERT INTO student (student_number, first_name, middle_name, last_name, display_name, date_of_birth, gender_id, blood_group_id,
                             primary_email, primary_phone, nationality_country_id, religion_id, social_category_id, admission_date, notes)
        VALUES (v_number, v_first, v_mid, v_last, btrim(concat_ws(' ', v_first, v_mid, v_last)), v_dob,
                NULLIF(p_student ->> 'gender_id', '')::smallint, NULLIF(p_student ->> 'blood_group_id', '')::smallint,
                v_email, NULLIF(btrim(p_student ->> 'primary_phone'), ''), NULLIF(p_student ->> 'nationality_country_id', '')::integer,
                NULLIF(p_student ->> 'religion_id', '')::integer, NULLIF(p_student ->> 'social_category_id', '')::integer, v_adm,
                NULLIF(btrim(p_student ->> 'notes'), ''))
        RETURNING student_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IN ('student_student_number_key', 'uq_student_primary_email', 'student_university_seat_number_key') THEN
            RAISE EXCEPTION 'Student number or email is already registered' USING ERRCODE = '23505';
        END IF;
        RAISE;  -- any other uniqueness failure is a real error and must not be disguised
    END;

    IF p_enrolment IS NOT NULL THEN
        INSERT INTO student_programme_enrolment (student_id, programme_id, specialization_id, curriculum_scheme_id, admission_academic_year_id,
                                                 admission_category_id, admission_date, admission_semester_id)
        VALUES (v_id, v_prog, NULLIF(p_enrolment ->> 'specialization_id', '')::integer, (p_enrolment ->> 'curriculum_scheme_id')::bigint,
                (p_enrolment ->> 'admission_academic_year_id')::integer, NULLIF(p_enrolment ->> 'admission_category_id', '')::integer,
                COALESCE(NULLIF(p_enrolment ->> 'admission_date', '')::date, v_adm, current_date), (p_enrolment ->> 'admission_semester_id')::smallint);
    END IF;
    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.student_register(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_register(jsonb, jsonb) TO authenticated;

-- ---------------------------------------------------------------
-- 3. my_context(): add the caller's ALLOW permission codes at non-SELF scopes (SELF grants never allow direct writes), for hiding UI actions only
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_user_id() AS uid)
    SELECT CASE WHEN me.uid IS NULL THEN NULL ELSE jsonb_build_object(
        'user_id', me.uid,
        'username', (SELECT u.username FROM public.user_account u WHERE u.user_id = me.uid),
        'email', (SELECT u.email FROM public.user_account u WHERE u.user_id = me.uid),
        'student_id', sims_private.current_student_id(),
        'employee_id', sims_private.current_employee_id(),
        'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'role_code', r.role_code, 'role_name', r.role_name, 'scope_type', r.scope_type,
                    'institution_id', r.institution_id, 'campus_id', r.campus_id,
                    'department_id', r.department_id, 'programme_id', r.programme_id))
                 FROM public.v_active_user_role r WHERE r.user_id = me.uid), '[]'::jsonb),
        'readable_modules', COALESCE((SELECT jsonb_agg(DISTINCT split_part(v.permission_code, '.', 1))
                 FROM public.v_effective_user_permission v
                 WHERE v.user_id = me.uid AND v.permission_effect = 'ALLOW' AND v.permission_code LIKE '%.READ'), '[]'::jsonb),
        'permissions', COALESCE((SELECT jsonb_agg(DISTINCT v.permission_code)
                 FROM public.v_effective_user_permission v
                 WHERE v.user_id = me.uid AND v.permission_effect = 'ALLOW' AND v.scope_type <> 'SELF'), '[]'::jsonb)
    ) END
    FROM me
$$;
