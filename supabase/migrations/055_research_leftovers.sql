-- Staff research leftovers (KI-56): research supervision, project financial utilisation, journal and conference indexing, journal metrics. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * research_supervision and research_project_financial_utilization are one-to-many children of a staff activity, so they join the generic record sections of migration 046 under a new kind
--    'activity' (parent = staff_activity). journal_publication_indexing and conference_activity_indexing have a composite key and get three small dedicated RPCs.
--    journal_metric and metric_type are reference data (maintained by whoever holds STAFF_PROFILE.ALL.CONFIGURE) and join the reference-data administration.
--  * Authorisation follows the rows' own policies: the owner of the activity or staff holding STAFF_PROFILE.STAFF_ACTIVITY.<action> (supervision, indexing) or STAFF_PROFILE.STAFF_RESEARCH.<action>
--    (utilisation) at the employee's scope.
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-56):
--  1  The parent must be the right kind of activity (supervision: professional/academic contribution; utilisation: funded research project; indexing: journal publication or conference activity).
--  2  Child rows can be added or changed while the activity is a DRAFT or APPROVED (progress reports, indexing status and supervision milestones are recorded after approval); they are locked while the
--     activity is SUBMITTED, UNDER_REVIEW or REJECTED. Every change is written to activity_audit.
--  3  Utilisation: closing balance = opening + received - expenditure is enforced; the amounts cannot be negative.

-- ---------------------------------------------------------------
-- parent checks
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.activity_child_ok(p_activity_id bigint, p_detail_table text, p_perm_prefix text, p_action text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_ok boolean;
BEGIN
    SELECT x.employee_id, aps.status_code AS acode INTO a FROM staff_activity x JOIN approval_status aps ON aps.approval_status_id = x.approval_status_id WHERE x.staff_activity_id = p_activity_id AND x.deleted_at IS NULL;
    IF a.employee_id IS NULL THEN RETURN false; END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE staff_activity_id = $1)', p_detail_table) INTO v_ok USING p_activity_id;
    IF NOT v_ok THEN RETURN false; END IF;
    IF p_action = 'READ' THEN RETURN COALESCE(a.employee_id = sims_private.current_employee_id(), false) OR sims_private.can_employee(ARRAY[p_perm_prefix || '.READ']::text[], a.employee_id, false); END IF;
    IF a.acode NOT IN ('DRAFT', 'APPROVED') THEN RETURN false; END IF;
    RETURN sims_private.staff_actor(a.employee_id, p_perm_prefix || '.' || p_action) IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION sims_private.activity_child_ok(bigint, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- generic sections: kind 'activity'
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_private.section_def(p_kind text, p_section text)
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
        ('employee', 'experience', 'employee_previous_employment', 'employee_id', 'employee_previous_employment_id', 'EMPLOYEE.EXPERIENCE', 'Previous employment', 'EMPLOYEE'),
        ('activity', 'supervision', 'research_supervision', 'staff_activity_id', 'research_supervision_id', 'STAFF_PROFILE.STAFF_ACTIVITY', 'Research supervision', 'STAFF_PROFILE'),
        ('activity', 'utilization', 'research_project_financial_utilization', 'staff_activity_id', 'utilization_id', 'STAFF_PROFILE.STAFF_RESEARCH', 'Financial utilisation', 'STAFF_PROFILE')
    ) AS v(kind, section, tbl, parent_col, pk_col, perm_prefix, label, module_code) WHERE v.kind = p_kind AND v.section = p_section
$$;

