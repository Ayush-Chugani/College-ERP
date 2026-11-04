-- Fee structures: maintenance and approval (KI-42, KI-58). Hand-written (not from the MySQL source).
--
-- A fee structure is the price list for a programme (or a whole institution) and academic year. It is drafted with items (fee type, semester or term, amount, due date, instalment and waiver flags,
-- late-fee rule), submitted, and approved by someone else. Approving supersedes any earlier APPROVED structure with the same scope. Assessments are still created by fin_create_fee_assessment (M021);
-- this migration does not generate assessments from a structure.
--
-- RULES (my inferences, KI-69): authority is FEES.FEE_STRUCTURE.<action> at the programme (when the structure names one) or the institution; a structure can be edited only while DRAFT or REJECTED;
-- submitting needs at least one item; the approver must be a different person from the submitter; rejecting needs a reason (kept in remarks); a new version is a copy of an approved or superseded
-- structure (code <code>-V<n>) which starts as a DRAFT; a structure that assessments already use cannot be deleted. Every step writes fee_activity_audit.

CREATE FUNCTION sims_private.fs_can(p_institution bigint, p_programme bigint, p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN p_programme IS NOT NULL THEN sims_private.can_programme(ARRAY['FEES.FEE_STRUCTURE.' || p_action]::text[], p_programme)
                ELSE sims_private.can_institution(ARRAY['FEES.FEE_STRUCTURE.' || p_action]::text[], p_institution) END
$$;
REVOKE ALL ON FUNCTION sims_private.fs_can(bigint, bigint, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sims_private.fs_load(p_id bigint, p_action text) RETURNS public.fee_structure
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE;
BEGIN
    SELECT * INTO s FROM fee_structure WHERE fee_structure_id = p_id FOR UPDATE;
    IF s.fee_structure_id IS NULL OR NOT COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, p_action), false) THEN
        RAISE EXCEPTION 'Not authorised (FEES.FEE_STRUCTURE.%) or unknown fee structure', p_action USING ERRCODE = '42501';
    END IF;
    RETURN s;
END $$;
REVOKE ALL ON FUNCTION sims_private.fs_load(bigint, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fin_structure_save(p_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s public.fee_structure%ROWTYPE; v_id bigint;
    v_code text := NULLIF(btrim(p ->> 'structure_code'), ''); v_name text := NULLIF(btrim(p ->> 'structure_name'), '');
    v_inst integer := NULLIF(p ->> 'institution_id', '')::integer; v_campus integer := NULLIF(p ->> 'campus_id', '')::integer; v_prog integer := NULLIF(p ->> 'programme_id', '')::integer;
    v_year integer := NULLIF(p ->> 'academic_year_id', '')::integer; v_cat integer := NULLIF(p ->> 'admission_category_id', '')::integer;
    v_from date := NULLIF(p ->> 'effective_from', '')::date; v_to date := NULLIF(p ->> 'effective_to', '')::date; v_rem text := NULLIF(btrim(p ->> 'remarks'), '');
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'p must be an object' USING ERRCODE = '22023'; END IF;
    IF p_id IS NOT NULL THEN
        s := sims_private.fs_load(p_id, 'UPDATE');
        IF s.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % fee structure cannot be edited', s.approval_status USING ERRCODE = '45000'; END IF;
        v_code := COALESCE(v_code, s.structure_code);
    END IF;
    IF v_code IS NULL OR length(v_code) > 50 OR v_name IS NULL OR length(v_name) > 200 THEN RAISE EXCEPTION 'A code (at most 50 characters) and a name (at most 200) are required' USING ERRCODE = '22023'; END IF;
    IF v_inst IS NULL OR NOT EXISTS (SELECT 1 FROM institution WHERE institution_id = v_inst) THEN RAISE EXCEPTION 'Choose an institution' USING ERRCODE = '22023'; END IF;
    IF v_campus IS NOT NULL AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id = v_campus AND institution_id = v_inst) THEN RAISE EXCEPTION 'The campus does not belong to that institution' USING ERRCODE = '22023'; END IF;
    IF v_prog IS NOT NULL AND NOT EXISTS (SELECT 1 FROM programme pr JOIN department d ON d.department_id = pr.department_id JOIN campus c ON c.campus_id = d.campus_id WHERE pr.programme_id = v_prog AND c.institution_id = v_inst) THEN
        RAISE EXCEPTION 'The programme does not belong to that institution' USING ERRCODE = '22023';
    END IF;
    IF v_year IS NULL OR NOT EXISTS (SELECT 1 FROM academic_year WHERE academic_year_id = v_year) THEN RAISE EXCEPTION 'Choose an academic year' USING ERRCODE = '22023'; END IF;
    IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admission_category WHERE admission_category_id = v_cat) THEN RAISE EXCEPTION 'Unknown admission category' USING ERRCODE = '22023'; END IF;
    IF v_from IS NULL THEN RAISE EXCEPTION 'The effective-from date is required' USING ERRCODE = '22023'; END IF;
    IF v_to IS NOT NULL AND v_to < v_from THEN RAISE EXCEPTION 'The effective-to date cannot be before the start' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_id IS NULL THEN
        IF NOT COALESCE(sims_private.fs_can(v_inst, v_prog, 'CREATE'), false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_STRUCTURE.CREATE) for that scope' USING ERRCODE = '42501'; END IF;
        BEGIN
            INSERT INTO fee_structure (structure_code, structure_name, institution_id, campus_id, programme_id, academic_year_id, admission_category_id, effective_from, effective_to, approval_status, remarks)
            VALUES (v_code, v_name, v_inst, v_campus, v_prog, v_year, v_cat, v_from, v_to, 'DRAFT', v_rem) RETURNING fee_structure_id INTO v_id;
        EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That structure code is already used' USING ERRCODE = '23505';
        END;
        PERFORM sims_private.fin_audit('STRUCTURE_CREATED', 'fee_structure', v_id, NULL, jsonb_build_object('code', v_code));
        RETURN v_id;
    END IF;
    IF (v_inst, v_prog) IS DISTINCT FROM (s.institution_id, s.programme_id) AND NOT COALESCE(sims_private.fs_can(v_inst, v_prog, 'CREATE'), false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_STRUCTURE.CREATE) for that scope' USING ERRCODE = '42501'; END IF;
    BEGIN
        UPDATE fee_structure SET structure_code = v_code, structure_name = v_name, institution_id = v_inst, campus_id = v_campus, programme_id = v_prog, specialization_id = NULL, academic_year_id = v_year,
               admission_category_id = v_cat, effective_from = v_from, effective_to = v_to, remarks = v_rem, approval_status = 'DRAFT' WHERE fee_structure_id = p_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That structure code is already used' USING ERRCODE = '23505';
    END;
    PERFORM sims_private.fin_audit('STRUCTURE_UPDATED', 'fee_structure', p_id, NULL, jsonb_build_object('code', v_code));
    RETURN p_id;
