-- Finance completion: concessions, scholarships, sponsorships, adjustments, instalments, late fees and penalties (KI-59). Hand-written (not from the MySQL source).
-- Same conventions as migrations 021 and 047: clients never write money tables, every RPC authorises FEES.<resource>.<action> at the student's scope, nothing trusts
-- caller-supplied totals, every action writes fee_activity_audit.
--
-- ASSUMPTIONS (the source defines none of these; the owner said "use your defaults", so the workflow is entry + approval and the only calculations are
-- the deterministic ones listed here):
--  1  A benefit (concession, scholarship, sponsorship) is requested (FEE_BENEFIT.CREATE), decided (FEE_BENEFIT.APPROVE) and applied to a fee item (FEE_BENEFIT.UPDATE).
--     The person who requested it cannot approve it. While SUBMITTED the amount columns hold the requested value; the decision may change it within the type's limits.
--     Concession: PERCENTAGE basis applies approved_percentage of each item's original amount; FIXED_AMOUNT is a total across items. Scholarship and sponsorship are fixed totals.
--     A scholarship goes SUBMITTED -> SANCTIONED (the VERIFIED step is not used). Applying a sponsorship reduces scholarship_amount (items have no separate column).
--  2  Applying a benefit raises the item's concession_amount or scholarship_amount, lowers net and balance, and is capped by the approved value, the item's original
--     amount (migration 014 trigger) and the amount already paid.
--  3  Adjustments: types CREDIT, WAIVER and WRITE_OFF lower an item, DEBIT raises it; they are requested (FEE_REFUND.CREATE), approved by someone else (FEE_REFUND.APPROVE)
--     and take effect on approval. TRANSFER and CORRECTION are not supported. A reduction cannot go below what was already paid.
--  4  Instalments: the schedule spreads net_payable_amount over the plan's number of instalments, monthly from the first due date; the first instalment is at least the
--     plan's minimum initial percentage; the last takes the rounding remainder. Payments are matched to instalments oldest first when the schedule is refreshed.
--     An assessment with an active schedule cannot receive benefits or adjustments (cancel the schedule first).
--  5  Late fees: fin_late_fee_suggest computes the amount from a late_fee_rule (FIXED, PER_DAY, PERCENTAGE of the balance, SLAB) after the grace period, capped by the rule's
--     maximum; it only suggests. A person assesses the penalty (it becomes a PENALTY assessment with one item, payable like any other) and a second person can waive part of it.

CREATE SEQUENCE sims_private.fee_penalty_seq;

