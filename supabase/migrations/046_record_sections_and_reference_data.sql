-- Record sections (student and employee sub-tables) and reference-data administration. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * The same catalogue-driven mechanism as migration 044: the forms are described from the catalogue (sims_private.describe_columns) and rows are written with jsonb_populate_record. Only the tables listed in
--    section_def() / ref_def() can be reached, only the columns the catalogue shows (minus keys, audit columns and any column that points at user_account) can be written, and every write is authorised with the
--    permission the table's own row level security policy uses, at the parent's scope. Writes are audited (activity_audit) by the RPC.
--  * Sections are staff-managed administrative data; the owner can read their own through row level security but not edit (self-service covers email and phone only, migration 045).
--  * Deliberately NOT here: employee_aadhaar, employee_pan, employee_bank_account (their encryption owner is undecided, KNOWN_ISSUES KI-8), employee_document (needs Storage workflow) and employee_competency
--    (composite key).
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-58):
--  1  Rows of a section are hard-deleted (the audit log keeps the old values).
--  2  Reference rows that are still used cannot be deleted; they are corrected or, where the table has is_active, deactivated.
--  3  The reference tables and the permission that configures each follow the existing policies (checked by a test). The fee configuration tables have no write policy at all (money tables are RPC-only), so FEES.FEE_STRUCTURE.CONFIGURE
--     (global) is used for them; fee_structure and fee_structure_item (approval workflow, programme scope) are NOT covered.
--  4  Latent defect fixed here: STAFF_PROFILE.ALL.* permissions did not exist (see below), so the staff reference tables could not be configured by anyone.

-- The generated policies of the staff reference tables require STAFF_PROFILE.ALL.CONFIGURE, but migration 011 created the STAFF_PROFILE module after the generic 'ALL' resource had been generated for the modules of
-- migration 006, so that permission never existed and nobody could configure those tables. Create the resource and its permissions the same way 006 does, and give them to SUPER_ADMIN.
INSERT INTO access_resource (access_module_id, resource_code, resource_name, description)
SELECT access_module_id, 'ALL', CONCAT(module_name, ' - All Resources'), NULL FROM access_module WHERE module_code = 'STAFF_PROFILE' ON CONFLICT DO NOTHING;

INSERT INTO permission (access_resource_id, access_action_id, permission_code, permission_name, is_sensitive)
SELECT r.access_resource_id, a.access_action_id, CONCAT(m.module_code, '.', r.resource_code, '.', a.action_code), CONCAT(a.action_name, ' ', m.module_name),
       CASE WHEN a.action_code IN ('UPDATE', 'DELETE', 'APPROVE', 'EXPORT', 'CONFIGURE', 'IMPERSONATE') THEN TRUE ELSE FALSE END
FROM access_module m JOIN access_resource r ON r.access_module_id = m.access_module_id AND r.resource_code = 'ALL' CROSS JOIN access_action a
WHERE m.module_code = 'STAFF_PROFILE' ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p WHERE r.role_code = 'SUPER_ADMIN' AND p.permission_code LIKE 'STAFF_PROFILE.ALL.%' ON CONFLICT DO NOTHING;

