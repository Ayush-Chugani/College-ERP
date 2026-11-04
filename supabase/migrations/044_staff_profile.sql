-- Staff profile and research (module 22). Hand-written (not from the MySQL source).
--
-- DESIGN
--  * staff_activity (the common record), its contributors, evidence and the 12 one-to-one detail tables are RPC-only for writes. An employee acts on their OWN records by identity (the seed gives
--    faculty SELF-scope grants only, which never authorise writes); staff with STAFF_PROFILE.* at the employee's scope act for others. Nobody may verify or approve their own record.
--  * The detail tables differ per activity type (journal_publication, conference_activity, funded_research_project ...). One mechanism serves all of them: a whitelist maps an activity type to its detail table,
--    staff_detail_schema() describes the columns from the catalogue so the screen can render the form, and staff_activity_save() writes the detail row with jsonb_populate_record. Constraint violations are
--    translated into readable messages (sims_private.exec_dml). Entity-style lookups (journal, publisher, conference_event, organizer, external_organization, funding_agency) can be added with staff_lookup_add().
--  * Evidence files live in the private bucket 'sims-documents' under employee/<employee_id>/..., with storage policies that mirror STAFF_PROFILE.STAFF_EVIDENCE.* (see migrations 042 and 043 for the student side).
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-55):
--  1  Same lifecycle as student activities: DRAFT -> SUBMITTED -> (verify) UNDER_REVIEW -> APPROVED | REJECTED; NEEDS_CORRECTION returns to DRAFT; REJECTED is final; only drafts are editable.
--  2  Submitting needs a title, a start date and, for every mandatory activity_evidence_requirement of the type, at least minimum_files (at least 1) current evidence items.
--  3  The record's institution / campus / department come from the employee (institution) and the current primary assignment (campus, department).
--  4  research_supervision, journal_metric, research_project_financial_utilization, journal_publication_indexing and conference_activity_indexing are NOT covered (no RPC, no screen).
--  5  Changing the type of a draft deletes its old detail row (the draft has no children).

REVOKE INSERT, UPDATE, DELETE ON staff_activity, staff_activity_contributor, evidence_document, evidence_document_version, evidence_document_audit,
    journal_publication, conference_activity, professional_development_activity, faculty_internship, research_proposal, funded_research_project, consultancy_project,
    cocurricular_activity, extracurricular_activity, staff_award, staff_professional_membership, staff_professional_contribution FROM authenticated;
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
         AND tablename IN ('staff_activity', 'staff_activity_contributor', 'evidence_document', 'evidence_document_version', 'evidence_document_audit', 'journal_publication', 'conference_activity',
                           'professional_development_activity', 'faculty_internship', 'research_proposal', 'funded_research_project', 'consultancy_project', 'cocurricular_activity', 'extracurricular_activity',
                           'staff_award', 'staff_professional_membership', 'staff_professional_contribution') LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

