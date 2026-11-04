-- Employee module support. Hand-written (not from the MySQL source).
--  * employee_register(): create an employee and (optionally) a first assignment atomically, authorised at institution scope
--    (or at the target campus/department scope when an assignment is supplied).
--  * employee_assign(): add an assignment; optionally ends the current primary assignment so the single-current-primary rule holds.
--  * institution_id of an employee cannot be changed by end users (would move a person between tenants).
--  * audit triggers on employee and employee_assignment.
-- Not included: Aadhaar / PAN / bank data (ciphertext handling undecided, see KNOWN_ISSUES KI-8).

CREATE FUNCTION sims_private.employee_institution_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF current_user = 'authenticated' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
        RAISE EXCEPTION 'An employee cannot be moved to another institution through this interface' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sims_private.employee_institution_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_employee_institution_immutable BEFORE UPDATE ON employee
    FOR EACH ROW EXECUTE FUNCTION sims_private.employee_institution_immutable();

CREATE TRIGGER trg_employee_audit AFTER INSERT OR UPDATE OR DELETE ON employee
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('EMPLOYEE', 'employee_id');
CREATE TRIGGER trg_employee_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON employee_assignment
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('EMPLOYEE', 'employee_assignment_id');

-- ---------------------------------------------------------------
-- employee_register
-- ---------------------------------------------------------------
CREATE FUNCTION public.employee_register(p_employee jsonb, p_assignment jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_inst integer := (p_employee ->> 'institution_id')::integer;
    v_number text := NULLIF(btrim(p_employee ->> 'employee_number'), '');
    v_first text := NULLIF(btrim(p_employee ->> 'first_name'), '');
    v_mid text := NULLIF(btrim(p_employee ->> 'middle_name'), '');
    v_last text := NULLIF(btrim(p_employee ->> 'last_name'), '');
    v_email text := NULLIF(btrim(p_employee ->> 'primary_email'), '');
    v_dob date := NULLIF(p_employee ->> 'date_of_birth', '')::date;
    v_join date := NULLIF(p_employee ->> 'joining_date', '')::date;
    v_campus integer; v_dept integer; v_campus_inst integer; v_id bigint; v_constraint text; v_ok boolean;
BEGIN
    IF p_employee IS NULL OR jsonb_typeof(p_employee) <> 'object' THEN
        RAISE EXCEPTION 'p_employee must be an object' USING ERRCODE = '22023';
    END IF;
    IF v_inst IS NULL THEN RAISE EXCEPTION 'institution_id is required' USING ERRCODE = '22023'; END IF;

    IF p_assignment IS NOT NULL THEN
        IF jsonb_typeof(p_assignment) <> 'object' THEN RAISE EXCEPTION 'p_assignment must be an object' USING ERRCODE = '22023'; END IF;
        v_campus := (p_assignment ->> 'campus_id')::integer;
        v_dept := NULLIF(p_assignment ->> 'department_id', '')::integer;
        IF v_campus IS NULL OR (p_assignment ->> 'designation_id') IS NULL THEN
            RAISE EXCEPTION 'campus_id and designation_id are required for an assignment' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- institution-level grant, or (with an assignment) a grant covering the target department/campus
    v_ok := sims_private.can_institution(ARRAY['EMPLOYEE.ALL.CREATE']::text[], v_inst);
    IF NOT v_ok AND p_assignment IS NOT NULL THEN
        v_ok := CASE WHEN v_dept IS NOT NULL THEN sims_private.can_department(ARRAY['EMPLOYEE.ALL.CREATE']::text[], v_dept)
                     ELSE sims_private.can_campus(ARRAY['EMPLOYEE.ALL.CREATE']::text[], v_campus) END;
        IF v_ok THEN
            SELECT institution_id INTO v_campus_inst FROM campus WHERE campus_id = v_campus;
            IF v_campus_inst IS DISTINCT FROM v_inst THEN v_ok := false; END IF;  -- scoped staff may only add people to their own institution
        END IF;
    END IF;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'Not authorised to register employees here' USING ERRCODE = '42501';
    END IF;

    IF v_number IS NULL OR v_first IS NULL OR v_join IS NULL OR (p_employee ->> 'employment_source_id') IS NULL
       OR (p_employee ->> 'employment_type') IS NULL THEN
        RAISE EXCEPTION 'employee_number, first_name, joining_date, employment_source_id and employment_type are required' USING ERRCODE = '22023';
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'primary_email is not a valid email address' USING ERRCODE = '22023';
    END IF;
    IF v_dob IS NOT NULL AND (v_dob >= current_date OR v_dob < DATE '1900-01-01') THEN
        RAISE EXCEPTION 'date_of_birth is not plausible' USING ERRCODE = '22023';
    END IF;

    BEGIN
        INSERT INTO employee (institution_id, employment_source_id, external_agency_id, employee_number, agency_employee_number, first_name, middle_name,
                              last_name, display_name, date_of_birth, gender_id, blood_group_id, primary_email, primary_phone, nationality_country_id,
                              religion_id, social_category_id, joining_date, employment_type)
        VALUES (v_inst, (p_employee ->> 'employment_source_id')::smallint, NULLIF(p_employee ->> 'external_agency_id', '')::bigint, v_number,
                NULLIF(btrim(p_employee ->> 'agency_employee_number'), ''), v_first, v_mid, v_last, btrim(concat_ws(' ', v_first, v_mid, v_last)), v_dob,
                NULLIF(p_employee ->> 'gender_id', '')::smallint, NULLIF(p_employee ->> 'blood_group_id', '')::smallint, v_email,
                NULLIF(btrim(p_employee ->> 'primary_phone'), ''), NULLIF(p_employee ->> 'nationality_country_id', '')::integer,
                NULLIF(p_employee ->> 'religion_id', '')::integer, NULLIF(p_employee ->> 'social_category_id', '')::integer, v_join,
                p_employee ->> 'employment_type')
        RETURNING employee_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IN ('employee_employee_number_key', 'uq_employee_primary_email', 'uq_employee_agency_number') THEN
            RAISE EXCEPTION 'Employee number or email is already registered' USING ERRCODE = '23505';
        END IF;
        RAISE;
    END;

    IF p_assignment IS NOT NULL THEN
        INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date, is_primary)
        VALUES (v_id, v_campus, v_dept, (p_assignment ->> 'designation_id')::integer,
                COALESCE(NULLIF(p_assignment ->> 'start_date', '')::date, v_join), COALESCE((p_assignment ->> 'is_primary')::boolean, true));
    END IF;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- employee_assign