CREATE OR REPLACE FUNCTION sims_private.section_can(p_kind text, p_perm_prefix text, p_action text, p_parent_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE p_kind
        WHEN 'student' THEN sims_private.can_student(ARRAY[p_perm_prefix || '.' || p_action]::text[], p_parent_id, p_action <> 'READ')
        WHEN 'employee' THEN sims_private.can_employee(ARRAY[p_perm_prefix || '.' || p_action]::text[], p_parent_id, p_action <> 'READ')
        WHEN 'activity' THEN sims_private.activity_child_ok(p_parent_id,
            CASE p_perm_prefix WHEN 'STAFF_PROFILE.STAFF_RESEARCH' THEN 'funded_research_project' ELSE 'staff_professional_contribution' END, p_perm_prefix, p_action)
        ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.record_sections(p_kind text) RETURNS TABLE (section text, label text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT v.section, v.label FROM (VALUES
        ('student', 'address', 'Addresses'), ('student', 'guardian', 'Parents and guardians'), ('student', 'previous_education', 'Previous education'),
        ('student', 'entrance_exam', 'Entrance exams'), ('student', 'residence', 'Residence'),
        ('employee', 'address', 'Addresses'), ('employee', 'qualification', 'Qualifications'), ('employee', 'experience', 'Previous employment'),
        ('activity', 'supervision', 'Research supervision'), ('activity', 'utilization', 'Financial utilisation')
    ) AS v(kind, section, label) WHERE v.kind = p_kind
$$;

-- section_save checked only student and employee parents; the activity parent is checked by section_can above (it needs the right detail row), so add nothing here.
-- Utilisation arithmetic (closing = opening + received - expenditure) as a table constraint, so no path can store a wrong balance.
ALTER TABLE research_project_financial_utilization ADD CONSTRAINT chk_project_utilization_balance CHECK (closing_balance = opening_balance + amount_received - expenditure_amount) NOT VALID;

-- ---------------------------------------------------------------
-- indexing (journal publication / conference activity)
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.indexing_table(p_activity_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN EXISTS (SELECT 1 FROM journal_publication WHERE staff_activity_id = p_activity_id) THEN 'journal_publication_indexing'
                WHEN EXISTS (SELECT 1 FROM conference_activity WHERE staff_activity_id = p_activity_id) THEN 'conference_activity_indexing' END
$$;
REVOKE ALL ON FUNCTION sims_private.indexing_table(bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.staff_indexing_list(p_activity_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_table text := sims_private.indexing_table(p_activity_id); v_rows jsonb;
BEGIN
    IF v_table IS NULL OR NOT (SELECT sims_private.activity_child_ok(p_activity_id, CASE v_table WHEN 'journal_publication_indexing' THEN 'journal_publication' ELSE 'conference_activity' END, 'STAFF_PROFILE.STAFF_ACTIVITY', 'READ')) THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.READ) or unknown record' USING ERRCODE = '42501';
    END IF;
    EXECUTE format('SELECT COALESCE(jsonb_agg(jsonb_build_object(''agency_id'', i.indexing_agency_id, ''agency'', g.agency_name, ''status'', i.indexing_status, ''url'', i.source_url, ''remarks'', i.remarks, ''year'', %s) ORDER BY g.agency_name), ''[]''::jsonb)
                    FROM public.%I i JOIN public.indexing_agency g ON g.indexing_agency_id = i.indexing_agency_id WHERE i.staff_activity_id = $1',
                   CASE WHEN v_table = 'journal_publication_indexing' THEN 'i.indexed_year' ELSE 'NULL::integer' END, v_table) INTO v_rows USING p_activity_id;
    RETURN jsonb_build_object('rows', v_rows, 'kind', CASE v_table WHEN 'journal_publication_indexing' THEN 'JOURNAL' ELSE 'CONFERENCE' END,
        'can_edit', sims_private.activity_child_ok(p_activity_id, CASE v_table WHEN 'journal_publication_indexing' THEN 'journal_publication' ELSE 'conference_activity' END, 'STAFF_PROFILE.STAFF_ACTIVITY', 'UPDATE'));
END $$;

CREATE FUNCTION public.staff_indexing_save(p_activity_id bigint, p_agency_id integer, p_status text, p_year integer DEFAULT NULL, p_url text DEFAULT NULL, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_table text := sims_private.indexing_table(p_activity_id); v_before jsonb; v_after jsonb; v_parent text;
BEGIN
    v_parent := CASE v_table WHEN 'journal_publication_indexing' THEN 'journal_publication' ELSE 'conference_activity' END;
    IF v_table IS NULL OR NOT sims_private.activity_child_ok(p_activity_id, v_parent, 'STAFF_PROFILE.STAFF_ACTIVITY', 'UPDATE') THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or the record cannot be changed now' USING ERRCODE = '42501';
    END IF;
    IF p_status NOT IN ('CLAIMED', 'VERIFIED', 'DISCONTINUED', 'NOT_INDEXED') THEN RAISE EXCEPTION 'Unknown indexing status' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM indexing_agency WHERE indexing_agency_id = p_agency_id AND is_active) THEN RAISE EXCEPTION 'Choose an active indexing agency' USING ERRCODE = '22023'; END IF;
    IF p_year IS NOT NULL AND (p_year < 1900 OR p_year > extract(year FROM now())::integer + 1) THEN RAISE EXCEPTION 'Enter a valid year' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_url, '')) > 1000 OR (p_url IS NOT NULL AND p_url <> '' AND p_url !~* '^https?://') THEN RAISE EXCEPTION 'The link must start with http:// or https:// (at most 1000 characters)' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_remarks, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    -- 'VERIFIED' is a claim checked by someone else: only staff (not the owner) may set it
    IF p_status = 'VERIFIED' AND sims_private.staff_actor((SELECT employee_id FROM staff_activity WHERE staff_activity_id = p_activity_id), 'STAFF_PROFILE.STAFF_ACTIVITY.VERIFY') IS DISTINCT FROM 'staff' THEN
        RAISE EXCEPTION 'Only a verifier can mark an indexing as verified' USING ERRCODE = '42501';
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.staff_activity_id = $1 AND t.indexing_agency_id = $2', v_table) INTO v_before USING p_activity_id, p_agency_id;
    IF v_table = 'journal_publication_indexing' THEN
        INSERT INTO journal_publication_indexing (staff_activity_id, indexing_agency_id, indexing_status, indexed_year, source_url, remarks) VALUES (p_activity_id, p_agency_id, p_status, p_year, NULLIF(p_url, ''), NULLIF(btrim(p_remarks), ''))
        ON CONFLICT (staff_activity_id, indexing_agency_id) DO UPDATE SET indexing_status = EXCLUDED.indexing_status, indexed_year = EXCLUDED.indexed_year, source_url = EXCLUDED.source_url, remarks = EXCLUDED.remarks;
    ELSE
        INSERT INTO conference_activity_indexing (staff_activity_id, indexing_agency_id, indexing_status, source_url, remarks) VALUES (p_activity_id, p_agency_id, p_status, NULLIF(p_url, ''), NULLIF(btrim(p_remarks), ''))
        ON CONFLICT (staff_activity_id, indexing_agency_id) DO UPDATE SET indexing_status = EXCLUDED.indexing_status, source_url = EXCLUDED.source_url, remarks = EXCLUDED.remarks;
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.staff_activity_id = $1 AND t.indexing_agency_id = $2', v_table) INTO v_after USING p_activity_id, p_agency_id;
    PERFORM sims_private.audit_manual('STAFF_PROFILE', CASE WHEN v_before IS NULL THEN 'INSERT' ELSE 'UPDATE' END, v_table, p_activity_id, v_before, v_after);
END $$;

CREATE FUNCTION public.staff_indexing_delete(p_activity_id bigint, p_agency_id integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_table text := sims_private.indexing_table(p_activity_id); v_before jsonb;
BEGIN
    IF v_table IS NULL OR NOT sims_private.activity_child_ok(p_activity_id, CASE v_table WHEN 'journal_publication_indexing' THEN 'journal_publication' ELSE 'conference_activity' END, 'STAFF_PROFILE.STAFF_ACTIVITY', 'UPDATE') THEN
        RAISE EXCEPTION 'Not authorised (STAFF_PROFILE.STAFF_ACTIVITY.UPDATE) or the record cannot be changed now' USING ERRCODE = '42501';
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.staff_activity_id = $1 AND t.indexing_agency_id = $2', v_table) INTO v_before USING p_activity_id, p_agency_id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown row' USING ERRCODE = '22023'; END IF;
    EXECUTE format('DELETE FROM public.%I WHERE staff_activity_id = $1 AND indexing_agency_id = $2', v_table) USING p_activity_id, p_agency_id;
    PERFORM sims_private.audit_manual('STAFF_PROFILE', 'DELETE', v_table, p_activity_id, v_before, NULL);
END $$;

-- ---------------------------------------------------------------
-- reference data: journal metrics and metric types; journals and organisations as selectable lookups
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_private.ref_def(p_table text) RETURNS TABLE (perm text, module_code text, label text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT v.perm, v.module_code, v.label FROM (VALUES
        ('blood_group', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Blood groups'), ('caste', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Castes'), ('country', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Countries'),
        ('gender', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Genders'), ('religion', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Religions'), ('social_category', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Social categories'),
        ('state', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'States'), ('sub_caste', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Sub-castes'), ('document_type', 'IAM.ALL.CONFIGURE', 'PLATFORM', 'Document types'),
        ('publication_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Publication types'), ('journal_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Journal types'),
        ('indexing_agency', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Indexing agencies'), ('funding_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Funding types'),
        ('award_category', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Award categories'), ('membership_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Membership types'),
        ('metric_type', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Journal metric types'), ('journal_metric', 'STAFF_PROFILE.ALL.CONFIGURE', 'STAFF_PROFILE', 'Journal metrics'),
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

CREATE OR REPLACE FUNCTION sims_private.ref_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['blood_group', 'caste', 'country', 'gender', 'religion', 'social_category', 'state', 'sub_caste', 'document_type', 'publication_type', 'journal_type', 'indexing_agency', 'funding_type',
                 'award_category', 'membership_type', 'metric_type', 'journal_metric', 'qualification_level', 'education_institution', 'awarding_body', 'study_mode', 'previous_organization', 'staff_category', 'staff_type',
                 'designation', 'fee_category', 'financial_ledger_account', 'fee_type', 'late_fee_rule', 'late_fee_slab', 'concession_type', 'scholarship_scheme', 'installment_plan', 'payment_mode']
$$;

-- journals can be picked in the journal-metric form (they are maintained through the staff-profile lookups of migration 044)
CREATE OR REPLACE FUNCTION sims_private.section_option_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT sims_private.ref_tables() || ARRAY['journal', 'external_organization']
$$;

REVOKE ALL ON FUNCTION public.staff_indexing_list(bigint), public.staff_indexing_save(bigint, integer, text, integer, text, text), public.staff_indexing_delete(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_indexing_list(bigint), public.staff_indexing_save(bigint, integer, text, integer, text, text), public.staff_indexing_delete(bigint, integer) TO authenticated;