CREATE TRIGGER trg_staff_activity_audit AFTER INSERT OR UPDATE OR DELETE ON staff_activity FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('STAFF_PROFILE', 'staff_activity_id');

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.staff_actor(p_employee bigint, p_perm text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN COALESCE(p_employee = sims_private.current_employee_id(), false) THEN 'owner'
                WHEN sims_private.can_employee(ARRAY[p_perm]::text[], p_employee, true) THEN 'staff' END
$$;

CREATE FUNCTION sims_private.staff_detail_table(p_type_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_type_code
        WHEN 'JOURNAL_PUBLICATION' THEN 'journal_publication'
        WHEN 'CONFERENCE_PUBLICATION' THEN 'conference_activity' WHEN 'CONFERENCE_PRESENTATION' THEN 'conference_activity'
        WHEN 'WORKSHOP' THEN 'professional_development_activity' WHEN 'FDP' THEN 'professional_development_activity' WHEN 'STTP' THEN 'professional_development_activity' WHEN 'TRAINING' THEN 'professional_development_activity'
        WHEN 'FACULTY_INTERNSHIP' THEN 'faculty_internship'
        WHEN 'RESEARCH_PROPOSAL' THEN 'research_proposal' WHEN 'FUNDED_RESEARCH_PROJECT' THEN 'funded_research_project'
        WHEN 'CONSULTANCY' THEN 'consultancy_project' WHEN 'INDUSTRY_SPONSORED_PROJECT' THEN 'consultancy_project'
        WHEN 'CO_CURRICULAR' THEN 'cocurricular_activity' WHEN 'EXTRA_CURRICULAR' THEN 'extracurricular_activity'
        WHEN 'AWARD_RECOGNITION' THEN 'staff_award' WHEN 'PROFESSIONAL_MEMBERSHIP' THEN 'staff_professional_membership'
        WHEN 'ACADEMIC_PROFESSIONAL_CONTRIBUTION' THEN 'staff_professional_contribution' END
$$;

CREATE FUNCTION sims_private.staff_lookup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['journal', 'publisher', 'conference_event', 'organizer', 'external_organization', 'funding_agency']
$$;

-- Reference tables the detail forms may list (organisational and bibliographic lookups only; never people tables such as student or employee).
CREATE FUNCTION sims_private.staff_option_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['award_category', 'cocurricular_category', 'conference_contribution_type', 'conference_event', 'country', 'course_catalog', 'department', 'event_mode', 'external_organization',
                 'extracurricular_category', 'funding_agency', 'funding_type', 'industry_sector', 'journal', 'journal_type', 'membership_type', 'organizer', 'participation_level',
                 'professional_contribution_type', 'programme', 'publication_type', 'publisher', 'research_status', 'role_type', 'state', 'training_program_type']
$$;

-- Runs p_sql (with $1 = p_json) and turns constraint violations into readable messages.
CREATE FUNCTION sims_private.exec_dml(p_sql text, p_json jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_state text; v_msg text; v_col text; v_con text;
BEGIN
    EXECUTE p_sql USING p_json;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_col = COLUMN_NAME, v_con = CONSTRAINT_NAME;
    IF v_state = '23502' THEN RAISE EXCEPTION 'The field "%" is required', COALESCE(v_col, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state = '23503' THEN RAISE EXCEPTION 'One of the selected options does not exist (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state = '23505' THEN RAISE EXCEPTION 'That value is already recorded (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '23505';
    ELSIF v_state = '23514' THEN RAISE EXCEPTION 'A value is not allowed (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state LIKE '22%' THEN RAISE EXCEPTION 'A value has the wrong format or is too long: %', v_msg USING ERRCODE = '22023';
    ELSE RAISE; END IF;
END $$;

-- Writes p_detail into p_table for activity p_id. Keys must be real columns (other than the key); on insert null values are skipped so defaults apply, on update they clear the column.
CREATE FUNCTION sims_private.write_detail(p_table text, p_key_col text, p_id bigint, p_detail jsonb, p_insert boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bad text; v_cols text; v_json jsonb;
BEGIN
    IF p_detail IS NULL OR jsonb_typeof(p_detail) <> 'object' THEN RAISE EXCEPTION 'The details must be an object' USING ERRCODE = '22023'; END IF;
    v_json := p_detail - p_key_col;
    SELECT string_agg(k, ', ') INTO v_bad FROM jsonb_object_keys(v_json) k
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute at WHERE at.attrelid = format('public.%I', p_table)::regclass AND at.attname = k AND at.attnum > 0 AND NOT at.attisdropped AND at.attgenerated = '');
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown detail field(s): %', v_bad USING ERRCODE = '22023'; END IF;
    IF p_insert THEN v_json := jsonb_strip_nulls(v_json); END IF;
    v_json := v_json || jsonb_build_object(p_key_col, p_id);
    SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_json) k;
    IF p_insert THEN
        PERFORM sims_private.exec_dml(format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)', p_table, v_cols, v_cols, p_table), v_json);
    ELSE
        v_json := v_json - p_key_col;
        IF v_json = '{}'::jsonb THEN RETURN; END IF;
        SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_json) k;
        PERFORM sims_private.exec_dml(format('UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE t.%I = %s', p_table, v_cols, v_cols, p_table, p_key_col, p_id),
                                      v_json);
    END IF;
END $$;

-- Shared upload checks for the employee prefix (same rules as student documents).
CREATE FUNCTION sims_private.doc_employee_id(p_name text) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN length(p_name) <= 400 AND p_name ~ '^employee/[0-9]{1,15}/[^/]+$' THEN split_part(p_name, '/', 2)::bigint END
$$;

CREATE FUNCTION sims_private.check_employee_upload(p_employee bigint, p_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ext text; v_meta jsonb;
BEGIN
    IF sims_private.doc_employee_id(p_key) IS DISTINCT FROM p_employee THEN RAISE EXCEPTION 'The file is not stored under this employee' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR btrim(p_file_name) = '' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The file name is required (at most 255 characters)' USING ERRCODE = '22023'; END IF;
    IF p_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN RAISE EXCEPTION 'Only PDF, JPEG and PNG files are accepted' USING ERRCODE = '22023'; END IF;
    v_ext := lower(substring(p_file_name FROM '\.([A-Za-z0-9]{1,10})$'));
    IF v_ext IS NULL OR NOT ((p_mime = 'application/pdf' AND v_ext = 'pdf') OR (p_mime = 'image/jpeg' AND v_ext IN ('jpg', 'jpeg')) OR (p_mime = 'image/png' AND v_ext = 'png')) THEN
        RAISE EXCEPTION 'The file name does not match its type' USING ERRCODE = '22023';
    END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    RETURN v_ext;
END $$;

CREATE FUNCTION sims_private.can_use_employee_doc_path(p_name text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(sims_private.doc_employee_id(p_name) = sims_private.current_employee_id()
                    OR sims_private.can_employee(ARRAY[CASE WHEN p_write THEN 'STAFF_PROFILE.STAFF_EVIDENCE.CREATE' ELSE 'STAFF_PROFILE.STAFF_EVIDENCE.READ' END]::text[], sims_private.doc_employee_id(p_name), p_write), false)
$$;

DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
        EXECUTE $p$CREATE POLICY sims_documents_employee_select ON storage.objects FOR SELECT TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.doc_employee_id(name) IS NOT NULL AND sims_private.can_use_employee_doc_path(name, false))$p$;
        EXECUTE $p$CREATE POLICY sims_documents_employee_insert ON storage.objects FOR INSERT TO authenticated
                   WITH CHECK (bucket_id = 'sims-documents' AND sims_private.doc_employee_id(name) IS NOT NULL AND sims_private.can_use_employee_doc_path(name, true))$p$;
        EXECUTE $p$CREATE POLICY sims_documents_employee_delete ON storage.objects FOR DELETE TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.doc_employee_id(name) IS NOT NULL AND sims_private.can_use_employee_doc_path(name, true) AND sims_private.storage_key_is_orphan(name))$p$;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- Form metadata and lookups
-- ---------------------------------------------------------------
-- Column description of a table for the generic forms: type, required, max length, referenced table and the allowed values of a single-column CHECK list.
CREATE FUNCTION sims_private.describe_columns(p_table text, p_exclude text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', regexp_replace(CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) ELSE format_type(a.atttypid, a.atttypmod) END, '\(.*\)', ''),
        'required', a.attnotnull AND NOT a.atthasdef,
        'max_length', CASE WHEN t.typname = 'varchar' AND a.atttypmod > 4 THEN a.atttypmod - 4 END,
        'ref_table', (SELECT cf.confrelid::regclass::text FROM pg_constraint cf WHERE cf.contype = 'f' AND cf.conrelid = a.attrelid AND cf.conkey = ARRAY[a.attnum] LIMIT 1),
        'choices', (SELECT (SELECT jsonb_agg(m[1]) FROM regexp_matches(pg_get_constraintdef(cc.oid), '''([A-Za-z0-9_ ./-]+)''', 'g') m)
                    FROM pg_constraint cc WHERE cc.contype = 'c' AND cc.conrelid = a.attrelid AND cc.conkey = ARRAY[a.attnum] AND pg_get_constraintdef(cc.oid) ~ '(IN|ANY)' LIMIT 1)
    ) ORDER BY a.attnum), '[]'::jsonb)
    FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attname <> ALL (p_exclude)
$$;

-- Describes the detail form of an activity type: the table and its columns.
CREATE FUNCTION public.staff_detail_schema(p_activity_type_id integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_code text; v_table text;
BEGIN
    IF NOT sims_private.is_active_member() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    SELECT activity_type_code INTO v_code FROM activity_type WHERE activity_type_id = p_activity_type_id;
    v_table := sims_private.staff_detail_table(v_code);
    IF v_table IS NULL THEN RETURN jsonb_build_object('table', NULL, 'columns', '[]'::jsonb); END IF;
    RETURN jsonb_build_object('table', v_table, 'columns', sims_private.describe_columns(v_table, ARRAY['staff_activity_id']));
END $$;

-- Describes the add-new form of an entity-style lookup (journal, publisher, conference_event ...).
CREATE FUNCTION public.staff_lookup_schema(p_table text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pk text;
BEGIN
    IF NOT sims_private.is_active_member() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    IF p_table <> ALL (sims_private.staff_lookup_tables()) THEN RAISE EXCEPTION 'That list cannot be extended here' USING ERRCODE = '22023'; END IF;
    SELECT at.attname INTO v_pk FROM pg_constraint cp JOIN pg_attribute at ON at.attrelid = cp.conrelid AND at.attnum = cp.conkey[1] WHERE cp.contype = 'p' AND cp.conrelid = format('public.%I', p_table)::regclass;
    RETURN jsonb_build_object('table', p_table, 'columns', sims_private.describe_columns(p_table, ARRAY[v_pk, 'created_at', 'updated_at', 'is_active']));
END $$;

-- id / label pairs for a lookup table referenced by the detail forms.
CREATE FUNCTION public.staff_lookup_options(p_table text) RETURNS TABLE (id bigint, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pk text; v_label text; v_oid oid;
BEGIN
    IF NOT sims_private.is_active_member() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    IF p_table <> ALL (sims_private.staff_option_tables()) THEN RAISE EXCEPTION 'Unknown lookup table' USING ERRCODE = '22023'; END IF;
    v_oid := to_regclass(format('public.%I', p_table));
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Unknown lookup table' USING ERRCODE = '22023'; END IF;
    SELECT at.attname INTO v_pk FROM pg_constraint cp JOIN pg_attribute at ON at.attrelid = cp.conrelid AND at.attnum = cp.conkey[1] WHERE cp.contype = 'p' AND cp.conrelid = v_oid;
    SELECT at.attname INTO v_label FROM pg_attribute at JOIN pg_type ty ON ty.oid = at.atttypid
    WHERE at.attrelid = v_oid AND at.attnum > 0 AND NOT at.attisdropped AND ty.typname IN ('varchar', 'text') AND at.attname <> v_pk
    ORDER BY (at.attname LIKE '%name') DESC, at.attnum LIMIT 1;
    IF v_pk IS NULL OR v_label IS NULL THEN RAISE EXCEPTION 'Unknown lookup table' USING ERRCODE = '22023'; END IF;
    RETURN QUERY EXECUTE format('SELECT %I::bigint, %I::text FROM public.%I ORDER BY 2 LIMIT 500', v_pk, v_label, p_table);
END $$;

-- Adds a row to an entity-style lookup (journal, publisher, conference_event ...). Any employee may; the row is shared, so only the listed tables are allowed.
CREATE FUNCTION public.staff_lookup_add(p_table text, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pk text; v_id bigint;
BEGIN
    IF sims_private.current_employee_id() IS NULL AND NOT sims_private.can_global(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.CREATE']::text[]) THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.CREATE)' USING ERRCODE = '42501';
    END IF;
    IF p_table <> ALL (sims_private.staff_lookup_tables()) THEN RAISE EXCEPTION 'That list cannot be extended here' USING ERRCODE = '22023'; END IF;
    SELECT at.attname INTO v_pk FROM pg_constraint cp JOIN pg_attribute at ON at.attrelid = cp.conrelid AND at.attnum = cp.conkey[1] WHERE cp.contype = 'p' AND cp.conrelid = format('public.%I', p_table)::regclass;
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'The details must be an object' USING ERRCODE = '22023'; END IF;
    p := jsonb_strip_nulls(p) - v_pk;
    IF p = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing to add' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT EXISTS (SELECT 1 FROM pg_attribute at WHERE at.attrelid = format('public.%I', p_table)::regclass AND at.attname = k AND at.attnum > 0 AND NOT at.attisdropped AND at.attgenerated = '')) THEN
        RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
    END IF;
    PERFORM sims_private.exec_dml(format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)', p_table, (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p) k),
                                         (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p) k), p_table), p);
    EXECUTE format('SELECT max(%I)::bigint FROM public.%I', v_pk, p_table) INTO v_id;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------
-- p_employee_id NULL = the caller's own employee record. p_activity_id NULL = create.
CREATE FUNCTION public.staff_activity_save(p_activity_id bigint, p_employee_id bigint, p jsonb, p_detail jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_employee bigint; a staff_activity%ROWTYPE; v_actor text; v_id bigint; v_emp record; v_code text; v_table text; v_old_table text; v_exists boolean;
    v_type integer := NULLIF(p ->> 'activity_type_id', '')::integer;
    v_title text := NULLIF(btrim(p ->> 'activity_title'), '');
    v_start date := NULLIF(p ->> 'start_date', '')::date; v_end date := NULLIF(p ->> 'end_date', '')::date;
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'p must be an object' USING ERRCODE = '22023'; END IF;
    IF p_activity_id IS NOT NULL THEN
        SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
        IF a.staff_activity_id IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or unknown record' USING ERRCODE = '42501'; END IF;
        v_employee := a.employee_id;
        v_actor := sims_private.staff_actor(v_employee, 'STAFF_PROFILE.STAFF_ACTIVITY.UPDATE');
    ELSE
        v_employee := COALESCE(p_employee_id, sims_private.current_employee_id());
        v_actor := CASE WHEN v_employee IS NULL THEN NULL ELSE sims_private.staff_actor(v_employee, 'STAFF_PROFILE.STAFF_ACTIVITY.CREATE') END;
    END IF;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.CREATE / UPDATE) or unknown record' USING ERRCODE = '42501'; END IF;
    IF p_activity_id IS NOT NULL AND a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft record can be edited' USING ERRCODE = '45000'; END IF;
    IF v_title IS NULL OR length(v_title) > 500 THEN RAISE EXCEPTION 'The title is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    SELECT activity_type_code INTO v_code FROM activity_type WHERE activity_type_id = v_type AND is_active;
    IF v_code IS NULL THEN RAISE EXCEPTION 'Choose an active activity type' USING ERRCODE = '22023'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = '22023'; END IF;
    IF NULLIF(p ->> 'academic_year_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_year WHERE academic_year_id = (p ->> 'academic_year_id')::integer) THEN RAISE EXCEPTION 'Unknown academic year' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p ->> 'description', '')) > 5000 OR length(COALESCE(p ->> 'outcomes', '')) > 5000 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    SELECT e.institution_id, (SELECT ea.campus_id FROM employee_assignment ea WHERE ea.employee_id = e.employee_id AND ea.end_date IS NULL ORDER BY ea.is_primary DESC, ea.employee_assignment_id LIMIT 1) AS campus_id,
           (SELECT ea.department_id FROM employee_assignment ea WHERE ea.employee_id = e.employee_id AND ea.end_date IS NULL ORDER BY ea.is_primary DESC, ea.employee_assignment_id LIMIT 1) AS department_id
      INTO v_emp FROM employee e WHERE e.employee_id = v_employee;
    IF v_emp.institution_id IS NULL THEN RAISE EXCEPTION 'Unknown employee' USING ERRCODE = '22023'; END IF;
    v_table := sims_private.staff_detail_table(v_code);

    IF p_activity_id IS NULL THEN
        INSERT INTO staff_activity (employee_id, activity_type_id, academic_year_id, institution_id, campus_id, department_id, participation_level_id, primary_role_type_id, activity_title, start_date, end_date,
                                    description, outcomes, verification_status_id, approval_status_id, created_by_user_id)
        VALUES (v_employee, v_type, NULLIF(p ->> 'academic_year_id', '')::integer, v_emp.institution_id, v_emp.campus_id, v_emp.department_id, NULLIF(p ->> 'participation_level_id', '')::integer,
                NULLIF(p ->> 'primary_role_type_id', '')::integer, v_title, v_start, v_end, NULLIF(btrim(p ->> 'description'), ''), NULLIF(btrim(p ->> 'outcomes'), ''),
                sims_private.vstatus('NOT_SUBMITTED'), sims_private.astatus('DRAFT'), sims_private.current_user_id()) RETURNING staff_activity_id INTO v_id;
        IF v_table IS NOT NULL THEN PERFORM sims_private.write_detail(v_table, 'staff_activity_id', v_id, COALESCE(p_detail, '{}'::jsonb), true); END IF;
        RETURN v_id;
    END IF;

    SELECT sims_private.staff_detail_table(t.activity_type_code) INTO v_old_table FROM activity_type t WHERE t.activity_type_id = a.activity_type_id;
    UPDATE staff_activity SET activity_type_id = v_type, academic_year_id = NULLIF(p ->> 'academic_year_id', '')::integer, participation_level_id = NULLIF(p ->> 'participation_level_id', '')::integer,
        primary_role_type_id = NULLIF(p ->> 'primary_role_type_id', '')::integer, activity_title = v_title, start_date = v_start, end_date = v_end, description = NULLIF(btrim(p ->> 'description'), ''),
        outcomes = NULLIF(btrim(p ->> 'outcomes'), ''), updated_by_user_id = sims_private.current_user_id(), updated_at = now() WHERE staff_activity_id = p_activity_id;
    IF v_old_table IS DISTINCT FROM v_table THEN
        IF v_old_table IS NOT NULL THEN EXECUTE format('DELETE FROM public.%I WHERE staff_activity_id = $1', v_old_table) USING p_activity_id; END IF;
        IF v_table IS NOT NULL THEN PERFORM sims_private.write_detail(v_table, 'staff_activity_id', p_activity_id, COALESCE(p_detail, '{}'::jsonb), true); END IF;
    ELSIF v_table IS NOT NULL AND p_detail IS NOT NULL THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE staff_activity_id = $1)', v_table) INTO v_exists USING p_activity_id;
        PERFORM sims_private.write_detail(v_table, 'staff_activity_id', p_activity_id, p_detail, NOT v_exists);
    END IF;
    RETURN p_activity_id;
END $$;

CREATE FUNCTION public.staff_activity_submit(p_activity_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; r record; v_count integer;
BEGIN
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or unknown record' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id = sims_private.astatus('SUBMITTED') THEN RETURN; END IF; -- idempotent replay
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft record can be submitted' USING ERRCODE = '45000'; END IF;
    IF a.start_date IS NULL THEN RAISE EXCEPTION 'The start date is required before submitting' USING ERRCODE = '45000'; END IF;
    FOR r IN SELECT q.evidence_type_id, q.minimum_files, e.evidence_type_name FROM activity_evidence_requirement q JOIN evidence_type e ON e.evidence_type_id = q.evidence_type_id
             WHERE q.activity_type_id = a.activity_type_id AND q.is_active AND q.is_mandatory AND (q.valid_from IS NULL OR q.valid_from <= CURRENT_DATE) AND (q.valid_to IS NULL OR q.valid_to >= CURRENT_DATE) LOOP
        SELECT count(*) INTO v_count FROM evidence_document ev WHERE ev.staff_activity_id = p_activity_id AND ev.evidence_type_id = r.evidence_type_id AND ev.is_active AND ev.deleted_at IS NULL;
        IF v_count < GREATEST(r.minimum_files, 1) THEN RAISE EXCEPTION 'Evidence required: %', r.evidence_type_name USING ERRCODE = '45000'; END IF;
    END LOOP;
    UPDATE staff_activity SET approval_status_id = sims_private.astatus('SUBMITTED'), verification_status_id = sims_private.vstatus('PENDING'), rejection_reason = NULL, updated_at = now() WHERE staff_activity_id = p_activity_id;
END $$;

-- p_step VERIFY: VERIFIED | NEEDS_CORRECTION | REJECTED.  p_step APPROVE: APPROVED | REJECTED.  Nobody reviews their own record.
CREATE FUNCTION public.staff_activity_review(p_activity_id bigint, p_step text, p_decision text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; v_remarks text := NULLIF(btrim(p_remarks), ''); v_perm text;
BEGIN
    IF p_step NOT IN ('VERIFY', 'APPROVE') THEN RAISE EXCEPTION 'The step must be VERIFY or APPROVE' USING ERRCODE = '22023'; END IF;
    v_perm := 'STAFF_PROFILE.STAFF_ACTIVITY.' || p_step;
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR NOT sims_private.can_employee(ARRAY[v_perm]::text[], a.employee_id, true) THEN RAISE EXCEPTION 'Not authorised (%) or unknown record', v_perm USING ERRCODE = '42501'; END IF;
    IF COALESCE(a.employee_id = sims_private.current_employee_id(), false) THEN RAISE EXCEPTION 'You cannot review your own record' USING ERRCODE = '45000'; END IF;
    IF length(COALESCE(v_remarks, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    IF p_step = 'VERIFY' THEN
        IF p_decision NOT IN ('VERIFIED', 'NEEDS_CORRECTION', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be VERIFIED, NEEDS_CORRECTION or REJECTED' USING ERRCODE = '22023'; END IF;
        IF p_decision <> 'VERIFIED' AND v_remarks IS NULL THEN RAISE EXCEPTION 'Remarks are required unless the record is verified' USING ERRCODE = '22023'; END IF;
        IF a.verification_status_id = sims_private.vstatus(p_decision) THEN RETURN; END IF; -- idempotent replay
        IF a.approval_status_id <> sims_private.astatus('SUBMITTED') OR a.verification_status_id <> sims_private.vstatus('PENDING') THEN RAISE EXCEPTION 'Only a submitted record awaiting verification can be verified' USING ERRCODE = '45000'; END IF;
        UPDATE staff_activity SET verification_status_id = sims_private.vstatus(p_decision), verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_remarks,
            approval_status_id = CASE p_decision WHEN 'VERIFIED' THEN sims_private.astatus('UNDER_REVIEW') WHEN 'NEEDS_CORRECTION' THEN sims_private.astatus('DRAFT') ELSE sims_private.astatus('REJECTED') END,
            rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN v_remarks END, updated_at = now() WHERE staff_activity_id = p_activity_id;
    ELSE
        IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be APPROVED or REJECTED' USING ERRCODE = '22023'; END IF;
        IF p_decision = 'REJECTED' AND v_remarks IS NULL THEN RAISE EXCEPTION 'Remarks are required to reject a record' USING ERRCODE = '22023'; END IF;
        IF a.approval_status_id = sims_private.astatus(p_decision) THEN RETURN; END IF; -- idempotent replay
        IF a.approval_status_id <> sims_private.astatus('UNDER_REVIEW') OR a.verification_status_id <> sims_private.vstatus('VERIFIED') THEN RAISE EXCEPTION 'Only a verified record under review can be approved or rejected' USING ERRCODE = '45000'; END IF;
        UPDATE staff_activity SET approval_status_id = sims_private.astatus(p_decision), approved_by_user_id = sims_private.current_user_id(), approved_at = now(), approval_remarks = v_remarks,
            rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN v_remarks END, updated_at = now() WHERE staff_activity_id = p_activity_id;
    END IF;
END $$;

CREATE FUNCTION public.staff_activity_delete(p_activity_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.DELETE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.DELETE) or unknown record' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id NOT IN (sims_private.astatus('DRAFT'), sims_private.astatus('REJECTED')) THEN RAISE EXCEPTION 'Only a draft or rejected record can be deleted' USING ERRCODE = '45000'; END IF;
    IF length(COALESCE(v_reason, '')) > 1000 THEN RAISE EXCEPTION 'The reason is limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    UPDATE staff_activity SET deleted_at = now(), deleted_by_user_id = sims_private.current_user_id(), deletion_reason = v_reason WHERE staff_activity_id = p_activity_id;
END $$;

-- ---------------------------------------------------------------
-- Contributors
-- ---------------------------------------------------------------
CREATE FUNCTION public.staff_contributor_add(p_activity_id bigint, p_employee_id bigint, p_external_name text, p_external_email text, p_affiliation text, p_role_type_id integer,
                                             p_is_corresponding boolean DEFAULT false, p_details text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; v_id bigint; v_name text := NULLIF(btrim(p_external_name), '');
BEGIN
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or unknown record' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft record can be changed' USING ERRCODE = '45000'; END IF;
    IF (p_employee_id IS NULL) = (v_name IS NULL) THEN RAISE EXCEPTION 'Give either an employee or an external person' USING ERRCODE = '22023'; END IF;
    IF p_employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employee WHERE employee_id = p_employee_id) THEN RAISE EXCEPTION 'Unknown employee' USING ERRCODE = '22023'; END IF;
    IF p_role_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_type WHERE role_type_id = p_role_type_id) THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_name, '')) > 250 OR length(COALESCE(p_external_email, '')) > 254 OR length(COALESCE(p_affiliation, '')) > 500 OR length(COALESCE(p_details, '')) > 1000 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    IF p_employee_id IS NOT NULL AND EXISTS (SELECT 1 FROM staff_activity_contributor WHERE staff_activity_id = p_activity_id AND employee_id = p_employee_id AND role_type_id IS NOT DISTINCT FROM p_role_type_id) THEN
        RAISE EXCEPTION 'That employee is already listed with this role' USING ERRCODE = '23505';
    END IF;
    INSERT INTO staff_activity_contributor (staff_activity_id, employee_id, external_person_name, external_person_email, affiliation_text, role_type_id, is_corresponding_author, contribution_details, contributor_sequence)
    VALUES (p_activity_id, p_employee_id, v_name, NULLIF(btrim(p_external_email), ''), NULLIF(btrim(p_affiliation), ''), p_role_type_id, COALESCE(p_is_corresponding, false), NULLIF(btrim(p_details), ''),
            (SELECT COALESCE(max(contributor_sequence), 0) + 1 FROM staff_activity_contributor WHERE staff_activity_id = p_activity_id)) RETURNING staff_activity_contributor_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.staff_contributor_remove(p_contributor_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; c record;
BEGIN
    SELECT * INTO c FROM staff_activity_contributor WHERE staff_activity_contributor_id = p_contributor_id;
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = c.staff_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or unknown contributor' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft record can be changed' USING ERRCODE = '45000'; END IF;
    DELETE FROM staff_activity_contributor WHERE staff_activity_contributor_id = p_contributor_id;
END $$;

-- ---------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------
CREATE FUNCTION public.staff_evidence_add(p_activity_id bigint, p_document_type_id integer, p_evidence_type_id integer, p_title text, p_issue_date date, p_issuing_authority text, p_certificate_number text,
                                          p_storage_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a staff_activity%ROWTYPE; v_ext text; v_file bigint; v_ev bigint; v_title text := NULLIF(btrim(p_title), '');
BEGIN
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_EVIDENCE.CREATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_EVIDENCE.CREATE) or unknown record' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be added to a draft record' USING ERRCODE = '45000'; END IF;
    IF v_title IS NULL OR length(v_title) > 500 THEN RAISE EXCEPTION 'The title is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM document_type WHERE document_type_id = p_document_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active document type' USING ERRCODE = '22023'; END IF;
    IF p_evidence_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence_type WHERE evidence_type_id = p_evidence_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active evidence type' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_issuing_authority, '')) > 300 OR length(COALESCE(p_certificate_number, '')) > 150 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    v_ext := sims_private.check_employee_upload(a.employee_id, p_storage_key, p_file_name, p_mime, p_size, p_checksum);
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    INSERT INTO evidence_document (staff_activity_id, document_type_id, evidence_type_id, confidentiality_level_id, document_title, document_issue_date, issuing_authority, certificate_document_number,
        verification_status_id, approval_status_id, created_by_user_id)
    VALUES (p_activity_id, p_document_type_id, p_evidence_type_id, (SELECT confidentiality_level_id FROM confidentiality_level WHERE level_code = 'CONFIDENTIAL'), v_title, p_issue_date, NULLIF(btrim(p_issuing_authority), ''),
            NULLIF(btrim(p_certificate_number), ''), sims_private.vstatus('PENDING'), sims_private.astatus('DRAFT'), sims_private.current_user_id()) RETURNING evidence_document_id INTO v_ev;
    INSERT INTO evidence_document_version (evidence_document_id, version_number, file_object_id, uploaded_by_user_id) VALUES (v_ev, 1, v_file, sims_private.current_user_id());
    INSERT INTO evidence_document_audit (evidence_document_id, action_code, performed_by_user_id, after_values) VALUES (v_ev, 'UPLOAD', sims_private.current_user_id(), jsonb_build_object('file_name', btrim(p_file_name), 'version', 1));
    RETURN v_ev;
END $$;

CREATE FUNCTION public.staff_evidence_replace(p_evidence_id bigint, p_reason text, p_storage_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev evidence_document%ROWTYPE; a staff_activity%ROWTYPE; v_ext text; v_file bigint; v_ver integer;
BEGIN
    SELECT * INTO ev FROM evidence_document WHERE evidence_document_id = p_evidence_id AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = ev.staff_activity_id AND deleted_at IS NULL;
    IF ev.evidence_document_id IS NULL OR a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_EVIDENCE.UPDATE') IS NULL THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_EVIDENCE.UPDATE) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be replaced on a draft record' USING ERRCODE = '45000'; END IF;
    IF length(COALESCE(p_reason, '')) > 1000 THEN RAISE EXCEPTION 'The reason is limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    v_ext := sims_private.check_employee_upload(a.employee_id, p_storage_key, p_file_name, p_mime, p_size, p_checksum);
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    v_ver := ev.current_version_number + 1;
    UPDATE evidence_document_version SET is_current = false WHERE evidence_document_id = p_evidence_id AND is_current;
    INSERT INTO evidence_document_version (evidence_document_id, version_number, file_object_id, change_reason, uploaded_by_user_id) VALUES (p_evidence_id, v_ver, v_file, NULLIF(btrim(p_reason), ''), sims_private.current_user_id());
    UPDATE evidence_document SET current_version_number = v_ver, updated_by_user_id = sims_private.current_user_id(), updated_at = now() WHERE evidence_document_id = p_evidence_id;
    INSERT INTO evidence_document_audit (evidence_document_id, action_code, performed_by_user_id, before_values, after_values, remarks)
    VALUES (p_evidence_id, 'REPLACE', sims_private.current_user_id(), jsonb_build_object('version', ev.current_version_number), jsonb_build_object('version', v_ver, 'file_name', btrim(p_file_name)), NULLIF(btrim(p_reason), ''));
    RETURN v_ver;
END $$;

CREATE FUNCTION public.staff_evidence_download_info(p_evidence_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT a.employee_id, f.storage_key, f.original_file_name, f.mime_type, v.evidence_document_version_id INTO d
    FROM evidence_document ev JOIN staff_activity a ON a.staff_activity_id = ev.staff_activity_id
    JOIN evidence_document_version v ON v.evidence_document_id = ev.evidence_document_id AND v.is_current JOIN file_object f ON f.file_object_id = v.file_object_id
    WHERE ev.evidence_document_id = p_evidence_id AND ev.deleted_at IS NULL AND a.deleted_at IS NULL;
    IF d.employee_id IS NULL OR NOT (COALESCE(d.employee_id = sims_private.current_employee_id(), false) OR sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_EVIDENCE.READ']::text[], d.employee_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_EVIDENCE.READ) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    INSERT INTO evidence_document_audit (evidence_document_id, evidence_document_version_id, action_code, performed_by_user_id) VALUES (p_evidence_id, d.evidence_document_version_id, 'DOWNLOAD', sims_private.current_user_id());
    RETURN jsonb_build_object('storage_key', d.storage_key, 'file_name', d.original_file_name, 'mime_type', d.mime_type);
END $$;

CREATE FUNCTION public.staff_evidence_delete(p_evidence_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev evidence_document%ROWTYPE; a staff_activity%ROWTYPE;
BEGIN
    SELECT * INTO ev FROM evidence_document WHERE evidence_document_id = p_evidence_id AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO a FROM staff_activity WHERE staff_activity_id = ev.staff_activity_id AND deleted_at IS NULL;
    IF ev.evidence_document_id IS NULL OR a.staff_activity_id IS NULL OR sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_EVIDENCE.DELETE') IS NULL THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_EVIDENCE.DELETE) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be removed from a draft record' USING ERRCODE = '45000'; END IF;
    UPDATE evidence_document SET deleted_at = now(), deleted_by_user_id = sims_private.current_user_id(), deletion_reason = NULLIF(btrim(p_reason), ''), is_active = false WHERE evidence_document_id = p_evidence_id;
    INSERT INTO evidence_document_audit (evidence_document_id, action_code, performed_by_user_id, remarks) VALUES (p_evidence_id, 'SOFT_DELETE', sims_private.current_user_id(), NULLIF(btrim(p_reason), ''));
END $$;

-- ---------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------
CREATE FUNCTION public.staff_activity_list(p_employee_id bigint DEFAULT NULL, p_search text DEFAULT NULL, p_approval text DEFAULT NULL, p_group text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (staff_activity_id bigint, employee_id bigint, employee_number text, staff_name text, type_name text, activity_group text, activity_title text, start_date date, verification_status text, approval_status text, evidence_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH v AS (
        SELECT a.staff_activity_id, a.employee_id, e.employee_number::text, e.display_name::text AS staff_name, t.activity_type_name::text AS type_name, t.activity_group::text, a.activity_title::text, a.start_date,
               vs.status_code::text AS verification_status, aps.status_code::text AS approval_status, a.created_at,
               (SELECT count(*) FROM evidence_document ev WHERE ev.staff_activity_id = a.staff_activity_id AND ev.deleted_at IS NULL) AS evidence_count
        FROM staff_activity a JOIN employee e ON e.employee_id = a.employee_id JOIN activity_type t ON t.activity_type_id = a.activity_type_id
        JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
          AND (COALESCE(a.employee_id = sims_private.current_employee_id(), false) OR sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.READ']::text[], a.employee_id, false))
    )
    SELECT v.staff_activity_id::bigint, v.employee_id::bigint, v.employee_number, v.staff_name, v.type_name, v.activity_group, v.activity_title, v.start_date, v.verification_status, v.approval_status, v.evidence_count, count(*) OVER ()
    FROM v
    WHERE (p_approval IS NULL OR v.approval_status = p_approval) AND (p_group IS NULL OR v.activity_group = p_group)
      AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(v.activity_title || ' ' || v.staff_name || ' ' || v.employee_number)) > 0)
    ORDER BY v.created_at DESC, v.staff_activity_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.staff_activity_get(p_activity_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_owner boolean; v_draft boolean; v_table text; v_detail jsonb;
BEGIN
    SELECT x.*, t.activity_type_name, t.activity_type_code, t.activity_group, e.employee_number AS enum, e.display_name AS ename, vs.status_code AS vcode, aps.status_code AS acode INTO a
    FROM staff_activity x JOIN activity_type t ON t.activity_type_id = x.activity_type_id JOIN employee e ON e.employee_id = x.employee_id
    JOIN verification_status vs ON vs.verification_status_id = x.verification_status_id JOIN approval_status aps ON aps.approval_status_id = x.approval_status_id
    WHERE x.staff_activity_id = p_activity_id AND x.deleted_at IS NULL;
    v_owner := COALESCE(a.employee_id = sims_private.current_employee_id(), false);
    IF a.staff_activity_id IS NULL OR NOT (v_owner OR sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.READ']::text[], a.employee_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.READ) or unknown record' USING ERRCODE = '42501';
    END IF;
    v_draft := a.acode = 'DRAFT';
    v_table := sims_private.staff_detail_table(a.activity_type_code);
    IF v_table IS NOT NULL THEN EXECUTE format('SELECT to_jsonb(t) - ''staff_activity_id'' FROM public.%I t WHERE t.staff_activity_id = $1', v_table) INTO v_detail USING p_activity_id; END IF;
    RETURN jsonb_build_object('staff_activity_id', a.staff_activity_id, 'employee_id', a.employee_id, 'employee_number', a.enum, 'staff_name', a.ename, 'activity_type_id', a.activity_type_id, 'type_name', a.activity_type_name,
        'activity_group', a.activity_group, 'academic_year_id', a.academic_year_id, 'participation_level_id', a.participation_level_id, 'primary_role_type_id', a.primary_role_type_id, 'activity_title', a.activity_title,
        'start_date', a.start_date, 'end_date', a.end_date, 'description', a.description, 'outcomes', a.outcomes, 'verification_status', a.vcode, 'verification_remarks', a.verification_remarks,
        'approval_status', a.acode, 'approval_remarks', a.approval_remarks, 'rejection_reason', a.rejection_reason, 'detail_table', v_table, 'detail', COALESCE(v_detail, '{}'::jsonb), 'is_owner', v_owner,
        'can_edit', v_draft AND sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.UPDATE') IS NOT NULL,
        'can_delete', a.acode IN ('DRAFT', 'REJECTED') AND sims_private.staff_actor(a.employee_id, 'STAFF_PROFILE.STAFF_ACTIVITY.DELETE') IS NOT NULL,
        'can_verify', a.acode = 'SUBMITTED' AND NOT v_owner AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.VERIFY']::text[], a.employee_id, true),
        'can_approve', a.acode = 'UNDER_REVIEW' AND NOT v_owner AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_ACTIVITY.APPROVE']::text[], a.employee_id, true),
        'contributors', COALESCE((SELECT jsonb_agg(jsonb_build_object('contributor_id', c.staff_activity_contributor_id, 'name', COALESCE(ce.display_name, c.external_person_name), 'is_employee', c.employee_id IS NOT NULL,
                                 'role', rt.role_name, 'affiliation', c.affiliation_text, 'is_corresponding', c.is_corresponding_author) ORDER BY c.contributor_sequence, c.staff_activity_contributor_id)
                                 FROM staff_activity_contributor c LEFT JOIN employee ce ON ce.employee_id = c.employee_id LEFT JOIN role_type rt ON rt.role_type_id = c.role_type_id WHERE c.staff_activity_id = a.staff_activity_id), '[]'::jsonb),
        'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object('evidence_id', ev.evidence_document_id, 'title', ev.document_title, 'evidence_type', et.evidence_type_name, 'version', ev.current_version_number,
                                'file_name', f.original_file_name, 'size', f.file_size_bytes, 'issued', ev.document_issue_date, 'authority', ev.issuing_authority, 'certificate_number', ev.certificate_document_number) ORDER BY ev.evidence_document_id)
                                FROM evidence_document ev LEFT JOIN evidence_type et ON et.evidence_type_id = ev.evidence_type_id
                                JOIN evidence_document_version v ON v.evidence_document_id = ev.evidence_document_id AND v.is_current JOIN file_object f ON f.file_object_id = v.file_object_id
                                WHERE ev.staff_activity_id = a.staff_activity_id AND ev.deleted_at IS NULL), '[]'::jsonb));
END $$;

-- Counts per activity group and approval status for staff with the report permission; publications are counted per academic year.
CREATE FUNCTION public.staff_activity_report(p_year integer DEFAULT NULL)
RETURNS TABLE (activity_group text, approval_status text, records bigint, employees bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT t.activity_group::text, aps.status_code::text, count(*), count(DISTINCT a.employee_id)
    FROM staff_activity a JOIN activity_type t ON t.activity_type_id = a.activity_type_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
    WHERE a.deleted_at IS NULL AND (p_year IS NULL OR a.academic_year_id = p_year) AND sims_private.can_employee(ARRAY['STAFF_PROFILE.STAFF_REPORT.READ']::text[], a.employee_id, false)
    GROUP BY t.activity_group, aps.status_code ORDER BY t.activity_group, aps.status_code
$$;

REVOKE ALL ON FUNCTION sims_private.staff_actor(bigint, text), sims_private.staff_detail_table(text), sims_private.staff_lookup_tables(), sims_private.staff_option_tables(), sims_private.exec_dml(text, jsonb), sims_private.write_detail(text, text, bigint, jsonb, boolean),
    sims_private.doc_employee_id(text), sims_private.check_employee_upload(bigint, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sims_private.can_use_employee_doc_path(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.can_use_employee_doc_path(text, boolean), sims_private.doc_employee_id(text) TO authenticated;
REVOKE ALL ON FUNCTION public.staff_lookup_schema(text), public.staff_detail_schema(integer), public.staff_lookup_options(text), public.staff_lookup_add(text, jsonb), public.staff_activity_save(bigint, bigint, jsonb, jsonb), public.staff_activity_submit(bigint),
    public.staff_activity_review(bigint, text, text, text), public.staff_activity_delete(bigint, text), public.staff_contributor_add(bigint, bigint, text, text, text, integer, boolean, text), public.staff_contributor_remove(bigint),
    public.staff_evidence_add(bigint, integer, integer, text, date, text, text, text, text, text, bigint, text), public.staff_evidence_replace(bigint, text, text, text, text, bigint, text),
    public.staff_evidence_download_info(bigint), public.staff_evidence_delete(bigint, text), public.staff_activity_list(bigint, text, text, text, integer, integer), public.staff_activity_get(bigint), public.staff_activity_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_lookup_schema(text), public.staff_detail_schema(integer), public.staff_lookup_options(text), public.staff_lookup_add(text, jsonb), public.staff_activity_save(bigint, bigint, jsonb, jsonb), public.staff_activity_submit(bigint),
    public.staff_activity_review(bigint, text, text, text), public.staff_activity_delete(bigint, text), public.staff_contributor_add(bigint, bigint, text, text, text, integer, boolean, text), public.staff_contributor_remove(bigint),
    public.staff_evidence_add(bigint, integer, integer, text, date, text, text, text, text, text, bigint, text), public.staff_evidence_replace(bigint, text, text, text, text, bigint, text),
    public.staff_evidence_download_info(bigint), public.staff_evidence_delete(bigint, text), public.staff_activity_list(bigint, text, text, text, integer, integer), public.staff_activity_get(bigint), public.staff_activity_report(integer) TO authenticated;