CREATE FUNCTION sims_private.pk_column(p_table text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT at.attname::text FROM pg_constraint cp JOIN pg_attribute at ON at.attrelid = cp.conrelid AND at.attnum = cp.conkey[1]
    WHERE cp.contype = 'p' AND cp.conrelid = format('public.%I', p_table)::regclass AND array_length(cp.conkey, 1) = 1
$$;

-- Like exec_dml but returns the first column of the first row (the new key).
CREATE FUNCTION sims_private.exec_dml_id(p_sql text, p_json jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_state text; v_msg text; v_col text; v_con text; v_id bigint;
BEGIN
    EXECUTE p_sql INTO v_id USING p_json;
    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_col = COLUMN_NAME, v_con = CONSTRAINT_NAME;
    IF v_state = '23502' THEN RAISE EXCEPTION 'The field "%" is required', COALESCE(v_col, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state = '23503' THEN RAISE EXCEPTION 'One of the selected options does not exist, or this row is still in use (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state = '23505' THEN RAISE EXCEPTION 'That value is already recorded (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '23505';
    ELSIF v_state = '23514' THEN RAISE EXCEPTION 'A value is not allowed (%)', COALESCE(v_con, 'unknown') USING ERRCODE = '22023';
    ELSIF v_state LIKE '22%' THEN RAISE EXCEPTION 'A value has the wrong format or is too long: %', v_msg USING ERRCODE = '22023';
    ELSE RAISE; END IF;
END $$;

-- Columns a generic form may show and write: everything except keys, audit columns and columns that point at user_account.
CREATE FUNCTION sims_private.form_columns(p_table text, p_exclude text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM jsonb_array_elements(sims_private.describe_columns(p_table, p_exclude || ARRAY['created_at', 'updated_at'])) c
    WHERE c ->> 'ref_table' IS DISTINCT FROM 'user_account' AND (c ->> 'name') NOT LIKE '%\_by\_user\_id' AND (c ->> 'name') NOT LIKE 'deleted%'
$$;

-- Applies p (only form columns) as an INSERT (parent key forced) or an UPDATE of one row; returns the row key.
CREATE FUNCTION sims_private.write_row(p_table text, p_pk text, p_parent_col text, p_parent_id bigint, p_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_allowed text[]; v_bad text; v_json jsonb; v_cols text;
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'The details must be an object' USING ERRCODE = '22023'; END IF;
    SELECT array_agg(c ->> 'name') INTO v_allowed FROM jsonb_array_elements(sims_private.form_columns(p_table, ARRAY[p_pk] || CASE WHEN p_parent_col IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_parent_col] END)) c;
    SELECT string_agg(k, ', ') INTO v_bad FROM jsonb_object_keys(p) k WHERE k <> ALL (COALESCE(v_allowed, ARRAY[]::text[]));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown field(s): %', v_bad USING ERRCODE = '22023'; END IF;
    IF p_id IS NULL THEN
        v_json := jsonb_strip_nulls(p) || CASE WHEN p_parent_col IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(p_parent_col, p_parent_id) END;
        IF v_json = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing to save' USING ERRCODE = '22023'; END IF;
        SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_json) k;
        RETURN sims_private.exec_dml_id(format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING %I::bigint', p_table, v_cols, v_cols, p_table, p_pk), v_json);
    END IF;
    IF p = '{}'::jsonb THEN RETURN p_id; END IF;
    SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(p) k;
    PERFORM sims_private.exec_dml(format('UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE t.%I = %s', p_table, v_cols, v_cols, p_table, p_pk, p_id), p);
    RETURN p_id;
END $$;

CREATE FUNCTION sims_private.audit_manual(p_module text, p_action text, p_table text, p_id bigint, p_before jsonb, p_after jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, before_values, after_values)
    VALUES (sims_private.current_user_id(), p_module, p_action, p_table, p_id::text, p_before, p_after)
$$;

-- ---------------------------------------------------------------
-- Record sections
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.section_def(p_kind text, p_section text)
RETURNS TABLE (tbl text, parent_col text, pk_col text, perm_prefix text, label text, module_code text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT v.tbl, v.parent_col, v.pk_col, v.perm_prefix, v.label, v.module_code FROM (VALUES
        ('student', 'address', 'student_address', 'student_id', 'student_address_id', 'STUDENT.ALL', 'Addresses', 'STUDENT'),
        ('student', 'guardian', 'student_parent_guardian', 'student_id', 'student_parent_guardian_id', 'STUDENT.ALL', 'Parents and guardians', 'STUDENT'),
        ('student', 'previous_education', 'student_previous_education', 'student_id', 'previous_education_id', 'STUDENT.ALL', 'Previous education', 'STUDENT'),
        ('student', 'entrance_exam', 'student_entrance_exam', 'student_id', 'student_entrance_exam_id', 'STUDENT.ALL', 'Entrance exams', 'STUDENT'),
        ('student', 'residence', 'student_residence', 'student_id', 'student_residence_id', 'STUDENT.ALL', 'Residence', 'STUDENT'),
        ('employee', 'address', 'employee_address', 'employee_id', 'employee_address_id', 'EMPLOYEE.ALL', 'Addresses', 'EMPLOYEE'),
        ('employee', 'qualification', 'employee_qualification', 'employee_id', 'employee_qualification_id', 'EMPLOYEE.QUALIFICATION', 'Qualifications', 'EMPLOYEE'),
        ('employee', 'experience', 'employee_previous_employment', 'employee_id', 'employee_previous_employment_id', 'EMPLOYEE.EXPERIENCE', 'Previous employment', 'EMPLOYEE')
    ) AS v(kind, section, tbl, parent_col, pk_col, perm_prefix, label, module_code) WHERE v.kind = p_kind AND v.section = p_section
$$;

-- Does the caller hold p_action (READ / CREATE / UPDATE / DELETE) on this section at the parent's scope?
CREATE FUNCTION sims_private.section_can(p_kind text, p_perm_prefix text, p_action text, p_parent_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE p_kind
        WHEN 'student' THEN sims_private.can_student(ARRAY[p_perm_prefix || '.' || p_action]::text[], p_parent_id, p_action <> 'READ')
        WHEN 'employee' THEN sims_private.can_employee(ARRAY[p_perm_prefix || '.' || p_action]::text[], p_parent_id, p_action <> 'READ')
        ELSE false END
$$;

CREATE FUNCTION public.record_sections(p_kind text) RETURNS TABLE (section text, label text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT v.section, v.label FROM (VALUES
        ('student', 'address', 'Addresses'), ('student', 'guardian', 'Parents and guardians'), ('student', 'previous_education', 'Previous education'),
        ('student', 'entrance_exam', 'Entrance exams'), ('student', 'residence', 'Residence'),
        ('employee', 'address', 'Addresses'), ('employee', 'qualification', 'Qualifications'), ('employee', 'experience', 'Previous employment')
    ) AS v(kind, section, label) WHERE v.kind = p_kind
$$;

CREATE FUNCTION public.section_schema(p_kind text, p_section text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    IF NOT sims_private.is_active_member() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    SELECT * INTO d FROM sims_private.section_def(p_kind, p_section);
    IF d.tbl IS NULL THEN RAISE EXCEPTION 'Unknown section' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('table', d.tbl, 'label', d.label, 'pk', d.pk_col, 'columns', sims_private.form_columns(d.tbl, ARRAY[d.pk_col, d.parent_col]));
END $$;

CREATE FUNCTION public.section_rows(p_kind text, p_parent_id bigint, p_section text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_rows jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.section_def(p_kind, p_section);
    IF d.tbl IS NULL THEN RAISE EXCEPTION 'Unknown section' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.section_can(p_kind, d.perm_prefix, 'READ', p_parent_id) THEN RAISE EXCEPTION 'Not authorised (%.READ)', d.perm_prefix USING ERRCODE = '42501'; END IF;
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.%I), ''[]''::jsonb) FROM public.%I t WHERE t.%I = $1', d.pk_col, d.tbl, d.parent_col) INTO v_rows USING p_parent_id;
    RETURN jsonb_build_object('rows', v_rows, 'can_create', sims_private.section_can(p_kind, d.perm_prefix, 'CREATE', p_parent_id), 'can_update', sims_private.section_can(p_kind, d.perm_prefix, 'UPDATE', p_parent_id),
                              'can_delete', sims_private.section_can(p_kind, d.perm_prefix, 'DELETE', p_parent_id));
END $$;

CREATE FUNCTION public.section_save(p_kind text, p_parent_id bigint, p_section text, p_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_before jsonb; v_id bigint; v_after jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.section_def(p_kind, p_section);
    IF d.tbl IS NULL THEN RAISE EXCEPTION 'Unknown section' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.section_can(p_kind, d.perm_prefix, CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, p_parent_id) THEN
        RAISE EXCEPTION 'Not authorised (%.%)', d.perm_prefix, CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END USING ERRCODE = '42501';
    END IF;
    IF p_kind = 'student' AND NOT EXISTS (SELECT 1 FROM student WHERE student_id = p_parent_id) THEN RAISE EXCEPTION 'Unknown student' USING ERRCODE = '22023'; END IF;
    IF p_kind = 'employee' AND NOT EXISTS (SELECT 1 FROM employee WHERE employee_id = p_parent_id) THEN RAISE EXCEPTION 'Unknown employee' USING ERRCODE = '22023'; END IF;
    IF p_id IS NOT NULL THEN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1 AND t.%I = $2', d.tbl, d.pk_col, d.parent_col) INTO v_before USING p_id, p_parent_id;
        IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown row' USING ERRCODE = '22023'; END IF;
    END IF;
    v_id := sims_private.write_row(d.tbl, d.pk_col, d.parent_col, p_parent_id, p_id, p);
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1', d.tbl, d.pk_col) INTO v_after USING v_id;
    PERFORM sims_private.audit_manual(d.module_code, CASE WHEN p_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END, d.tbl, v_id, v_before, v_after);
    RETURN v_id;
END $$;

CREATE FUNCTION public.section_delete(p_kind text, p_parent_id bigint, p_section text, p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_before jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.section_def(p_kind, p_section);
    IF d.tbl IS NULL THEN RAISE EXCEPTION 'Unknown section' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.section_can(p_kind, d.perm_prefix, 'DELETE', p_parent_id) THEN RAISE EXCEPTION 'Not authorised (%.DELETE)', d.perm_prefix USING ERRCODE = '42501'; END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1 AND t.%I = $2', d.tbl, d.pk_col, d.parent_col) INTO v_before USING p_id, p_parent_id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown row' USING ERRCODE = '22023'; END IF;
    BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', d.tbl, d.pk_col) USING p_id;
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'This row is still in use and cannot be deleted' USING ERRCODE = '45000';
    END;
    PERFORM sims_private.audit_manual(d.module_code, 'DELETE', d.tbl, p_id, v_before, NULL);
END $$;

-- id / label pairs for the lookups the sections use.
CREATE FUNCTION public.section_lookup_options(p_table text) RETURNS TABLE (id bigint, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pk text; v_label text; v_oid oid;
BEGIN
    IF NOT sims_private.is_active_member() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
    IF p_table <> ALL (sims_private.section_option_tables()) THEN RAISE EXCEPTION 'Unknown lookup table' USING ERRCODE = '22023'; END IF;
    v_oid := format('public.%I', p_table)::regclass;
    v_pk := sims_private.pk_column(p_table);
    SELECT at.attname INTO v_label FROM pg_attribute at JOIN pg_type ty ON ty.oid = at.atttypid
    WHERE at.attrelid = v_oid AND at.attnum > 0 AND NOT at.attisdropped AND ty.typname IN ('varchar', 'text') AND at.attname <> v_pk ORDER BY (at.attname LIKE '%name') DESC, at.attnum LIMIT 1;
    RETURN QUERY EXECUTE format('SELECT %I::bigint, %I::text FROM public.%I ORDER BY 2 LIMIT 1000', v_pk, v_label, p_table);
END $$;

-- ---------------------------------------------------------------
-- Reference data administration
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.ref_def(p_table text) RETURNS TABLE (perm text, module_code text, label text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT v.perm, v.module_code, v.label FROM (VALUES
        ('blood_group', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Blood groups'), ('caste', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Castes'), ('country', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Countries'),
        ('gender', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Genders'), ('religion', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Religions'), ('social_category', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Social categories'),
        ('state', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'States'), ('sub_caste', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Sub-castes'), ('document_type', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Document types'),
        ('publication_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Publication types'), ('journal_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Journal types'),
        ('indexing_agency', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Indexing agencies'), ('funding_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Funding types'),
        ('award_category', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Award categories'), ('membership_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Membership types'),
        ('qualification_level', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Qualification levels'), ('education_institution', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Education institutions'),
        ('awarding_body', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Awarding bodies'), ('study_mode', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Study modes'),
        ('previous_organization', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Previous organisations'), ('staff_category', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Staff categories'),
        ('staff_type', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Staff types'), ('designation', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Designations'),
        ('fee_category', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Fee categories'), ('financial_ledger_account', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Ledger accounts'),
        ('fee_type', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Fee types'), ('late_fee_rule', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Late-fee rules'),
        ('late_fee_slab', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Late-fee slabs'), ('concession_type', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Concession types'),
        ('scholarship_scheme', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Scholarship schemes'), ('installment_plan', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Instalment plans'),
        ('payment_mode', 'FEES.FEE_STRUCTURE.CONFIGURE', 'FEES', 'Payment modes')
    ) AS v(tbl, perm, module_code, label) WHERE v.tbl = p_table
$$;

CREATE FUNCTION sims_private.ref_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['blood_group', 'caste', 'country', 'gender', 'religion', 'social_category', 'state', 'sub_caste', 'document_type', 'publication_type', 'journal_type', 'indexing_agency', 'funding_type',
                 'award_category', 'membership_type', 'qualification_level', 'education_institution', 'awarding_body', 'study_mode', 'previous_organization', 'staff_category', 'staff_type', 'designation',
                 'fee_category', 'financial_ledger_account', 'fee_type', 'late_fee_rule', 'late_fee_slab', 'concession_type', 'scholarship_scheme', 'installment_plan', 'payment_mode']
$$;

-- Lookups the section and reference forms may list: the reference tables above (readable by every member anyway).
CREATE FUNCTION sims_private.section_option_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT sims_private.ref_tables()
$$;

-- The reference tables the caller may configure.
CREATE FUNCTION public.ref_list() RETURNS TABLE (tbl text, label text, module_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT t, d.label, d.module_code FROM unnest(sims_private.ref_tables()) t, LATERAL sims_private.ref_def(t) d WHERE sims_private.can_global(ARRAY[d.perm]::text[]) ORDER BY d.module_code, d.label
$$;

CREATE FUNCTION public.ref_schema(p_table text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_pk text;
BEGIN
    SELECT * INTO d FROM sims_private.ref_def(p_table);
    IF d.perm IS NULL THEN RAISE EXCEPTION 'Unknown reference table' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.can_global(ARRAY[d.perm]::text[]) THEN RAISE EXCEPTION 'Not authorised (%)', d.perm USING ERRCODE = '42501'; END IF;
    v_pk := sims_private.pk_column(p_table);
    RETURN jsonb_build_object('table', p_table, 'label', d.label, 'pk', v_pk, 'columns', sims_private.form_columns(p_table, ARRAY[v_pk]));
END $$;

CREATE FUNCTION public.ref_rows(p_table text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_pk text; v_rows jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.ref_def(p_table);
    IF d.perm IS NULL THEN RAISE EXCEPTION 'Unknown reference table' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.can_global(ARRAY[d.perm]::text[]) THEN RAISE EXCEPTION 'Not authorised (%)', d.perm USING ERRCODE = '42501'; END IF;
    v_pk := sims_private.pk_column(p_table);
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.%I), ''[]''::jsonb) FROM (SELECT * FROM public.%I ORDER BY %I LIMIT 1000) t', v_pk, p_table, v_pk) INTO v_rows;
    RETURN v_rows;
END $$;

CREATE FUNCTION public.ref_save(p_table text, p_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_pk text; v_before jsonb; v_id bigint; v_after jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.ref_def(p_table);
    IF d.perm IS NULL THEN RAISE EXCEPTION 'Unknown reference table' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.can_global(ARRAY[d.perm]::text[]) THEN RAISE EXCEPTION 'Not authorised (%)', d.perm USING ERRCODE = '42501'; END IF;
    v_pk := sims_private.pk_column(p_table);
    IF p_id IS NOT NULL THEN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1', p_table, v_pk) INTO v_before USING p_id;
        IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown row' USING ERRCODE = '22023'; END IF;
    END IF;
    v_id := sims_private.write_row(p_table, v_pk, NULL, NULL, p_id, p);
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1', p_table, v_pk) INTO v_after USING v_id;
    PERFORM sims_private.audit_manual(d.module_code, CASE WHEN p_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END, p_table, v_id, v_before, v_after);
    RETURN v_id;
END $$;

CREATE FUNCTION public.ref_delete(p_table text, p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_pk text; v_before jsonb;
BEGIN
    SELECT * INTO d FROM sims_private.ref_def(p_table);
    IF d.perm IS NULL THEN RAISE EXCEPTION 'Unknown reference table' USING ERRCODE = '22023'; END IF;
    IF NOT sims_private.can_global(ARRAY[d.perm]::text[]) THEN RAISE EXCEPTION 'Not authorised (%)', d.perm USING ERRCODE = '42501'; END IF;
    v_pk := sims_private.pk_column(p_table);
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.%I = $1', p_table, v_pk) INTO v_before USING p_id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown row' USING ERRCODE = '22023'; END IF;
    BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', p_table, v_pk) USING p_id;
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'This row is still in use and cannot be deleted' USING ERRCODE = '45000';
    END;
    PERFORM sims_private.audit_manual(d.module_code, 'DELETE', p_table, p_id, v_before, NULL);
END $$;

REVOKE ALL ON FUNCTION sims_private.pk_column(text), sims_private.exec_dml_id(text, jsonb), sims_private.form_columns(text, text[]), sims_private.write_row(text, text, text, bigint, bigint, jsonb),
    sims_private.audit_manual(text, text, text, bigint, jsonb, jsonb), sims_private.section_def(text, text), sims_private.section_option_tables(), sims_private.section_can(text, text, text, bigint),
    sims_private.ref_def(text), sims_private.ref_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sections(text), public.section_schema(text, text), public.section_rows(text, bigint, text), public.section_save(text, bigint, text, bigint, jsonb), public.section_delete(text, bigint, text, bigint),
    public.section_lookup_options(text), public.ref_list(), public.ref_schema(text), public.ref_rows(text), public.ref_save(text, bigint, jsonb), public.ref_delete(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sections(text), public.section_schema(text, text), public.section_rows(text, bigint, text), public.section_save(text, bigint, text, bigint, jsonb), public.section_delete(text, bigint, text, bigint),
    public.section_lookup_options(text), public.ref_list(), public.ref_schema(text), public.ref_rows(text), public.ref_save(text, bigint, jsonb), public.ref_delete(text, bigint) TO authenticated;