-- ---------------------------------------------------------------
CREATE FUNCTION public.employee_assign(
    p_employee_id bigint, p_campus_id integer, p_department_id integer, p_designation_id integer, p_start_date date,
    p_is_primary boolean DEFAULT true, p_end_current boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cur record; v_id bigint; v_codes text[] := ARRAY['EMPLOYEE.ALL.UPDATE']::text[];
BEGIN
    IF NOT sims_private.can_employee(v_codes, p_employee_id, true)
       OR NOT (CASE WHEN p_department_id IS NOT NULL THEN sims_private.can_department(v_codes, p_department_id)
                    ELSE sims_private.can_campus(v_codes, p_campus_id) END) THEN
        RAISE EXCEPTION 'Not authorised to change this employee''s assignments here, or unknown employee' USING ERRCODE = '42501';
    END IF;
    IF p_start_date IS NULL OR p_campus_id IS NULL OR p_designation_id IS NULL THEN
        RAISE EXCEPTION 'campus, designation and start date are required' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM employee WHERE employee_id = p_employee_id FOR UPDATE;  -- serialise concurrent assignment changes per employee
    IF p_is_primary THEN
        SELECT employee_assignment_id, start_date INTO v_cur FROM employee_assignment
         WHERE employee_id = p_employee_id AND is_primary AND end_date IS NULL;
        IF FOUND THEN
            IF NOT p_end_current THEN
                RAISE EXCEPTION 'The employee already has a current primary assignment; end it first' USING ERRCODE = '45000';
            END IF;
            IF p_start_date <= v_cur.start_date THEN
                RAISE EXCEPTION 'The new start date must be after the current assignment started' USING ERRCODE = '45000';
            END IF;
            UPDATE employee_assignment SET end_date = p_start_date - 1 WHERE employee_assignment_id = v_cur.employee_assignment_id;
        END IF;
    END IF;
    INSERT INTO employee_assignment (employee_id, campus_id, department_id, designation_id, start_date, is_primary)
    VALUES (p_employee_id, p_campus_id, p_department_id, p_designation_id, p_start_date, p_is_primary)
    RETURNING employee_assignment_id INTO v_id;
    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.employee_register(jsonb, jsonb), public.employee_assign(bigint, integer, integer, integer, date, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_register(jsonb, jsonb), public.employee_assign(bigint, integer, integer, integer, date, boolean, boolean) TO authenticated;
