-- Institution structure support. Hand-written (not from the MySQL source).
--  * audit triggers for the hierarchy tables
--  * institution_create / institution_update RPCs: institutions have no client write policy (migration 018), so they are
--    managed through these functions. Create needs a GLOBAL INSTITUTION.ALL.CREATE grant; update needs INSTITUTION.ALL.UPDATE
--    covering that institution (the university link cannot be changed).
-- campus / department / programme / programme_specialization are written directly under RLS (parent-scope checks, migration 018).

CREATE TRIGGER trg_university_audit AFTER INSERT OR UPDATE OR DELETE ON university
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'university_id');
CREATE TRIGGER trg_institution_audit AFTER INSERT OR UPDATE OR DELETE ON institution
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'institution_id');
CREATE TRIGGER trg_campus_audit AFTER INSERT OR UPDATE OR DELETE ON campus
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'campus_id');
CREATE TRIGGER trg_department_audit AFTER INSERT OR UPDATE OR DELETE ON department
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'department_id');
CREATE TRIGGER trg_programme_audit AFTER INSERT OR UPDATE OR DELETE ON programme
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'programme_id');
CREATE TRIGGER trg_programme_specialization_audit AFTER INSERT OR UPDATE OR DELETE ON programme_specialization
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('INSTITUTION', 'specialization_id');

CREATE FUNCTION sims_private.check_institution_fields(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_email text := NULLIF(btrim(p ->> 'email'), ''); v_web text := NULLIF(btrim(p ->> 'website_url'), '');
BEGIN
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'email is not a valid email address' USING ERRCODE = '22023';
    END IF;
    IF v_web IS NOT NULL AND v_web !~* '^https?://[^[:space:]]+$' THEN
        RAISE EXCEPTION 'website_url must start with http:// or https://' USING ERRCODE = '22023';
    END IF;
END $$;

CREATE FUNCTION public.institution_create(p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id integer; v_constraint text;
BEGIN
    IF NOT sims_private.can_global(ARRAY['INSTITUTION.ALL.CREATE']::text[]) THEN
        RAISE EXCEPTION 'Not authorised to create institutions' USING ERRCODE = '42501';
    END IF;
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'payload must be an object' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p ->> 'institution_code'), '') IS NULL OR NULLIF(btrim(p ->> 'institution_name'), '') IS NULL OR (p ->> 'university_id') IS NULL THEN
        RAISE EXCEPTION 'university_id, institution_code and institution_name are required' USING ERRCODE = '22023';
    END IF;
    PERFORM sims_private.check_institution_fields(p);
    BEGIN
        INSERT INTO institution (university_id, institution_code, institution_name, legal_name, website_url, email, phone, is_active)
        VALUES ((p ->> 'university_id')::integer, btrim(p ->> 'institution_code'), btrim(p ->> 'institution_name'), NULLIF(btrim(p ->> 'legal_name'), ''),
                NULLIF(btrim(p ->> 'website_url'), ''), NULLIF(btrim(p ->> 'email'), ''), NULLIF(btrim(p ->> 'phone'), ''), COALESCE((p ->> 'is_active')::boolean, true))
        RETURNING institution_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'institution_institution_code_key' THEN
            RAISE EXCEPTION 'Institution code is already in use' USING ERRCODE = '23505';
        END IF;
        RAISE;
    END;
    RETURN v_id;
END $$;

CREATE FUNCTION public.institution_update(p_id integer, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_constraint text;
BEGIN
    IF NOT sims_private.can_institution(ARRAY['INSTITUTION.ALL.UPDATE']::text[], p_id)
       OR NOT EXISTS (SELECT 1 FROM institution WHERE institution_id = p_id) THEN
        RAISE EXCEPTION 'Not authorised to update this institution, or it does not exist' USING ERRCODE = '42501';
    END IF;
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'payload must be an object' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.check_institution_fields(p);
    IF (p ? 'institution_code' AND NULLIF(btrim(p ->> 'institution_code'), '') IS NULL)
       OR (p ? 'institution_name' AND NULLIF(btrim(p ->> 'institution_name'), '') IS NULL) THEN
        RAISE EXCEPTION 'institution_code and institution_name cannot be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE institution SET
            institution_code = CASE WHEN p ? 'institution_code' THEN btrim(p ->> 'institution_code') ELSE institution_code END,
            institution_name = CASE WHEN p ? 'institution_name' THEN btrim(p ->> 'institution_name') ELSE institution_name END,
            legal_name = CASE WHEN p ? 'legal_name' THEN NULLIF(btrim(p ->> 'legal_name'), '') ELSE legal_name END,
            website_url = CASE WHEN p ? 'website_url' THEN NULLIF(btrim(p ->> 'website_url'), '') ELSE website_url END,
            email = CASE WHEN p ? 'email' THEN NULLIF(btrim(p ->> 'email'), '') ELSE email END,
            phone = CASE WHEN p ? 'phone' THEN NULLIF(btrim(p ->> 'phone'), '') ELSE phone END,
            is_active = CASE WHEN p ? 'is_active' THEN (p ->> 'is_active')::boolean ELSE is_active END
        WHERE institution_id = p_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'institution_institution_code_key' THEN
            RAISE EXCEPTION 'Institution code is already in use' USING ERRCODE = '23505';
        END IF;
        RAISE;
    END;
END $$;

REVOKE ALL ON FUNCTION sims_private.check_institution_fields(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.institution_create(jsonb), public.institution_update(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.institution_create(jsonb), public.institution_update(integer, jsonb) TO authenticated;
