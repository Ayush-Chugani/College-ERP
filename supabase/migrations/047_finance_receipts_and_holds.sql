-- Fee receipts and financial holds. Hand-written (not from the MySQL source). Same conventions as migration 021: clients have no write access to money tables, every RPC authorises FEES.<resource>.<action> at
-- the student's scope (sims_private.fin_authorize), nothing trusts caller-supplied amounts, and every action writes fee_activity_audit.
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-59):
--  1  Receipt numbers are RCP-<year>-<6-digit sequence> (the source leaves the rule open; decision D-9 can change the format in one place, sims_private.fin_next_receipt_number).
--  2  A receipt can be issued for a SUCCESS or PARTIALLY_REFUNDED student payment; the receipt amount is the payment amount. Issuing twice returns the existing ISSUED receipt.
--  3  A receipt is never edited. It can be CANCELLED (reason required) or REPLACED by a new receipt for the same payment (reason required; the old one becomes REPLACED and the new one points at it).
--  4  Receipts are issued and cancelled with FEE_PAYMENT.CREATE / UPDATE. Reading a receipt needs FEE_PAYMENT.READ.
--  5  An ACTIVE hold puts the account ON_HOLD; releasing the last active hold returns it to ACTIVE (a CLOSED account stays CLOSED). Holds are recorded and shown; other modules do not yet enforce them
--     (registration, examination, certificates), which is a separate business decision.

CREATE SEQUENCE sims_private.fee_receipt_seq;

CREATE FUNCTION sims_private.fin_next_receipt_number() RETURNS text
LANGUAGE sql VOLATILE AS $$ SELECT 'RCP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.fee_receipt_seq')::text, 6, '0') $$;

CREATE FUNCTION public.fin_issue_receipt(p_payment_transaction_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p record; v_id bigint;
BEGIN
    SELECT payment_transaction_id, student_account_id, amount, payment_status INTO p FROM payment_transaction WHERE payment_transaction_id = p_payment_transaction_id FOR UPDATE;
    IF p.payment_transaction_id IS NULL OR p.student_account_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_PAYMENT.CREATE) or unknown payment' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(p.student_account_id, 'FEE_PAYMENT', 'CREATE');
    IF p.payment_status NOT IN ('SUCCESS', 'PARTIALLY_REFUNDED') THEN RAISE EXCEPTION 'A receipt can only be issued for a successful payment' USING ERRCODE = '45000'; END IF;
    SELECT fee_receipt_id INTO v_id FROM fee_receipt WHERE payment_transaction_id = p.payment_transaction_id AND receipt_status = 'ISSUED';
    IF v_id IS NOT NULL THEN RETURN v_id; END IF; -- idempotent
    INSERT INTO fee_receipt (receipt_number, payment_transaction_id, receipt_date, receipt_amount, issued_by)
    VALUES (sims_private.fin_next_receipt_number(), p.payment_transaction_id, now(), p.amount, sims_private.current_user_id()) RETURNING fee_receipt_id INTO v_id;
    PERFORM sims_private.fin_audit('ISSUE_RECEIPT', 'fee_receipt', v_id, NULL, jsonb_build_object('payment_transaction_id', p.payment_transaction_id, 'amount', p.amount));
    RETURN v_id;
END $$;

-- p_replace = true issues a new receipt for the same payment and marks the old one REPLACED; false just cancels it.
CREATE FUNCTION public.fin_cancel_receipt(p_receipt_id bigint, p_reason text, p_replace boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_acct bigint; v_reason text := NULLIF(btrim(p_reason), ''); v_new bigint;
BEGIN
    SELECT f.fee_receipt_id, f.receipt_status, f.payment_transaction_id, f.receipt_amount, t.student_account_id INTO r
    FROM fee_receipt f JOIN payment_transaction t ON t.payment_transaction_id = f.payment_transaction_id WHERE f.fee_receipt_id = p_receipt_id FOR UPDATE OF f;
    IF r.fee_receipt_id IS NULL OR r.student_account_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_PAYMENT.UPDATE) or unknown receipt' USING ERRCODE = '42501'; END IF;
    v_acct := r.student_account_id;
    PERFORM sims_private.fin_authorize(v_acct, 'FEE_PAYMENT', 'UPDATE');
    IF v_reason IS NULL OR length(v_reason) > 500 THEN RAISE EXCEPTION 'A reason is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF r.receipt_status <> 'ISSUED' THEN RAISE EXCEPTION 'Only an issued receipt can be cancelled or replaced' USING ERRCODE = '45000'; END IF;
    UPDATE fee_receipt SET receipt_status = CASE WHEN p_replace THEN 'REPLACED' ELSE 'CANCELLED' END, cancelled_by = sims_private.current_user_id(), cancelled_at = now(), cancellation_reason = v_reason WHERE fee_receipt_id = p_receipt_id;
    IF p_replace THEN
        INSERT INTO fee_receipt (receipt_number, payment_transaction_id, receipt_date, receipt_amount, issued_by, original_receipt_id)
        VALUES (sims_private.fin_next_receipt_number(), r.payment_transaction_id, now(), r.receipt_amount, sims_private.current_user_id(), p_receipt_id) RETURNING fee_receipt_id INTO v_new;
    END IF;
    PERFORM sims_private.fin_audit(CASE WHEN p_replace THEN 'REPLACE_RECEIPT' ELSE 'CANCEL_RECEIPT' END, 'fee_receipt', p_receipt_id, jsonb_build_object('status', r.receipt_status), jsonb_build_object('reason', v_reason, 'replacement', v_new));
    RETURN v_new;