END $$;

CREATE FUNCTION public.fin_structure_item_save(p_structure_id bigint, p_item_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s public.fee_structure%ROWTYPE; v_id bigint; v_amt numeric := NULLIF(p ->> 'amount', '')::numeric;
    v_type integer := NULLIF(p ->> 'fee_type_id', '')::integer; v_sem integer := NULLIF(p ->> 'semester_id', '')::integer; v_term integer := NULLIF(p ->> 'academic_term_id', '')::integer;
    v_due date := NULLIF(p ->> 'due_date', '')::date; v_days integer := NULLIF(p ->> 'due_days_from_registration', '')::integer; v_late integer := NULLIF(p ->> 'late_fee_rule_id', '')::integer;
    v_inst boolean := COALESCE((p ->> 'installment_allowed')::boolean, false); v_waive boolean := COALESCE((p ->> 'waiver_allowed')::boolean, false);
    v_order integer := COALESCE(NULLIF(p ->> 'display_order', '')::integer, 0); v_rem text := NULLIF(btrim(p ->> 'remarks'), '');
BEGIN
    s := sims_private.fs_load(p_structure_id, 'UPDATE');
    IF s.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % fee structure cannot be edited', s.approval_status USING ERRCODE = '45000'; END IF;
    IF v_type IS NULL OR NOT EXISTS (SELECT 1 FROM fee_type WHERE fee_type_id = v_type) THEN RAISE EXCEPTION 'Choose a fee type' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.fin_check_amount(v_amt, 'amount');
    IF v_sem IS NOT NULL AND NOT EXISTS (SELECT 1 FROM semester WHERE semester_id = v_sem) THEN RAISE EXCEPTION 'Unknown semester' USING ERRCODE = '22023'; END IF;
    IF v_term IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_term WHERE academic_term_id = v_term) THEN RAISE EXCEPTION 'Unknown academic term' USING ERRCODE = '22023'; END IF;
    IF v_late IS NOT NULL AND NOT EXISTS (SELECT 1 FROM late_fee_rule WHERE late_fee_rule_id = v_late) THEN RAISE EXCEPTION 'Unknown late-fee rule' USING ERRCODE = '22023'; END IF;
    IF v_days IS NOT NULL AND (v_days < 0 OR v_days > 3650) THEN RAISE EXCEPTION 'Due days must be between 0 and 3650' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    BEGIN
        IF p_item_id IS NULL THEN
            INSERT INTO fee_structure_item (fee_structure_id, fee_type_id, semester_id, academic_term_id, amount, due_date, due_days_from_registration, installment_allowed, waiver_allowed, late_fee_rule_id, display_order, remarks)
            VALUES (p_structure_id, v_type, v_sem, v_term, v_amt, v_due, v_days, v_inst, v_waive, v_late, v_order, v_rem) RETURNING fee_structure_item_id INTO v_id;
        ELSE
            UPDATE fee_structure_item SET fee_type_id = v_type, semester_id = v_sem, academic_term_id = v_term, amount = v_amt, due_date = v_due, due_days_from_registration = v_days, installment_allowed = v_inst,
                   waiver_allowed = v_waive, late_fee_rule_id = v_late, display_order = v_order, remarks = v_rem WHERE fee_structure_item_id = p_item_id AND fee_structure_id = p_structure_id RETURNING fee_structure_item_id INTO v_id;
            IF v_id IS NULL THEN RAISE EXCEPTION 'Unknown item' USING ERRCODE = '22023'; END IF;
        END IF;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That fee type already has an item for the same semester and term' USING ERRCODE = '23505';
    END;
    UPDATE fee_structure SET approval_status = 'DRAFT' WHERE fee_structure_id = p_structure_id AND approval_status = 'REJECTED';
    PERFORM sims_private.fin_audit('STRUCTURE_ITEM_SAVED', 'fee_structure_item', v_id, NULL, jsonb_build_object('structure_id', p_structure_id, 'amount', v_amt));
    RETURN v_id;