CREATE FUNCTION sims_private.fin_authorize_student(p_student_id bigint, p_resource text, p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_student_id IS NULL OR NOT sims_private.can_student(ARRAY['FEES.' || p_resource || '.' || p_action]::text[], p_student_id, true) THEN
        RAISE EXCEPTION 'Not authorised (FEES.%.%) or unknown student', p_resource, p_action USING ERRCODE = '42501';
    END IF;
END $$;

-- item/header status follows the balance (same rule as fin_allocate_payment, plus fully covered items count as WAIVED)
CREATE FUNCTION sims_private.fin_refresh_status(p_item_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_fa bigint;
BEGIN
    UPDATE student_fee_assessment_item
       SET item_status = CASE WHEN balance_amount = 0 AND amount_paid > 0 THEN 'PAID' WHEN balance_amount = 0 THEN 'WAIVED' WHEN amount_paid > 0 THEN 'PARTIALLY_PAID' ELSE item_status END
     WHERE assessment_item_id = p_item_id AND item_status IN ('ASSESSED', 'PARTIALLY_PAID', 'OVERDUE')
    RETURNING fee_assessment_id INTO v_fa;
    IF v_fa IS NOT NULL THEN
        UPDATE student_fee_assessment
           SET assessment_status = CASE WHEN balance_amount = 0 AND amount_paid > 0 THEN 'PAID' WHEN balance_amount = 0 THEN 'WAIVED' WHEN amount_paid > 0 THEN 'PARTIALLY_PAID' ELSE assessment_status END
         WHERE fee_assessment_id = v_fa AND assessment_status IN ('ASSESSED', 'PARTIALLY_PAID', 'OVERDUE');
    END IF;
END $$;

-- an item must be editable: open, in a student account, and not under an instalment schedule
CREATE FUNCTION sims_private.fin_editable_item(p_item_id bigint) RETURNS TABLE (student_id bigint, student_account_id bigint, fee_assessment_id bigint, original_amount numeric, net_amount numeric, amount_paid numeric, balance_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT a.student_account_id AS acc, f.student_id AS stu, i.fee_assessment_id AS fa, i.item_status, i.original_amount AS orig, i.net_amount AS net, i.amount_paid AS paid, i.balance_amount AS bal
      INTO r
      FROM student_fee_assessment_item i
      JOIN student_fee_assessment a ON a.fee_assessment_id = i.fee_assessment_id
      JOIN student_financial_account f ON f.student_account_id = a.student_account_id
     WHERE i.assessment_item_id = p_item_id FOR UPDATE OF i;
    IF r.acc IS NULL THEN RAISE EXCEPTION 'Unknown fee item' USING ERRCODE = '45000'; END IF;
    IF r.item_status IN ('CANCELLED', 'WAIVED') THEN RAISE EXCEPTION 'Fee item is %', r.item_status USING ERRCODE = '45000'; END IF;
    IF EXISTS (SELECT 1 FROM student_installment_schedule s WHERE s.fee_assessment_id = r.fa AND s.installment_status <> 'CANCELLED') THEN
        RAISE EXCEPTION 'The assessment has an instalment schedule: cancel it before changing the amounts' USING ERRCODE = '45000';
    END IF;
    RETURN QUERY SELECT r.stu::bigint, r.acc::bigint, r.fa::bigint, r.orig::numeric, r.net::numeric, r.paid::numeric, r.bal::numeric;
END $$;

CREATE FUNCTION sims_private.fin_creator_is_caller(p_entity text, p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM fee_activity_audit WHERE entity_name = p_entity AND entity_id = p_id AND action_code IN ('BENEFIT_REQUESTED', 'ADJUSTMENT_REQUESTED') AND user_id = sims_private.current_user_id())
$$;

-- ---------------------------------------------------------------
-- Benefits
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_benefit_create(p_kind text, p_student_id bigint, p_academic_year_id integer, p_type_id bigint, p_amount numeric, p_percentage numeric,
                                          p_reference text, p_authority text, p_remarks text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_t record; v_s record;
BEGIN
    PERFORM sims_private.fin_authorize_student(p_student_id, 'FEE_BENEFIT', 'CREATE');
    IF p_kind NOT IN ('CONCESSION', 'SCHOLARSHIP', 'SPONSORSHIP') THEN RAISE EXCEPTION 'Unknown benefit kind' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM academic_year WHERE academic_year_id = p_academic_year_id) THEN RAISE EXCEPTION 'Unknown academic year' USING ERRCODE = '22023'; END IF;
    IF p_remarks IS NOT NULL AND length(p_remarks) > 500 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    IF p_kind = 'CONCESSION' THEN
        SELECT * INTO v_t FROM concession_type WHERE concession_type_id = p_type_id AND is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive concession type' USING ERRCODE = '22023'; END IF;
        IF v_t.concession_basis = 'PERCENTAGE' THEN
            IF p_percentage IS NULL OR p_percentage <= 0 OR p_percentage > 100 OR p_percentage <> round(p_percentage, 2) THEN RAISE EXCEPTION 'A percentage between 0 and 100 is required' USING ERRCODE = '22023'; END IF;
            IF v_t.maximum_percentage IS NOT NULL AND p_percentage > v_t.maximum_percentage THEN RAISE EXCEPTION 'The percentage exceeds the maximum of % for this concession type', v_t.maximum_percentage USING ERRCODE = '45000'; END IF;
        ELSE
            PERFORM sims_private.fin_check_amount(p_amount, 'amount');
            IF v_t.maximum_amount IS NOT NULL AND p_amount > v_t.maximum_amount THEN RAISE EXCEPTION 'The amount exceeds the maximum of % for this concession type', v_t.maximum_amount USING ERRCODE = '45000'; END IF;
        END IF;
        INSERT INTO student_fee_concession (student_id, concession_type_id, academic_year_id, application_number, application_date, approved_percentage, approved_amount, approval_status, remarks)
        VALUES (p_student_id, p_type_id, p_academic_year_id, left(p_reference, 50), current_date,
                CASE WHEN v_t.concession_basis = 'PERCENTAGE' THEN p_percentage END, CASE WHEN v_t.concession_basis = 'FIXED_AMOUNT' THEN p_amount END, 'SUBMITTED', p_remarks)
        RETURNING student_concession_id INTO v_id;
        PERFORM sims_private.fin_audit('BENEFIT_REQUESTED', 'student_fee_concession', v_id, NULL, jsonb_build_object('student_id', p_student_id, 'type', p_type_id, 'amount', p_amount, 'percentage', p_percentage));
    ELSIF p_kind = 'SCHOLARSHIP' THEN
        SELECT * INTO v_s FROM scholarship_scheme WHERE scholarship_scheme_id = p_type_id AND is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive scholarship scheme' USING ERRCODE = '22023'; END IF;
        PERFORM sims_private.fin_check_amount(p_amount, 'amount');
        IF v_s.maximum_amount IS NOT NULL AND p_amount > v_s.maximum_amount THEN RAISE EXCEPTION 'The amount exceeds the maximum of % for this scheme', v_s.maximum_amount USING ERRCODE = '45000'; END IF;
        INSERT INTO student_scholarship (student_id, scholarship_scheme_id, academic_year_id, application_number, applied_amount, application_status, remarks)
        VALUES (p_student_id, p_type_id, p_academic_year_id, left(p_reference, 60), p_amount, 'SUBMITTED', p_remarks)
        RETURNING student_scholarship_id INTO v_id;
        PERFORM sims_private.fin_audit('BENEFIT_REQUESTED', 'student_scholarship', v_id, NULL, jsonb_build_object('student_id', p_student_id, 'scheme', p_type_id, 'amount', p_amount));
    ELSE
        PERFORM sims_private.fin_check_amount(p_amount, 'amount');
        IF p_authority IS NULL OR btrim(p_authority) = '' OR p_reference IS NULL OR btrim(p_reference) = '' THEN RAISE EXCEPTION 'The sponsoring authority and the sanction reference are required' USING ERRCODE = '22023'; END IF;
        INSERT INTO student_sponsorship (student_id, academic_year_id, sponsoring_authority, sanction_reference, sanctioned_amount, approval_status)
        VALUES (p_student_id, p_academic_year_id, left(p_authority, 200), left(p_reference, 100), p_amount, 'PENDING')
        RETURNING student_sponsorship_id INTO v_id;
        PERFORM sims_private.fin_audit('BENEFIT_REQUESTED', 'student_sponsorship', v_id, NULL, jsonb_build_object('student_id', p_student_id, 'amount', p_amount));
    END IF;
    RETURN v_id;
END $$;

-- one normalised view of a benefit row (locked)
CREATE FUNCTION sims_private.fin_benefit_load(p_kind text, p_id bigint)
RETURNS TABLE (student_id bigint, status text, open_status text, usable_status text, basis text, pct numeric, amount numeric, max_pct numeric, max_amount numeric, valid_from date, valid_to date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_kind = 'CONCESSION' THEN
        RETURN QUERY SELECT c.student_id::bigint, c.approval_status::text, 'SUBMITTED'::text, 'APPROVED'::text, t.concession_basis::text, c.approved_percentage::numeric, c.approved_amount::numeric,
                            t.maximum_percentage::numeric, t.maximum_amount::numeric, c.valid_from, c.valid_to
                       FROM student_fee_concession c JOIN concession_type t ON t.concession_type_id = c.concession_type_id WHERE c.student_concession_id = p_id FOR UPDATE OF c;
    ELSIF p_kind = 'SCHOLARSHIP' THEN
        RETURN QUERY SELECT s.student_id::bigint, s.application_status::text, 'SUBMITTED'::text, 'SANCTIONED'::text, 'FIXED_AMOUNT'::text, NULL::numeric, COALESCE(s.sanctioned_amount, s.applied_amount)::numeric,
                            NULL::numeric, m.maximum_amount::numeric, NULL::date, NULL::date
                       FROM student_scholarship s JOIN scholarship_scheme m ON m.scholarship_scheme_id = s.scholarship_scheme_id WHERE s.student_scholarship_id = p_id FOR UPDATE OF s;
    ELSIF p_kind = 'SPONSORSHIP' THEN
        RETURN QUERY SELECT s.student_id::bigint, s.approval_status::text, 'PENDING'::text, 'APPROVED'::text, 'FIXED_AMOUNT'::text, NULL::numeric, s.sanctioned_amount::numeric,
                            NULL::numeric, NULL::numeric, s.valid_from, s.valid_to
                       FROM student_sponsorship s WHERE s.student_sponsorship_id = p_id FOR UPDATE OF s;
    ELSE
        RAISE EXCEPTION 'Unknown benefit kind' USING ERRCODE = '22023';
    END IF;
END $$;

CREATE FUNCTION public.fin_benefit_decide(p_kind text, p_id bigint, p_approve boolean, p_amount numeric DEFAULT NULL, p_percentage numeric DEFAULT NULL, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; v_pct numeric; v_amt numeric;
BEGIN
    SELECT * INTO b FROM sims_private.fin_benefit_load(p_kind, p_id);
    IF b.student_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_BENEFIT.APPROVE) or unknown benefit' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize_student(b.student_id, 'FEE_BENEFIT', 'APPROVE');
    IF b.status <> b.open_status THEN RAISE EXCEPTION 'Only a % request can be decided (status %)', lower(b.open_status), b.status USING ERRCODE = '45000'; END IF;
    IF sims_private.fin_creator_is_caller(CASE p_kind WHEN 'CONCESSION' THEN 'student_fee_concession' WHEN 'SCHOLARSHIP' THEN 'student_scholarship' ELSE 'student_sponsorship' END, p_id) THEN
        RAISE EXCEPTION 'You cannot decide a request that you made yourself' USING ERRCODE = '45000';
    END IF;
    IF NOT p_approve AND (p_remarks IS NULL OR btrim(p_remarks) = '') THEN RAISE EXCEPTION 'A reason is required to reject' USING ERRCODE = '22023'; END IF;
    IF p_remarks IS NOT NULL AND length(p_remarks) > 500 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    IF p_approve THEN
        v_pct := COALESCE(p_percentage, b.pct); v_amt := COALESCE(p_amount, b.amount);
        IF p_kind = 'CONCESSION' THEN
            IF b.basis = 'PERCENTAGE' THEN
                IF v_pct IS NULL OR v_pct <= 0 OR v_pct > 100 OR v_pct <> round(v_pct, 2) OR (b.max_pct IS NOT NULL AND v_pct > b.max_pct) THEN RAISE EXCEPTION 'The approved percentage is not allowed for this concession type' USING ERRCODE = '45000'; END IF;
                v_amt := NULL;
            ELSE
                PERFORM sims_private.fin_check_amount(v_amt, 'amount');
                IF b.max_amount IS NOT NULL AND v_amt > b.max_amount THEN RAISE EXCEPTION 'The approved amount exceeds the maximum for this concession type' USING ERRCODE = '45000'; END IF;
                v_pct := NULL;
            END IF;
            UPDATE student_fee_concession SET approval_status = 'APPROVED', approved_percentage = v_pct, approved_amount = v_amt, approved_by = sims_private.current_user_id(), approved_at = now(),
                   remarks = COALESCE(left(p_remarks, 500), remarks) WHERE student_concession_id = p_id;
        ELSIF p_kind = 'SCHOLARSHIP' THEN
            PERFORM sims_private.fin_check_amount(v_amt, 'amount');
            IF b.max_amount IS NOT NULL AND v_amt > b.max_amount THEN RAISE EXCEPTION 'The sanctioned amount exceeds the maximum for this scheme' USING ERRCODE = '45000'; END IF;
            UPDATE student_scholarship SET application_status = 'SANCTIONED', sanctioned_amount = v_amt, sanction_date = current_date, remarks = COALESCE(left(p_remarks, 500), remarks) WHERE student_scholarship_id = p_id;
        ELSE
            UPDATE student_sponsorship SET approval_status = 'APPROVED', approved_by = sims_private.current_user_id(), approved_at = now() WHERE student_sponsorship_id = p_id;
        END IF;
    ELSE
        IF p_kind = 'CONCESSION' THEN UPDATE student_fee_concession SET approval_status = 'REJECTED', remarks = left(p_remarks, 500) WHERE student_concession_id = p_id;
        ELSIF p_kind = 'SCHOLARSHIP' THEN UPDATE student_scholarship SET application_status = 'REJECTED', remarks = left(p_remarks, 500) WHERE student_scholarship_id = p_id;
        ELSE UPDATE student_sponsorship SET approval_status = 'REJECTED' WHERE student_sponsorship_id = p_id; END IF;
    END IF;
    PERFORM sims_private.fin_audit(CASE WHEN p_approve THEN 'BENEFIT_APPROVED' ELSE 'BENEFIT_REJECTED' END,
        CASE p_kind WHEN 'CONCESSION' THEN 'student_fee_concession' WHEN 'SCHOLARSHIP' THEN 'student_scholarship' ELSE 'student_sponsorship' END, p_id, NULL,
        jsonb_build_object('amount', v_amt, 'percentage', v_pct, 'remarks', p_remarks));
END $$;

CREATE FUNCTION public.fin_benefit_apply(p_kind text, p_benefit_id bigint, p_assessment_item_id bigint, p_amount numeric DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; it record; v_applied numeric; v_remaining numeric; v_amt numeric; v_id bigint;
BEGIN
    SELECT * INTO b FROM sims_private.fin_benefit_load(p_kind, p_benefit_id);
    IF b.student_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_BENEFIT.UPDATE) or unknown benefit' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize_student(b.student_id, 'FEE_BENEFIT', 'UPDATE');
    SELECT * INTO it FROM sims_private.fin_editable_item(p_assessment_item_id);
    IF it.student_id IS DISTINCT FROM b.student_id THEN RAISE EXCEPTION 'The benefit and the fee item belong to different students' USING ERRCODE = '45000'; END IF;
    IF b.status <> b.usable_status THEN RAISE EXCEPTION 'The benefit is not approved (status %)', b.status USING ERRCODE = '45000'; END IF;
    IF (b.valid_from IS NOT NULL AND current_date < b.valid_from) OR (b.valid_to IS NOT NULL AND current_date > b.valid_to) THEN RAISE EXCEPTION 'The benefit is not valid today' USING ERRCODE = '45000'; END IF;
    IF b.basis = 'PERCENTAGE' THEN
        SELECT COALESCE(sum(benefit_amount), 0) INTO v_applied FROM fee_assessment_benefit WHERE student_concession_id = p_benefit_id AND assessment_item_id = p_assessment_item_id;
        v_remaining := round(it.original_amount * b.pct / 100, 2) - v_applied;
    ELSE
        SELECT COALESCE(sum(benefit_amount), 0) INTO v_applied FROM fee_assessment_benefit
         WHERE (p_kind = 'CONCESSION' AND student_concession_id = p_benefit_id) OR (p_kind = 'SCHOLARSHIP' AND student_scholarship_id = p_benefit_id) OR (p_kind = 'SPONSORSHIP' AND student_sponsorship_id = p_benefit_id);
        v_remaining := b.amount - v_applied;
    END IF;
    v_amt := COALESCE(p_amount, v_remaining);
    PERFORM sims_private.fin_check_amount(v_amt, 'amount');
    IF v_amt > v_remaining THEN RAISE EXCEPTION 'The amount exceeds what is left of the benefit (%)', greatest(v_remaining, 0) USING ERRCODE = '45000'; END IF;
    IF v_amt > it.balance_amount THEN RAISE EXCEPTION 'The amount exceeds the unpaid balance of the item (%)', it.balance_amount USING ERRCODE = '45000'; END IF;
    INSERT INTO fee_assessment_benefit (assessment_item_id, benefit_type, student_concession_id, student_scholarship_id, student_sponsorship_id, benefit_amount, applied_date, approved_by)
    VALUES (p_assessment_item_id, p_kind, CASE WHEN p_kind = 'CONCESSION' THEN p_benefit_id END, CASE WHEN p_kind = 'SCHOLARSHIP' THEN p_benefit_id END,
            CASE WHEN p_kind = 'SPONSORSHIP' THEN p_benefit_id END, v_amt, current_date, sims_private.current_user_id())
    RETURNING assessment_benefit_id INTO v_id;
    UPDATE student_fee_assessment_item
       SET concession_amount = concession_amount + CASE WHEN p_kind = 'CONCESSION' THEN v_amt ELSE 0 END,
           scholarship_amount = scholarship_amount + CASE WHEN p_kind = 'CONCESSION' THEN 0 ELSE v_amt END,
           net_amount = net_amount - v_amt, balance_amount = balance_amount - v_amt
     WHERE assessment_item_id = p_assessment_item_id;
    PERFORM sims_private.fin_refresh_status(p_assessment_item_id);
    PERFORM sims_private.fin_audit('BENEFIT_APPLIED', 'fee_assessment_benefit', v_id, NULL, jsonb_build_object('kind', p_kind, 'benefit_id', p_benefit_id, 'item_id', p_assessment_item_id, 'amount', v_amt));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Adjustments
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_adjustment_create(p_number text, p_student_account_id bigint, p_assessment_item_id bigint, p_type text, p_amount numeric, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_ex record; v_acc bigint;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_REFUND', 'CREATE');
    IF p_number IS NULL OR btrim(p_number) = '' OR p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 500 THEN RAISE EXCEPTION 'A number and a reason (at most 500 characters) are required' USING ERRCODE = '22023'; END IF;
    IF p_type NOT IN ('CREDIT', 'DEBIT', 'WAIVER', 'WRITE_OFF') THEN RAISE EXCEPTION 'Adjustment type % is not supported', p_type USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    SELECT a.student_account_id INTO v_acc FROM student_fee_assessment_item i JOIN student_fee_assessment a ON a.fee_assessment_id = i.fee_assessment_id WHERE i.assessment_item_id = p_assessment_item_id;
    IF v_acc IS DISTINCT FROM p_student_account_id THEN RAISE EXCEPTION 'The fee item does not belong to this account' USING ERRCODE = '45000'; END IF;
    SELECT fee_adjustment_id, student_account_id, assessment_item_id, adjustment_type, adjustment_amount INTO v_ex FROM fee_adjustment WHERE adjustment_number = p_number;
    IF FOUND THEN
        IF v_ex.student_account_id = p_student_account_id AND v_ex.assessment_item_id = p_assessment_item_id AND v_ex.adjustment_type = p_type AND v_ex.adjustment_amount = p_amount THEN RETURN v_ex.fee_adjustment_id; END IF;
        RAISE EXCEPTION 'adjustment number already used with different details' USING ERRCODE = '23505';
    END IF;
    INSERT INTO fee_adjustment (adjustment_number, student_account_id, assessment_item_id, adjustment_type, adjustment_date, adjustment_amount, reason, approval_status)
    VALUES (p_number, p_student_account_id, p_assessment_item_id, p_type, current_date, p_amount, p_reason, 'SUBMITTED') RETURNING fee_adjustment_id INTO v_id;
    PERFORM sims_private.fin_audit('ADJUSTMENT_REQUESTED', 'fee_adjustment', v_id, NULL, jsonb_build_object('type', p_type, 'amount', p_amount, 'item_id', p_assessment_item_id));
    RETURN v_id;
END $$;

CREATE FUNCTION public.fin_adjustment_decide(p_adjustment_id bigint, p_approve boolean, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; it record; v_sign integer;
BEGIN
    SELECT * INTO a FROM fee_adjustment WHERE fee_adjustment_id = p_adjustment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_REFUND.APPROVE) or unknown adjustment' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(a.student_account_id, 'FEE_REFUND', 'APPROVE');
    IF a.approval_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted adjustment can be decided (status %)', a.approval_status USING ERRCODE = '45000'; END IF;
    IF sims_private.fin_creator_is_caller('fee_adjustment', p_adjustment_id) THEN RAISE EXCEPTION 'You cannot decide an adjustment that you requested yourself' USING ERRCODE = '45000'; END IF;
    IF NOT p_approve THEN
        IF p_remarks IS NULL OR btrim(p_remarks) = '' THEN RAISE EXCEPTION 'A reason is required to reject' USING ERRCODE = '22023'; END IF;
        UPDATE fee_adjustment SET approval_status = 'REJECTED' WHERE fee_adjustment_id = p_adjustment_id;
        PERFORM sims_private.fin_audit('ADJUSTMENT_REJECTED', 'fee_adjustment', p_adjustment_id, NULL, jsonb_build_object('remarks', p_remarks));
        RETURN;
    END IF;
    SELECT * INTO it FROM sims_private.fin_editable_item(a.assessment_item_id);
    v_sign := CASE WHEN a.adjustment_type = 'DEBIT' THEN 1 ELSE -1 END;
    IF v_sign < 0 AND a.adjustment_amount > it.balance_amount THEN RAISE EXCEPTION 'The reduction exceeds the unpaid balance of the item (%)', it.balance_amount USING ERRCODE = '45000'; END IF;
    UPDATE student_fee_assessment_item
       SET adjustment_amount = adjustment_amount + v_sign * a.adjustment_amount, net_amount = net_amount + v_sign * a.adjustment_amount, balance_amount = balance_amount + v_sign * a.adjustment_amount
     WHERE assessment_item_id = a.assessment_item_id;
    PERFORM sims_private.fin_refresh_status(a.assessment_item_id);
    UPDATE fee_adjustment SET approval_status = 'APPROVED', approved_by = sims_private.current_user_id(), approved_at = now() WHERE fee_adjustment_id = p_adjustment_id;
    PERFORM sims_private.fin_audit('ADJUSTMENT_APPROVED', 'fee_adjustment', p_adjustment_id, NULL, jsonb_build_object('type', a.adjustment_type, 'amount', a.adjustment_amount, 'remarks', p_remarks));
END $$;

-- ---------------------------------------------------------------
-- Instalments
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.fin_assessment_student(p_assessment_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT f.student_id FROM student_fee_assessment a JOIN student_financial_account f ON f.student_account_id = a.student_account_id WHERE a.fee_assessment_id = p_assessment_id
$$;

CREATE FUNCTION public.fin_instalment_apply(p_assessment_id bigint, p_plan_id integer, p_first_due date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; p record; v_first numeric; v_rest numeric; v_amt numeric; k integer;
BEGIN
    SELECT fee_assessment_id, student_account_id, assessment_status, net_payable_amount, balance_amount INTO a FROM student_fee_assessment WHERE fee_assessment_id = p_assessment_id FOR UPDATE;
    IF a.fee_assessment_id IS NULL OR a.student_account_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.UPDATE) or unknown assessment' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(a.student_account_id, 'FEE_ASSESSMENT', 'UPDATE');
    IF a.assessment_status NOT IN ('ASSESSED', 'PARTIALLY_PAID', 'OVERDUE') OR a.balance_amount <= 0 THEN RAISE EXCEPTION 'Instalments need an open assessment with a balance' USING ERRCODE = '45000'; END IF;
    IF p_first_due IS NULL OR p_first_due < current_date THEN RAISE EXCEPTION 'The first due date must be today or later' USING ERRCODE = '22023'; END IF;
    SELECT * INTO p FROM installment_plan WHERE installment_plan_id = p_plan_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive instalment plan' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM student_installment_schedule WHERE fee_assessment_id = p_assessment_id AND installment_status <> 'CANCELLED') THEN RAISE EXCEPTION 'The assessment already has an instalment schedule' USING ERRCODE = '45000'; END IF;
    DELETE FROM student_installment_schedule WHERE fee_assessment_id = p_assessment_id; -- only cancelled rows remain
    IF p.number_of_installments < 1 THEN RAISE EXCEPTION 'The plan has no instalments' USING ERRCODE = '45000'; END IF;
    IF p.number_of_installments = 1 THEN
        v_first := a.net_payable_amount; v_rest := 0;
    ELSE
        v_first := greatest(round(a.net_payable_amount / p.number_of_installments, 2), round(a.net_payable_amount * COALESCE(p.minimum_initial_percentage, 0) / 100, 2));
        v_rest := round((a.net_payable_amount - v_first) / (p.number_of_installments - 1), 2);
    END IF;
    FOR k IN 1..p.number_of_installments LOOP
        v_amt := CASE WHEN k = 1 THEN v_first WHEN k < p.number_of_installments THEN v_rest ELSE a.net_payable_amount - v_first - v_rest * (p.number_of_installments - 2) END;
        IF p.number_of_installments = 1 THEN v_amt := a.net_payable_amount; END IF;
        INSERT INTO student_installment_schedule (fee_assessment_id, installment_plan_id, installment_number, due_date, installment_amount, amount_paid, balance_amount, installment_status)
        VALUES (p_assessment_id, p_plan_id, k, (p_first_due + make_interval(months => k - 1))::date, v_amt, 0, v_amt, 'PENDING');
    END LOOP;
    PERFORM public.fin_instalment_refresh(p_assessment_id);
    PERFORM sims_private.fin_audit('INSTALMENTS_CREATED', 'student_fee_assessment', p_assessment_id, NULL, jsonb_build_object('plan_id', p_plan_id, 'count', p.number_of_installments, 'first_due', p_first_due));
    RETURN p.number_of_installments;
END $$;

-- matches the payments made so far to the instalments, oldest first, and marks overdue ones
CREATE FUNCTION public.fin_instalment_refresh(p_assessment_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_stu bigint; v_paid numeric; s record; v_part numeric;
BEGIN
    v_stu := sims_private.fin_assessment_student(p_assessment_id);
    PERFORM sims_private.fin_authorize_student(v_stu, 'FEE_ASSESSMENT', 'UPDATE');
    SELECT amount_paid INTO v_paid FROM student_fee_assessment WHERE fee_assessment_id = p_assessment_id;
    FOR s IN SELECT student_installment_id, installment_amount, due_date, installment_status FROM student_installment_schedule
              WHERE fee_assessment_id = p_assessment_id AND installment_status NOT IN ('CANCELLED', 'WAIVED') ORDER BY installment_number FOR UPDATE LOOP
        v_part := least(v_paid, s.installment_amount); v_paid := v_paid - v_part;
        UPDATE student_installment_schedule SET amount_paid = v_part, balance_amount = installment_amount - v_part,
               installment_status = CASE WHEN v_part >= installment_amount THEN 'PAID' WHEN due_date < current_date THEN 'OVERDUE' WHEN v_part > 0 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END
         WHERE student_installment_id = s.student_installment_id;
    END LOOP;
END $$;

CREATE FUNCTION public.fin_instalment_cancel(p_assessment_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM sims_private.fin_authorize_student(sims_private.fin_assessment_student(p_assessment_id), 'FEE_ASSESSMENT', 'UPDATE');
    UPDATE student_installment_schedule SET installment_status = 'CANCELLED' WHERE fee_assessment_id = p_assessment_id AND installment_status <> 'CANCELLED';
    IF NOT FOUND THEN RAISE EXCEPTION 'The assessment has no active instalment schedule' USING ERRCODE = '45000'; END IF;
    PERFORM sims_private.fin_audit('INSTALMENTS_CANCELLED', 'student_fee_assessment', p_assessment_id, NULL, NULL);
END $$;

-- ---------------------------------------------------------------
-- Late fees and penalties
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_late_fee_suggest(p_assessment_id bigint, p_rule_id bigint, p_as_of date DEFAULT current_date) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; r record; v_days integer; v_amt numeric := 0;
BEGIN
    PERFORM sims_private.fin_authorize_student(sims_private.fin_assessment_student(p_assessment_id), 'FEE_ASSESSMENT', 'READ');
    SELECT due_date, balance_amount, assessment_status INTO a FROM student_fee_assessment WHERE fee_assessment_id = p_assessment_id;
    SELECT * INTO r FROM late_fee_rule WHERE late_fee_rule_id = p_rule_id AND is_active AND effective_from <= p_as_of AND (effective_to IS NULL OR effective_to >= p_as_of);
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown, inactive or not yet effective late-fee rule' USING ERRCODE = '22023'; END IF;
    IF a.due_date IS NULL OR a.balance_amount <= 0 OR a.assessment_status IN ('CANCELLED', 'WAIVED', 'PAID', 'DRAFT') THEN RETURN 0; END IF;
    v_days := (p_as_of - a.due_date) - r.grace_period_days;
    IF v_days <= 0 THEN RETURN 0; END IF;
    v_amt := CASE r.calculation_method
        WHEN 'FIXED' THEN COALESCE(r.fixed_amount, 0)
        WHEN 'PER_DAY' THEN COALESCE(r.daily_amount, 0) * v_days
        WHEN 'PERCENTAGE' THEN round(a.balance_amount * COALESCE(r.percentage_rate, 0) / 100, 2)
        ELSE COALESCE((SELECT late_fee_amount FROM late_fee_slab WHERE late_fee_rule_id = p_rule_id AND from_day <= v_days AND (to_day IS NULL OR to_day >= v_days) ORDER BY from_day DESC LIMIT 1), 0) END;
    IF r.maximum_amount IS NOT NULL THEN v_amt := least(v_amt, r.maximum_amount); END IF;
    RETURN round(v_amt, 2);
END $$;

CREATE FUNCTION public.fin_penalty_assess(p_student_account_id bigint, p_fee_type_id bigint, p_amount numeric, p_reason text, p_academic_year_id integer, p_due_date date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_fa bigint; v_item bigint; v_id bigint; v_num text;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_ASSESSMENT', 'CREATE');
    IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 500 THEN RAISE EXCEPTION 'A reason (at most 500 characters) is required' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    v_num := 'PEN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.fee_penalty_seq')::text, 6, '0');
    v_fa := public.fin_create_fee_assessment(v_num, p_student_account_id, p_academic_year_id, 'PENALTY', current_date, p_due_date,
              jsonb_build_array(jsonb_build_object('fee_type_id', p_fee_type_id, 'description', left(p_reason, 250), 'original_amount', p_amount)));
    SELECT assessment_item_id INTO v_item FROM student_fee_assessment_item WHERE fee_assessment_id = v_fa;
    INSERT INTO student_fee_penalty (student_account_id, assessment_item_id, fee_type_id, penalty_date, penalty_reason, penalty_amount, waived_amount, net_penalty_amount, penalty_status)
    VALUES (p_student_account_id, v_item, p_fee_type_id, current_date, p_reason, p_amount, 0, p_amount, 'ASSESSED') RETURNING fee_penalty_id INTO v_id;
    PERFORM sims_private.fin_audit('PENALTY_ASSESSED', 'student_fee_penalty', v_id, NULL, jsonb_build_object('amount', p_amount, 'assessment_id', v_fa));
    RETURN v_id;
END $$;

CREATE FUNCTION public.fin_penalty_waive(p_penalty_id bigint, p_amount numeric, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p record; it record;
BEGIN
    SELECT * INTO p FROM student_fee_penalty WHERE fee_penalty_id = p_penalty_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_REFUND.APPROVE) or unknown penalty' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(p.student_account_id, 'FEE_REFUND', 'APPROVE');
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    IF p.penalty_status NOT IN ('ASSESSED', 'PARTIALLY_PAID') THEN RAISE EXCEPTION 'The penalty is %', p.penalty_status USING ERRCODE = '45000'; END IF;
    IF p_amount > p.penalty_amount - p.waived_amount THEN RAISE EXCEPTION 'The amount exceeds what is left of the penalty' USING ERRCODE = '45000'; END IF;
    SELECT * INTO it FROM sims_private.fin_editable_item(p.assessment_item_id);
    IF p_amount > it.balance_amount THEN RAISE EXCEPTION 'The amount exceeds the unpaid balance (%)', it.balance_amount USING ERRCODE = '45000'; END IF;
    UPDATE student_fee_assessment_item SET adjustment_amount = adjustment_amount - p_amount, net_amount = net_amount - p_amount, balance_amount = balance_amount - p_amount WHERE assessment_item_id = p.assessment_item_id;
    PERFORM sims_private.fin_refresh_status(p.assessment_item_id);
    UPDATE student_fee_penalty SET waived_amount = waived_amount + p_amount, net_penalty_amount = net_penalty_amount - p_amount,
           penalty_status = CASE WHEN net_penalty_amount - p_amount = 0 THEN 'WAIVED' ELSE penalty_status END, approved_by = sims_private.current_user_id() WHERE fee_penalty_id = p_penalty_id;
    PERFORM sims_private.fin_audit('PENALTY_WAIVED', 'student_fee_penalty', p_penalty_id, NULL, jsonb_build_object('amount', p_amount, 'reason', p_reason));
END $$;

-- ---------------------------------------------------------------
-- One read for the account page. Everything is role-aware: a student sees instalments and penalties, staff see what their grants allow.
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_account_extras(p_student_account_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_stu bigint; v_ben boolean; v_adj boolean; r jsonb;
BEGIN
    -- read checks (p_write = false) so that a student's own record is covered by the SELF scope
    SELECT student_id INTO v_stu FROM student_financial_account WHERE student_account_id = p_student_account_id;
    IF v_stu IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.READ']::text[], v_stu, false) THEN
        RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.READ) or unknown account' USING ERRCODE = '42501';
    END IF;
    v_ben := sims_private.can_student(ARRAY['FEES.FEE_BENEFIT.READ']::text[], v_stu, false);
    v_adj := sims_private.can_student(ARRAY['FEES.FEE_REFUND.READ']::text[], v_stu, false);
    r := jsonb_build_object(
      'benefits', CASE WHEN NOT v_ben THEN '[]'::jsonb ELSE (
        SELECT COALESCE(jsonb_agg(x ORDER BY x->>'requested' DESC), '[]'::jsonb) FROM (
          SELECT jsonb_build_object('kind', 'CONCESSION', 'id', c.student_concession_id, 'name', t.concession_name, 'status', c.approval_status, 'percentage', c.approved_percentage, 'amount', c.approved_amount,
                 'applied', COALESCE((SELECT sum(benefit_amount) FROM fee_assessment_benefit WHERE student_concession_id = c.student_concession_id), 0), 'requested', c.application_date, 'remarks', c.remarks) AS x
            FROM student_fee_concession c JOIN concession_type t ON t.concession_type_id = c.concession_type_id WHERE c.student_id = v_stu
          UNION ALL
          SELECT jsonb_build_object('kind', 'SCHOLARSHIP', 'id', s.student_scholarship_id, 'name', m.scheme_name, 'status', s.application_status, 'percentage', NULL, 'amount', COALESCE(s.sanctioned_amount, s.applied_amount),
                 'applied', COALESCE((SELECT sum(benefit_amount) FROM fee_assessment_benefit WHERE student_scholarship_id = s.student_scholarship_id), 0), 'requested', s.sanction_date, 'remarks', s.remarks)
            FROM student_scholarship s JOIN scholarship_scheme m ON m.scholarship_scheme_id = s.scholarship_scheme_id WHERE s.student_id = v_stu
          UNION ALL
          SELECT jsonb_build_object('kind', 'SPONSORSHIP', 'id', p.student_sponsorship_id, 'name', p.sponsoring_authority, 'status', p.approval_status, 'percentage', NULL, 'amount', p.sanctioned_amount,
                 'applied', COALESCE((SELECT sum(benefit_amount) FROM fee_assessment_benefit WHERE student_sponsorship_id = p.student_sponsorship_id), 0), 'requested', p.approved_at, 'remarks', p.sanction_reference)
            FROM student_sponsorship p WHERE p.student_id = v_stu) q) END,
      'adjustments', CASE WHEN NOT v_adj THEN '[]'::jsonb ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.fee_adjustment_id, 'number', a.adjustment_number, 'type', a.adjustment_type, 'amount', a.adjustment_amount, 'status', a.approval_status,
               'reason', a.reason, 'item_id', a.assessment_item_id, 'date', a.adjustment_date) ORDER BY a.fee_adjustment_id DESC), '[]'::jsonb) FROM fee_adjustment a WHERE a.student_account_id = p_student_account_id) END,
      'instalments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.student_installment_id, 'assessment_id', s.fee_assessment_id, 'number', s.installment_number, 'due', s.due_date, 'amount', s.installment_amount,
               'paid', s.amount_paid, 'status', s.installment_status) ORDER BY s.fee_assessment_id, s.installment_number), '[]'::jsonb)
               FROM student_installment_schedule s JOIN student_fee_assessment a ON a.fee_assessment_id = s.fee_assessment_id WHERE a.student_account_id = p_student_account_id AND s.installment_status <> 'CANCELLED'),
      'penalties', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.fee_penalty_id, 'date', p.penalty_date, 'reason', p.penalty_reason, 'amount', p.penalty_amount, 'waived', p.waived_amount,
               'net', p.net_penalty_amount, 'status', p.penalty_status) ORDER BY p.fee_penalty_id DESC), '[]'::jsonb) FROM student_fee_penalty p WHERE p.student_account_id = p_student_account_id),
      'can', jsonb_build_object(
        'benefit_create', sims_private.can_student(ARRAY['FEES.FEE_BENEFIT.CREATE']::text[], v_stu, true),
        'benefit_approve', sims_private.can_student(ARRAY['FEES.FEE_BENEFIT.APPROVE']::text[], v_stu, true),
        'benefit_apply', sims_private.can_student(ARRAY['FEES.FEE_BENEFIT.UPDATE']::text[], v_stu, true),
        'adjust_create', sims_private.can_student(ARRAY['FEES.FEE_REFUND.CREATE']::text[], v_stu, true),
        'adjust_approve', sims_private.can_student(ARRAY['FEES.FEE_REFUND.APPROVE']::text[], v_stu, true),
        'assess_create', sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.CREATE']::text[], v_stu, true),
        'assess_update', sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.UPDATE']::text[], v_stu, true)));
    RETURN r;
END $$;

REVOKE ALL ON FUNCTION sims_private.fin_authorize_student(bigint, text, text), sims_private.fin_refresh_status(bigint), sims_private.fin_editable_item(bigint), sims_private.fin_creator_is_caller(text, bigint),
    sims_private.fin_benefit_load(text, bigint), sims_private.fin_assessment_student(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_benefit_create(text, bigint, integer, bigint, numeric, numeric, text, text, text), public.fin_benefit_decide(text, bigint, boolean, numeric, numeric, text),
    public.fin_benefit_apply(text, bigint, bigint, numeric), public.fin_adjustment_create(text, bigint, bigint, text, numeric, text), public.fin_adjustment_decide(bigint, boolean, text),
    public.fin_instalment_apply(bigint, integer, date), public.fin_instalment_refresh(bigint), public.fin_instalment_cancel(bigint), public.fin_late_fee_suggest(bigint, bigint, date),
    public.fin_penalty_assess(bigint, bigint, numeric, text, integer, date), public.fin_penalty_waive(bigint, numeric, text), public.fin_account_extras(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_benefit_create(text, bigint, integer, bigint, numeric, numeric, text, text, text), public.fin_benefit_decide(text, bigint, boolean, numeric, numeric, text),
    public.fin_benefit_apply(text, bigint, bigint, numeric), public.fin_adjustment_create(text, bigint, bigint, text, numeric, text), public.fin_adjustment_decide(bigint, boolean, text),
    public.fin_instalment_apply(bigint, integer, date), public.fin_instalment_refresh(bigint), public.fin_instalment_cancel(bigint), public.fin_late_fee_suggest(bigint, bigint, date),
    public.fin_penalty_assess(bigint, bigint, numeric, text, integer, date), public.fin_penalty_waive(bigint, numeric, text), public.fin_account_extras(bigint) TO authenticated;