END $$;

CREATE FUNCTION public.fin_payment_receipts(p_student_account_id bigint)
RETURNS TABLE (payment_transaction_id bigint, transaction_number text, transaction_date timestamptz, amount numeric, payment_status text, mode_name text, fee_receipt_id bigint, receipt_number text, receipt_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint;
BEGIN
    SELECT student_id INTO v_student FROM student_financial_account WHERE student_account_id = p_student_account_id;
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_PAYMENT.READ']::text[], v_student, false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_PAYMENT.READ) or unknown account' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    SELECT t.payment_transaction_id::bigint, t.transaction_number::text, t.transaction_date, t.amount, t.payment_status::text, m.mode_name::text, f.fee_receipt_id::bigint, f.receipt_number::text, f.receipt_status::text
    FROM payment_transaction t JOIN payment_mode m ON m.payment_mode_id = t.payment_mode_id
    LEFT JOIN LATERAL (SELECT x.* FROM fee_receipt x WHERE x.payment_transaction_id = t.payment_transaction_id ORDER BY (x.receipt_status = 'ISSUED') DESC, x.fee_receipt_id DESC LIMIT 1) f ON true
    WHERE t.student_account_id = p_student_account_id ORDER BY t.transaction_date DESC, t.payment_transaction_id DESC;
END $$;

CREATE FUNCTION public.fin_receipt_get(p_receipt_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_student bigint;
BEGIN
    SELECT f.*, t.transaction_number, t.transaction_date, t.amount, t.payer_name, t.bank_reference_number, t.student_account_id, m.mode_name, a.account_number, a.student_id, s.student_number, s.display_name INTO r
    FROM fee_receipt f JOIN payment_transaction t ON t.payment_transaction_id = f.payment_transaction_id JOIN payment_mode m ON m.payment_mode_id = t.payment_mode_id
    JOIN student_financial_account a ON a.student_account_id = t.student_account_id JOIN student s ON s.student_id = a.student_id WHERE f.fee_receipt_id = p_receipt_id;
    v_student := r.student_id;
    IF r.fee_receipt_id IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_PAYMENT.READ']::text[], v_student, false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_PAYMENT.READ) or unknown receipt' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('fee_receipt_id', r.fee_receipt_id, 'receipt_number', r.receipt_number, 'receipt_date', r.receipt_date, 'receipt_amount', r.receipt_amount, 'receipt_status', r.receipt_status,
        'cancellation_reason', r.cancellation_reason, 'original_receipt_id', r.original_receipt_id, 'transaction_number', r.transaction_number, 'transaction_date', r.transaction_date, 'payment_mode', r.mode_name,
        'bank_reference', r.bank_reference_number, 'payer_name', r.payer_name, 'account_number', r.account_number, 'student_account_id', r.student_account_id, 'student_number', r.student_number, 'student_name', r.display_name,
        'allocations', COALESCE((SELECT jsonb_agg(jsonb_build_object('fee', COALESCE(i.description, ft.fee_name), 'amount', pa.allocated_amount) ORDER BY pa.payment_allocation_id)
                                 FROM payment_allocation pa JOIN student_fee_assessment_item i ON i.assessment_item_id = pa.assessment_item_id JOIN fee_type ft ON ft.fee_type_id = i.fee_type_id
                                 WHERE pa.payment_transaction_id = r.payment_transaction_id), '[]'::jsonb),
        'can_cancel', sims_private.can_student(ARRAY['FEES.FEE_PAYMENT.UPDATE']::text[], v_student, true) AND r.receipt_status = 'ISSUED');
END $$;

-- ---------------------------------------------------------------
-- Holds
-- ---------------------------------------------------------------
CREATE FUNCTION public.fin_hold_place(p_student_account_id bigint, p_hold_type text, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reason text := NULLIF(btrim(p_reason), ''); v_id bigint; v_status text;
BEGIN
    PERFORM sims_private.fin_authorize(p_student_account_id, 'FEE_ASSESSMENT', 'UPDATE');
    IF p_hold_type NOT IN ('REGISTRATION', 'EXAMINATION', 'HALL_TICKET', 'RESULT', 'CERTIFICATE', 'HOSTEL_CHECKOUT', 'GRADUATION', 'OTHER') THEN RAISE EXCEPTION 'Invalid hold type' USING ERRCODE = '22023'; END IF;
    IF v_reason IS NULL OR length(v_reason) > 500 THEN RAISE EXCEPTION 'A reason is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    SELECT account_status INTO v_status FROM student_financial_account WHERE student_account_id = p_student_account_id FOR UPDATE;
    IF v_status = 'CLOSED' THEN RAISE EXCEPTION 'Student account is CLOSED' USING ERRCODE = '45000'; END IF;
    SELECT financial_hold_id INTO v_id FROM student_financial_hold WHERE student_account_id = p_student_account_id AND hold_type = p_hold_type AND hold_status = 'ACTIVE';
    IF v_id IS NOT NULL THEN RETURN v_id; END IF; -- idempotent: one active hold per type
    INSERT INTO student_financial_hold (student_account_id, hold_type, hold_reason, placed_by) VALUES (p_student_account_id, p_hold_type, v_reason, sims_private.current_user_id()) RETURNING financial_hold_id INTO v_id;
    UPDATE student_financial_account SET account_status = 'ON_HOLD', updated_at = now() WHERE student_account_id = p_student_account_id AND account_status = 'ACTIVE';
    PERFORM sims_private.fin_audit('PLACE_HOLD', 'student_financial_hold', v_id, NULL, jsonb_build_object('type', p_hold_type, 'reason', v_reason));
    RETURN v_id;
END $$;

CREATE FUNCTION public.fin_hold_release(p_hold_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h record; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
    SELECT financial_hold_id, student_account_id, hold_status INTO h FROM student_financial_hold WHERE financial_hold_id = p_hold_id FOR UPDATE;
    IF h.financial_hold_id IS NULL THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.UPDATE) or unknown hold' USING ERRCODE = '42501'; END IF;
    PERFORM sims_private.fin_authorize(h.student_account_id, 'FEE_ASSESSMENT', 'UPDATE');
    IF v_reason IS NULL OR length(v_reason) > 500 THEN RAISE EXCEPTION 'A reason is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF h.hold_status <> 'ACTIVE' THEN RETURN; END IF; -- idempotent replay
    UPDATE student_financial_hold SET hold_status = 'RELEASED', released_at = now(), released_by = sims_private.current_user_id(), release_reason = v_reason WHERE financial_hold_id = p_hold_id;
    IF NOT EXISTS (SELECT 1 FROM student_financial_hold WHERE student_account_id = h.student_account_id AND hold_status = 'ACTIVE') THEN
        UPDATE student_financial_account SET account_status = 'ACTIVE', updated_at = now() WHERE student_account_id = h.student_account_id AND account_status = 'ON_HOLD';
    END IF;
    PERFORM sims_private.fin_audit('RELEASE_HOLD', 'student_financial_hold', p_hold_id, jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'RELEASED', 'reason', v_reason));
END $$;

CREATE FUNCTION public.fin_holds(p_student_account_id bigint)
RETURNS TABLE (financial_hold_id bigint, hold_type text, hold_reason text, hold_status text, placed_at timestamptz, released_at timestamptz, release_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint;
BEGIN
    SELECT student_id INTO v_student FROM student_financial_account WHERE student_account_id = p_student_account_id;
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.READ']::text[], v_student, false) THEN RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.READ) or unknown account' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT h.financial_hold_id::bigint, h.hold_type::text, h.hold_reason::text, h.hold_status::text, h.placed_at, h.released_at, h.release_reason::text
                 FROM student_financial_hold h WHERE h.student_account_id = p_student_account_id ORDER BY (h.hold_status = 'ACTIVE') DESC, h.placed_at DESC, h.financial_hold_id DESC;
END $$;

REVOKE ALL ON FUNCTION sims_private.fin_next_receipt_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_issue_receipt(bigint), public.fin_cancel_receipt(bigint, text, boolean), public.fin_payment_receipts(bigint), public.fin_receipt_get(bigint),
    public.fin_hold_place(bigint, text, text), public.fin_hold_release(bigint, text), public.fin_holds(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_issue_receipt(bigint), public.fin_cancel_receipt(bigint, text, boolean), public.fin_payment_receipts(bigint), public.fin_receipt_get(bigint),
    public.fin_hold_place(bigint, text, text), public.fin_hold_release(bigint, text), public.fin_holds(bigint) TO authenticated;