END $$;

CREATE FUNCTION public.fin_structure_item_delete(p_structure_id bigint, p_item_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE;
BEGIN
    s := sims_private.fs_load(p_structure_id, 'UPDATE');
    IF s.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % fee structure cannot be edited', s.approval_status USING ERRCODE = '45000'; END IF;
    BEGIN
        DELETE FROM fee_structure_item WHERE fee_structure_item_id = p_item_id AND fee_structure_id = p_structure_id;
    EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Assessments already use this item' USING ERRCODE = '45000';
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown item' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.fin_audit('STRUCTURE_ITEM_DELETED', 'fee_structure_item', p_item_id, NULL, jsonb_build_object('structure_id', p_structure_id));
END $$;

CREATE FUNCTION public.fin_structure_submit(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE;
BEGIN
    s := sims_private.fs_load(p_id, 'UPDATE');
    IF s.approval_status = 'SUBMITTED' THEN RETURN; END IF;
    IF s.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % fee structure cannot be submitted', s.approval_status USING ERRCODE = '45000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM fee_structure_item WHERE fee_structure_id = p_id) THEN RAISE EXCEPTION 'Add at least one item before submitting' USING ERRCODE = '45000'; END IF;
    UPDATE fee_structure SET approval_status = 'SUBMITTED' WHERE fee_structure_id = p_id;
    PERFORM sims_private.fin_audit('STRUCTURE_SUBMITTED', 'fee_structure', p_id, NULL, NULL);
END $$;

CREATE FUNCTION public.fin_structure_decide(p_id bigint, p_approve boolean, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE; v_rem text := NULLIF(btrim(p_remarks), '');
BEGIN
    s := sims_private.fs_load(p_id, 'APPROVE');
    IF s.approval_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted fee structure can be decided (status %)', s.approval_status USING ERRCODE = '45000'; END IF;
    IF EXISTS (SELECT 1 FROM fee_activity_audit WHERE entity_name = 'fee_structure' AND entity_id = p_id AND action_code = 'STRUCTURE_SUBMITTED' AND user_id = sims_private.current_user_id()) THEN
        RAISE EXCEPTION 'You cannot decide a fee structure that you submitted yourself' USING ERRCODE = '45000';
    END IF;
    IF NOT p_approve AND v_rem IS NULL THEN RAISE EXCEPTION 'A reason is required to reject' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_approve THEN
        UPDATE fee_structure SET approval_status = 'SUPERSEDED'
         WHERE fee_structure_id <> p_id AND approval_status = 'APPROVED' AND institution_id = s.institution_id AND campus_id IS NOT DISTINCT FROM s.campus_id AND programme_id IS NOT DISTINCT FROM s.programme_id
           AND specialization_id IS NOT DISTINCT FROM s.specialization_id AND academic_year_id = s.academic_year_id AND admission_category_id IS NOT DISTINCT FROM s.admission_category_id;
        UPDATE fee_structure SET approval_status = 'APPROVED', approved_by = sims_private.current_user_id(), approved_at = now(), remarks = COALESCE(v_rem, remarks) WHERE fee_structure_id = p_id;
    ELSE
        UPDATE fee_structure SET approval_status = 'REJECTED', remarks = v_rem WHERE fee_structure_id = p_id;
    END IF;
    PERFORM sims_private.fin_audit(CASE WHEN p_approve THEN 'STRUCTURE_APPROVED' ELSE 'STRUCTURE_REJECTED' END, 'fee_structure', p_id, NULL, jsonb_build_object('remarks', v_rem));
END $$;

CREATE FUNCTION public.fin_structure_new_version(p_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE; v_new bigint; v_ver integer; v_base text;
BEGIN
    s := sims_private.fs_load(p_id, 'CREATE');
    IF s.approval_status NOT IN ('APPROVED', 'SUPERSEDED') THEN RAISE EXCEPTION 'Only an approved or superseded fee structure can be versioned (status %)', s.approval_status USING ERRCODE = '45000'; END IF;
    v_ver := s.version_number + 1;
    v_base := regexp_replace(s.structure_code, '-V[0-9]+$', '');
    WHILE EXISTS (SELECT 1 FROM fee_structure WHERE structure_code = left(v_base, 45) || '-V' || v_ver) LOOP v_ver := v_ver + 1; END LOOP;
    INSERT INTO fee_structure (structure_code, structure_name, institution_id, campus_id, programme_id, specialization_id, academic_year_id, admission_category_id, version_number, effective_from, effective_to, approval_status, remarks)
    VALUES (left(v_base, 45) || '-V' || v_ver, s.structure_name, s.institution_id, s.campus_id, s.programme_id, s.specialization_id, s.academic_year_id, s.admission_category_id, v_ver, s.effective_from, s.effective_to, 'DRAFT', 'Copied from ' || s.structure_code)
    RETURNING fee_structure_id INTO v_new;
    INSERT INTO fee_structure_item (fee_structure_id, fee_type_id, semester_id, academic_term_id, amount, due_date, due_days_from_registration, installment_allowed, waiver_allowed, late_fee_rule_id, display_order, remarks)
    SELECT v_new, fee_type_id, semester_id, academic_term_id, amount, due_date, due_days_from_registration, installment_allowed, waiver_allowed, late_fee_rule_id, display_order, remarks FROM fee_structure_item WHERE fee_structure_id = p_id;
    PERFORM sims_private.fin_audit('STRUCTURE_VERSIONED', 'fee_structure', v_new, NULL, jsonb_build_object('from', p_id));
    RETURN v_new;
END $$;

CREATE FUNCTION public.fin_structure_delete(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fee_structure%ROWTYPE;
BEGIN
    s := sims_private.fs_load(p_id, 'DELETE');
    IF s.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % fee structure cannot be deleted', s.approval_status USING ERRCODE = '45000'; END IF;
    IF EXISTS (SELECT 1 FROM student_fee_assessment WHERE fee_structure_id = p_id) THEN RAISE EXCEPTION 'Assessments already use this fee structure' USING ERRCODE = '45000'; END IF;
    DELETE FROM fee_structure_item WHERE fee_structure_id = p_id;
    DELETE FROM fee_structure WHERE fee_structure_id = p_id;
    PERFORM sims_private.fin_audit('STRUCTURE_DELETED', 'fee_structure', p_id, NULL, jsonb_build_object('code', s.structure_code));
END $$;

CREATE FUNCTION public.fin_structure_list(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (fee_structure_id bigint, structure_code text, structure_name text, institution_name text, programme_name text, year_code text, version_number integer, approval_status text, effective_from date, effective_to date, item_count bigint, total_amount numeric, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH v AS (
        SELECT f.fee_structure_id, f.structure_code, f.structure_name, i.institution_name, p.programme_name, y.year_code, f.version_number, f.approval_status, f.effective_from, f.effective_to,
               (SELECT count(*) FROM fee_structure_item x WHERE x.fee_structure_id = f.fee_structure_id) AS item_count, (SELECT COALESCE(sum(x.amount), 0) FROM fee_structure_item x WHERE x.fee_structure_id = f.fee_structure_id) AS total_amount
        FROM fee_structure f JOIN institution i ON i.institution_id = f.institution_id LEFT JOIN programme p ON p.programme_id = f.programme_id JOIN academic_year y ON y.academic_year_id = f.academic_year_id
        WHERE sims_private.fs_can(f.institution_id, f.programme_id, 'READ') AND (p_status IS NULL OR f.approval_status = p_status)
          AND (p_search IS NULL OR p_search = '' OR f.structure_code ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' OR f.structure_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
    SELECT v.fee_structure_id::bigint, v.structure_code::text, v.structure_name::text, v.institution_name::text, v.programme_name::text, v.year_code::text, v.version_number::integer, v.approval_status::text, v.effective_from, v.effective_to,
           v.item_count, v.total_amount::numeric, count(*) OVER ()
    FROM v ORDER BY v.effective_from DESC, v.fee_structure_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.fin_structure_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s record; v_editable boolean;
BEGIN
    SELECT f.*, i.institution_name, p.programme_name, y.year_code INTO s FROM fee_structure f JOIN institution i ON i.institution_id = f.institution_id LEFT JOIN programme p ON p.programme_id = f.programme_id
      JOIN academic_year y ON y.academic_year_id = f.academic_year_id WHERE f.fee_structure_id = p_id;
    IF s.fee_structure_id IS NULL OR NOT COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, 'READ'), false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_STRUCTURE.READ) or unknown fee structure' USING ERRCODE = '42501'; END IF;
    v_editable := s.approval_status IN ('DRAFT', 'REJECTED') AND COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, 'UPDATE'), false);
    RETURN jsonb_build_object('fee_structure_id', s.fee_structure_id, 'structure_code', s.structure_code, 'structure_name', s.structure_name, 'institution_id', s.institution_id, 'institution_name', s.institution_name,
        'campus_id', s.campus_id, 'programme_id', s.programme_id, 'programme_name', s.programme_name, 'academic_year_id', s.academic_year_id, 'year_code', s.year_code, 'admission_category_id', s.admission_category_id,
        'version_number', s.version_number, 'effective_from', s.effective_from, 'effective_to', s.effective_to, 'approval_status', s.approval_status, 'remarks', s.remarks, 'approved_at', s.approved_at,
        'can_edit', v_editable, 'can_submit', v_editable,
        'can_decide', s.approval_status = 'SUBMITTED' AND COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, 'APPROVE'), false)
                      AND NOT EXISTS (SELECT 1 FROM fee_activity_audit a WHERE a.entity_name = 'fee_structure' AND a.entity_id = p_id AND a.action_code = 'STRUCTURE_SUBMITTED' AND a.user_id = sims_private.current_user_id()),
        'can_version', s.approval_status IN ('APPROVED', 'SUPERSEDED') AND COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, 'CREATE'), false),
        'can_delete', s.approval_status IN ('DRAFT', 'REJECTED') AND COALESCE(sims_private.fs_can(s.institution_id, s.programme_id, 'DELETE'), false),
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.fee_structure_item_id, 'fee_type_id', x.fee_type_id, 'fee_type', t.fee_name, 'semester_id', x.semester_id, 'academic_term_id', x.academic_term_id, 'amount', x.amount,
                  'due_date', x.due_date, 'due_days', x.due_days_from_registration, 'installment_allowed', x.installment_allowed, 'waiver_allowed', x.waiver_allowed, 'late_fee_rule_id', x.late_fee_rule_id,
                  'display_order', x.display_order, 'remarks', x.remarks) ORDER BY x.display_order, x.fee_structure_item_id)
                  FROM fee_structure_item x JOIN fee_type t ON t.fee_type_id = x.fee_type_id WHERE x.fee_structure_id = p_id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.fin_structure_save(bigint, jsonb), public.fin_structure_item_save(bigint, bigint, jsonb), public.fin_structure_item_delete(bigint, bigint), public.fin_structure_submit(bigint),
    public.fin_structure_decide(bigint, boolean, text), public.fin_structure_new_version(bigint), public.fin_structure_delete(bigint), public.fin_structure_list(text, text, integer, integer), public.fin_structure_get(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_structure_save(bigint, jsonb), public.fin_structure_item_save(bigint, bigint, jsonb), public.fin_structure_item_delete(bigint, bigint), public.fin_structure_submit(bigint),
    public.fin_structure_decide(bigint, boolean, text), public.fin_structure_new_version(bigint), public.fin_structure_delete(bigint), public.fin_structure_list(text, text, integer, integer), public.fin_structure_get(bigint) TO authenticated;
