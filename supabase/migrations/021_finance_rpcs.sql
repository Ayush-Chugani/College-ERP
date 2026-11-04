-- Transactional finance workflows. Hand-written (not from the MySQL source). See docs/API_DOCUMENTATION.md.
--
-- Why RPCs: clients have NO direct write access to fee/payment/refund tables (migration 018). All money movement goes through these
-- SECURITY DEFINER functions, which (1) authorise the caller against FEES.<resource>.<action> at the student's scope, (2) never trust
-- caller-supplied totals, (3) are idempotent on their business keys, (4) rely on the source triggers (migration 014) for amount limits,
-- and (5) take row locks in the same order as those triggers (payment -> item) to avoid deadlocks.
-- Scope of this migration: student-account context only. Admission-application (application_id) payments are NOT handled here.
-- Assumption (not stated in the source): item/assessment status PAID / PARTIALLY_PAID follow balance and amount_paid.
-- Not implemented: receipt numbering (fee_receipt) - the numbering rule is not defined in the source.

CREATE FUNCTION sims_private.fin_authorize(p_student_account_id bigint, p_resource text, p_action text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint;
BEGIN
    SELECT student_id INTO v_student FROM public.student_financial_account WHERE student_account_id = p_student_account_id;
    -- Same error for "unknown" and "out of scope": no account enumeration.
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['FEES.' || p_resource || '.' || p_action]::text[], v_student, true) THEN
        RAISE EXCEPTION 'Not authorised (FEES.%.%) or unknown account', p_resource, p_action USING ERRCODE = '42501';
    END IF;
    RETURN v_student;
END $$;

CREATE FUNCTION sims_private.fin_audit(p_action text, p_entity text, p_id bigint, p_old jsonb, p_new jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO public.fee_activity_audit (user_id, action_code, entity_name, entity_id, old_values, new_values)
    VALUES (sims_private.current_user_id(), p_action, p_entity, p_id, p_old, p_new)
$$;

CREATE FUNCTION sims_private.fin_check_amount(p_amount numeric, p_what text) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 10000000000 THEN
        RAISE EXCEPTION '% must be a positive amount with at most 2 decimals', p_what USING ERRCODE = '22023';
    END IF;
END $$;

-- ---------------------------------------------------------------
-- Fee assessment: totals are computed here from item components
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_create_fee_assessment(
    p_assessment_number text, p_student_account_id bigint, p_academic_year_id integer, p_assessment_type text,
    p_assessment_date date, p_due_date date, p_items jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id bigint; v_status text; v_ex record; it jsonb;
    v_orig numeric; v_con numeric; v_sch numeric; v_adj numeric; v_net numeric;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_ASSESSMENT', 'CREATE');
    IF p_assessment_number IS NULL OR btrim(p_assessment_number) = '' THEN
        RAISE EXCEPTION 'assessment_number is required (idempotency key)' USING ERRCODE = '22023';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'p_items must be a non-empty array' USING ERRCODE = '22023';
    END IF;
    SELECT account_status INTO v_status FROM student_financial_account WHERE student_account_id = p_student_account_id;
    IF v_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Student account is not ACTIVE (%)', v_status USING ERRCODE = '45000';
    END IF;

    SELECT fee_assessment_id, student_account_id, academic_year_id INTO v_ex FROM student_fee_assessment WHERE assessment_number = p_assessment_number;
    IF FOUND THEN
        IF v_ex.student_account_id IS NOT DISTINCT FROM p_student_account_id AND v_ex.academic_year_id = p_academic_year_id THEN
            RETURN v_ex.fee_assessment_id;  -- idempotent replay
        END IF;
        RAISE EXCEPTION 'assessment_number already used for a different assessment' USING ERRCODE = '23505';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_orig := (it ->> 'original_amount')::numeric;
        v_con := COALESCE((it ->> 'concession_amount')::numeric, 0);
        v_sch := COALESCE((it ->> 'scholarship_amount')::numeric, 0);
        v_adj := COALESCE((it ->> 'adjustment_amount')::numeric, 0);
        IF v_orig IS NULL OR v_orig < 0 OR v_con < 0 OR v_sch < 0
           OR v_orig <> round(v_orig, 2) OR v_con <> round(v_con, 2) OR v_sch <> round(v_sch, 2) OR v_adj <> round(v_adj, 2)
           OR (it ->> 'fee_type_id') IS NULL THEN
            RAISE EXCEPTION 'Invalid fee item: %', it USING ERRCODE = '22023';
        END IF;
        IF v_orig - v_con - v_sch + v_adj < 0 THEN
            RAISE EXCEPTION 'Fee item net amount cannot be negative: %', it USING ERRCODE = '22023';
        END IF;
    END LOOP;

    INSERT INTO student_fee_assessment (assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date, due_date, assessment_status, created_by)
    VALUES (p_assessment_number, p_student_account_id, p_academic_year_id, p_assessment_type, p_assessment_date, p_due_date, 'DRAFT', sims_private.current_user_id())
    ON CONFLICT (assessment_number) DO NOTHING
    RETURNING fee_assessment_id INTO v_id;
    IF v_id IS NULL THEN  -- lost a race with an identical concurrent call
        SELECT fee_assessment_id INTO v_id FROM student_fee_assessment
         WHERE assessment_number = p_assessment_number AND student_account_id = p_student_account_id AND academic_year_id = p_academic_year_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'assessment_number already used for a different assessment' USING ERRCODE = '23505';
        END IF;
        RETURN v_id;
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_orig := (it ->> 'original_amount')::numeric;
        v_con := COALESCE((it ->> 'concession_amount')::numeric, 0);
        v_sch := COALESCE((it ->> 'scholarship_amount')::numeric, 0);
        v_adj := COALESCE((it ->> 'adjustment_amount')::numeric, 0);
        v_net := v_orig - v_con - v_sch + v_adj;
        INSERT INTO student_fee_assessment_item (fee_assessment_id, fee_type_id, description, original_amount, concession_amount, scholarship_amount,
                                                 adjustment_amount, net_amount, amount_paid, balance_amount, due_date)
        VALUES (v_id, (it ->> 'fee_type_id')::bigint, it ->> 'description', v_orig, v_con, v_sch, v_adj, v_net, 0, v_net,
                COALESCE((it ->> 'due_date')::date, p_due_date));
    END LOOP;  -- item triggers keep the header totals in sync

    UPDATE student_fee_assessment SET assessment_status = 'ASSESSED' WHERE fee_assessment_id = v_id;
    PERFORM sims_private.fin_audit('ASSESSMENT_CREATED', 'student_fee_assessment', v_id, NULL,
        (SELECT to_jsonb(a) FROM student_fee_assessment a WHERE a.fee_assessment_id = v_id));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Payments (offline modes). Idempotent on transaction_number.
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_record_payment(
    p_transaction_number text, p_student_account_id bigint, p_payment_mode_id integer, p_amount numeric,
    p_bank_reference text DEFAULT NULL, p_payer_name text DEFAULT NULL, p_remarks text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_mode record; v_ex record; v_acct_status text;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_PAYMENT', 'CREATE');
    IF p_transaction_number IS NULL OR btrim(p_transaction_number) = '' THEN
        RAISE EXCEPTION 'transaction_number is required (idempotency key)' USING ERRCODE = '22023';
    END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    SELECT account_status INTO v_acct_status FROM student_financial_account WHERE student_account_id = p_student_account_id;
    IF v_acct_status = 'CLOSED' THEN RAISE EXCEPTION 'Student account is CLOSED' USING ERRCODE = '45000'; END IF;
    SELECT requires_reference, is_online, is_active INTO v_mode FROM payment_mode WHERE payment_mode_id = p_payment_mode_id;
    IF NOT FOUND OR NOT v_mode.is_active THEN RAISE EXCEPTION 'Unknown or inactive payment mode' USING ERRCODE = '22023'; END IF;
    IF v_mode.is_online THEN
        RAISE EXCEPTION 'Online payments are confirmed by the payment-gateway integration, not recorded manually' USING ERRCODE = '45000';
    END IF;
    IF v_mode.requires_reference AND (p_bank_reference IS NULL OR btrim(p_bank_reference) = '') THEN
        RAISE EXCEPTION 'This payment mode requires a reference number' USING ERRCODE = '22023';
    END IF;

    INSERT INTO payment_transaction (transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status,
                                     bank_reference_number, payer_name, received_by, remarks)
    VALUES (p_transaction_number, p_student_account_id, now(), p_payment_mode_id, p_amount, 'SUCCESS',
            p_bank_reference, p_payer_name, sims_private.current_user_id(), p_remarks)
    ON CONFLICT (transaction_number) DO NOTHING
    RETURNING payment_transaction_id INTO v_id;
    IF v_id IS NULL THEN
        SELECT payment_transaction_id, student_account_id, payment_mode_id, amount INTO v_ex FROM payment_transaction WHERE transaction_number = p_transaction_number;
        IF v_ex.student_account_id IS NOT DISTINCT FROM p_student_account_id AND v_ex.payment_mode_id = p_payment_mode_id AND v_ex.amount = p_amount THEN
            RETURN v_ex.payment_transaction_id;  -- idempotent replay
        END IF;
        RAISE EXCEPTION 'transaction_number already used with different details' USING ERRCODE = '23505';
    END IF;
    PERFORM sims_private.fin_audit('PAYMENT_RECORDED', 'payment_transaction', v_id, NULL,
        jsonb_build_object('transaction_number', p_transaction_number, 'amount', p_amount, 'payment_mode_id', p_payment_mode_id));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Allocation of a payment to a fee item. Limits are enforced by trg_payment_allocation_bi/bu (row-locked).
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_allocate_payment(p_payment_transaction_id bigint, p_assessment_item_id bigint, p_amount numeric) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_account bigint; v_item record; v_alloc record; v_id bigint; v_fa bigint;
BEGIN
    SELECT student_account_id INTO v_account FROM payment_transaction WHERE payment_transaction_id = p_payment_transaction_id;
    IF v_account IS NULL THEN
        RAISE EXCEPTION 'Not authorised (FEES.FEE_PAYMENT.CREATE) or unknown payment, or not a student-account payment' USING ERRCODE = '42501';
    END IF;
    PERFORM sims_private.fin_authorize(v_account, 'FEE_PAYMENT', 'CREATE');
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');

    PERFORM 1 FROM payment_transaction WHERE payment_transaction_id = p_payment_transaction_id FOR UPDATE;  -- lock order: payment, then item
    SELECT i.item_status, i.fee_assessment_id, a.student_account_id INTO v_item
      FROM student_fee_assessment_item i JOIN student_fee_assessment a ON a.fee_assessment_id = i.fee_assessment_id
     WHERE i.assessment_item_id = p_assessment_item_id FOR UPDATE OF i;
    IF NOT FOUND OR v_item.student_account_id IS DISTINCT FROM v_account THEN
        RAISE EXCEPTION 'Fee item does not belong to the payer account' USING ERRCODE = '45000';
    END IF;
    IF v_item.item_status IN ('CANCELLED', 'WAIVED') THEN
        RAISE EXCEPTION 'Fee item is %', v_item.item_status USING ERRCODE = '45000';
    END IF;

    SELECT payment_allocation_id, allocated_amount INTO v_alloc FROM payment_allocation
     WHERE payment_transaction_id = p_payment_transaction_id AND assessment_item_id = p_assessment_item_id;
    IF FOUND THEN
        IF v_alloc.allocated_amount = p_amount THEN RETURN v_alloc.payment_allocation_id; END IF;  -- idempotent replay
        RAISE EXCEPTION 'An allocation for this payment and item already exists with a different amount' USING ERRCODE = '23505';
    END IF;

    INSERT INTO payment_allocation (payment_transaction_id, assessment_item_id, allocated_amount, allocated_by)
    VALUES (p_payment_transaction_id, p_assessment_item_id, p_amount, sims_private.current_user_id())
    RETURNING payment_allocation_id INTO v_id;  -- guard + totals triggers run here

    UPDATE student_fee_assessment_item
       SET item_status = CASE WHEN balance_amount = 0 THEN 'PAID' WHEN amount_paid > 0 THEN 'PARTIALLY_PAID' ELSE item_status END
     WHERE assessment_item_id = p_assessment_item_id AND item_status IN ('ASSESSED', 'PARTIALLY_PAID', 'OVERDUE');
    v_fa := v_item.fee_assessment_id;
    UPDATE student_fee_assessment
       SET assessment_status = CASE WHEN balance_amount = 0 THEN 'PAID' WHEN amount_paid > 0 THEN 'PARTIALLY_PAID' ELSE assessment_status END
     WHERE fee_assessment_id = v_fa AND assessment_status IN ('ASSESSED', 'PARTIALLY_PAID', 'OVERDUE');
    PERFORM sims_private.fin_audit('PAYMENT_ALLOCATED', 'payment_allocation', v_id, NULL,
        jsonb_build_object('payment_transaction_id', p_payment_transaction_id, 'assessment_item_id', p_assessment_item_id, 'amount', p_amount));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Refunds: request -> decide (approve/reject) -> process
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.fin_refunded_on_payment(p_payment_id bigint) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(SUM(fr.refund_amount), 0) FROM public.fee_refund fr JOIN public.refund_request rr ON rr.refund_request_id = fr.refund_request_id
     WHERE rr.payment_transaction_id = p_payment_id AND fr.refund_status = 'SUCCESS'
$$;

CREATE FUNCTION public.fin_request_refund(
    p_request_number text, p_student_account_id bigint, p_payment_transaction_id bigint, p_amount numeric, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pay record; v_id bigint; v_ex record;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_REFUND', 'CREATE');
    IF p_request_number IS NULL OR btrim(p_request_number) = '' OR p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'request number and reason are required' USING ERRCODE = '22023';
    END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    SELECT payment_transaction_id, student_account_id, amount, payment_status INTO v_pay FROM payment_transaction
     WHERE payment_transaction_id = p_payment_transaction_id FOR UPDATE;
    IF NOT FOUND OR v_pay.student_account_id IS DISTINCT FROM p_student_account_id THEN
        RAISE EXCEPTION 'Payment does not belong to this account' USING ERRCODE = '45000';
    END IF;
    IF v_pay.payment_status NOT IN ('SUCCESS', 'PARTIALLY_REFUNDED') THEN
        RAISE EXCEPTION 'Only successful payments can be refunded (status %)', v_pay.payment_status USING ERRCODE = '45000';
    END IF;
    SELECT refund_request_id, student_account_id, payment_transaction_id, requested_amount INTO v_ex FROM refund_request WHERE refund_request_number = p_request_number;
    IF FOUND THEN
        IF v_ex.student_account_id = p_student_account_id AND v_ex.payment_transaction_id = p_payment_transaction_id AND v_ex.requested_amount = p_amount THEN
            RETURN v_ex.refund_request_id;  -- idempotent replay
        END IF;
        RAISE EXCEPTION 'request number already used with different details' USING ERRCODE = '23505';
    END IF;
    IF p_amount > v_pay.amount - sims_private.fin_refunded_on_payment(p_payment_transaction_id) THEN
        RAISE EXCEPTION 'Requested amount exceeds the refundable balance of the payment' USING ERRCODE = '45000';
    END IF;
    INSERT INTO refund_request (refund_request_number, student_account_id, payment_transaction_id, request_date, refund_reason, requested_amount, request_status)
    VALUES (p_request_number, p_student_account_id, p_payment_transaction_id, current_date, p_reason, p_amount, 'SUBMITTED')
    RETURNING refund_request_id INTO v_id;
    PERFORM sims_private.fin_audit('REFUND_REQUESTED', 'refund_request', v_id, NULL, jsonb_build_object('amount', p_amount, 'payment_transaction_id', p_payment_transaction_id));
    RETURN v_id;
END $$;

CREATE FUNCTION public.fin_decide_refund(p_refund_request_id bigint, p_approve boolean, p_approved_amount numeric DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req record; v_amt numeric; v_pay_amount numeric;
BEGIN
    SELECT student_account_id INTO v_req FROM refund_request WHERE refund_request_id = p_refund_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_REFUND.APPROVE) or unknown request' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(v_req.student_account_id, 'FEE_REFUND', 'APPROVE');
    SELECT student_account_id, payment_transaction_id, requested_amount, request_status, approved_amount INTO v_req
      FROM refund_request WHERE refund_request_id = p_refund_request_id FOR UPDATE;
    IF p_approve THEN
        IF v_req.request_status = 'APPROVED' THEN RETURN; END IF;  -- idempotent replay
        IF v_req.request_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
            RAISE EXCEPTION 'Request is % and cannot be approved', v_req.request_status USING ERRCODE = '45000';
        END IF;
        v_amt := COALESCE(p_approved_amount, v_req.requested_amount);
        PERFORM sims_private.fin_check_amount(v_amt, 'approved amount');
        IF v_amt > v_req.requested_amount THEN
            RAISE EXCEPTION 'Approved amount cannot exceed the requested amount' USING ERRCODE = '45000';
        END IF;
        IF v_req.payment_transaction_id IS NOT NULL THEN
            SELECT amount INTO v_pay_amount FROM payment_transaction WHERE payment_transaction_id = v_req.payment_transaction_id FOR UPDATE;
            IF v_amt > v_pay_amount - sims_private.fin_refunded_on_payment(v_req.payment_transaction_id) THEN
                RAISE EXCEPTION 'Approved amount exceeds the refundable balance of the payment' USING ERRCODE = '45000';
            END IF;
        END IF;
        UPDATE refund_request SET request_status = 'APPROVED', approved_amount = v_amt, approved_by = sims_private.current_user_id(), approved_at = now()
         WHERE refund_request_id = p_refund_request_id;
        PERFORM sims_private.fin_audit('REFUND_APPROVED', 'refund_request', p_refund_request_id, NULL, jsonb_build_object('approved_amount', v_amt));
    ELSE
        IF v_req.request_status = 'REJECTED' THEN RETURN; END IF;
        IF v_req.request_status NOT IN ('SUBMITTED', 'UNDER_REVIEW') THEN
            RAISE EXCEPTION 'Request is % and cannot be rejected', v_req.request_status USING ERRCODE = '45000';
        END IF;
        UPDATE refund_request SET request_status = 'REJECTED', approved_by = sims_private.current_user_id(), approved_at = now()
         WHERE refund_request_id = p_refund_request_id;
        PERFORM sims_private.fin_audit('REFUND_REJECTED', 'refund_request', p_refund_request_id, NULL, NULL);
    END IF;
END $$;

CREATE FUNCTION public.fin_process_refund(
    p_refund_transaction_number text, p_refund_request_id bigint, p_refund_mode_id integer, p_amount numeric, p_bank_reference text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req record; v_mode record; v_ex record; v_id bigint; v_refunded numeric; v_pay_amount numeric; v_pay_total numeric;
BEGIN
    SELECT student_account_id INTO v_req FROM refund_request WHERE refund_request_id = p_refund_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_REFUND.UPDATE) or unknown request' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(v_req.student_account_id, 'FEE_REFUND', 'UPDATE');
    IF p_refund_transaction_number IS NULL OR btrim(p_refund_transaction_number) = '' THEN
        RAISE EXCEPTION 'refund transaction number is required (idempotency key)' USING ERRCODE = '22023';
    END IF;
    PERFORM sims_private.fin_check_amount(p_amount, 'amount');
    SELECT payment_transaction_id, approved_amount, request_status INTO v_req FROM refund_request WHERE refund_request_id = p_refund_request_id FOR UPDATE;
    IF v_req.payment_transaction_id IS NOT NULL THEN
        PERFORM 1 FROM payment_transaction WHERE payment_transaction_id = v_req.payment_transaction_id FOR UPDATE;
    END IF;

    SELECT fee_refund_id, refund_request_id, refund_amount INTO v_ex FROM fee_refund WHERE refund_transaction_number = p_refund_transaction_number;
    IF FOUND THEN
        IF v_ex.refund_request_id = p_refund_request_id AND v_ex.refund_amount = p_amount THEN RETURN v_ex.fee_refund_id; END IF;  -- idempotent replay
        RAISE EXCEPTION 'refund transaction number already used with different details' USING ERRCODE = '23505';
    END IF;
    IF v_req.request_status NOT IN ('APPROVED', 'PROCESSED') OR v_req.approved_amount IS NULL THEN
        RAISE EXCEPTION 'Refund request must be approved first' USING ERRCODE = '45000';
    END IF;
    SELECT requires_reference, is_active INTO v_mode FROM payment_mode WHERE payment_mode_id = p_refund_mode_id;
    IF NOT FOUND OR NOT v_mode.is_active THEN RAISE EXCEPTION 'Unknown or inactive refund mode' USING ERRCODE = '22023'; END IF;
    IF v_mode.requires_reference AND (p_bank_reference IS NULL OR btrim(p_bank_reference) = '') THEN
        RAISE EXCEPTION 'This refund mode requires a reference number' USING ERRCODE = '22023';
    END IF;

    INSERT INTO fee_refund (refund_request_id, refund_transaction_number, refund_date, refund_amount, refund_mode_id, bank_reference_number, processed_by, refund_status)
    VALUES (p_refund_request_id, p_refund_transaction_number, now(), p_amount, p_refund_mode_id, p_bank_reference, sims_private.current_user_id(), 'SUCCESS')
    RETURNING fee_refund_id INTO v_id;  -- approval and cumulative limits enforced by trg_fee_refund_bi

    SELECT COALESCE(SUM(refund_amount), 0) INTO v_refunded FROM fee_refund WHERE refund_request_id = p_refund_request_id AND refund_status = 'SUCCESS';
    IF v_refunded = v_req.approved_amount THEN
        UPDATE refund_request SET request_status = 'PROCESSED' WHERE refund_request_id = p_refund_request_id;
    END IF;
    IF v_req.payment_transaction_id IS NOT NULL THEN
        SELECT amount INTO v_pay_amount FROM payment_transaction WHERE payment_transaction_id = v_req.payment_transaction_id;
        v_pay_total := sims_private.fin_refunded_on_payment(v_req.payment_transaction_id);
        UPDATE payment_transaction SET payment_status = CASE WHEN v_pay_total >= v_pay_amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END
         WHERE payment_transaction_id = v_req.payment_transaction_id AND payment_status IN ('SUCCESS', 'PARTIALLY_REFUNDED');
    END IF;
    PERFORM sims_private.fin_audit('REFUND_PROCESSED', 'fee_refund', v_id, NULL, jsonb_build_object('amount', p_amount, 'refund_request_id', p_refund_request_id));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION sims_private.fin_authorize(bigint, text, text), sims_private.fin_audit(text, text, bigint, jsonb, jsonb),
    sims_private.fin_check_amount(numeric, text), sims_private.fin_refunded_on_payment(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_create_fee_assessment(text, bigint, integer, text, date, date, jsonb),
    public.fin_record_payment(text, bigint, integer, numeric, text, text, text),
    public.fin_allocate_payment(bigint, bigint, numeric),
    public.fin_request_refund(text, bigint, bigint, numeric, text),
    public.fin_decide_refund(bigint, boolean, numeric),
    public.fin_process_refund(text, bigint, integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_create_fee_assessment(text, bigint, integer, text, date, date, jsonb),
    public.fin_record_payment(text, bigint, integer, numeric, text, text, text),
    public.fin_allocate_payment(bigint, bigint, numeric),
    public.fin_request_refund(text, bigint, bigint, numeric, text),
    public.fin_decide_refund(bigint, boolean, numeric),
    public.fin_process_refund(text, bigint, integer, numeric, text) TO authenticated;
