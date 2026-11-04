-- Read helpers and account opening for the finance screens. Hand-written (not from the MySQL source).
-- Finance staff hold FEES permissions but not necessarily STUDENT read access, so they cannot see student names directly. These
-- functions return only what the screens need, authorised per student with FEES.FEE_ASSESSMENT.READ (SELF reads of own account included).
--
-- ASSUMPTION (documented in KNOWN_ISSUES KI-40): an account's number is "ACC-" || student_number. The source defines no numbering rule.
-- The account totals count assessments that are not CANCELLED or WAIVED.

CREATE FUNCTION public.fin_accounts(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (student_account_id bigint, student_id bigint, account_number text, account_status text, student_number text, display_name text,
               total_payable numeric, total_paid numeric, total_balance numeric, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH visible AS (
        SELECT a.student_account_id, a.student_id, a.account_number::text, a.account_status::text, s.student_number::text, s.display_name::text,
               COALESCE((SELECT sum(f.net_payable_amount) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0) AS total_payable,
               COALESCE((SELECT sum(f.amount_paid) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0) AS total_paid,
               COALESCE((SELECT sum(f.balance_amount) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0) AS total_balance
        FROM student_financial_account a
        JOIN student s ON s.student_id = a.student_id
        WHERE (p_status IS NULL OR a.account_status = p_status)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(s.student_number || ' ' || s.display_name || ' ' || a.account_number)) > 0)
          AND sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.READ']::text[], a.student_id, false)
    )
    SELECT v.*, count(*) OVER () FROM visible v ORDER BY v.display_name, v.student_account_id
    LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.fin_account_info(p_student_account_id bigint)
RETURNS TABLE (student_account_id bigint, student_id bigint, account_number text, account_status text, student_number text, display_name text,
               opening_balance numeric, credit_balance numeric, total_payable numeric, total_paid numeric, total_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint;
BEGIN
    SELECT a.student_id INTO v_student FROM student_financial_account a WHERE a.student_account_id = p_student_account_id;
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.READ']::text[], v_student, false) THEN
        RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.READ) or unknown account' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT a.student_account_id::bigint, a.student_id::bigint, a.account_number::text, a.account_status::text, s.student_number::text, s.display_name::text, a.opening_balance, a.credit_balance,
           COALESCE((SELECT sum(f.net_payable_amount) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0),
           COALESCE((SELECT sum(f.amount_paid) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0),
           COALESCE((SELECT sum(f.balance_amount) FROM student_fee_assessment f WHERE f.student_account_id = a.student_account_id AND f.assessment_status NOT IN ('CANCELLED', 'WAIVED')), 0)
    FROM student_financial_account a JOIN student s ON s.student_id = a.student_id
    WHERE a.student_account_id = p_student_account_id;
END $$;

-- Opens the student's financial account (idempotent: returns the existing one).
CREATE FUNCTION public.fin_open_account(p_student_number text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint; v_number text; v_id bigint;
BEGIN
    IF p_student_number IS NULL OR btrim(p_student_number) = '' THEN RAISE EXCEPTION 'student_number is required' USING ERRCODE = '22023'; END IF;
    SELECT s.student_id, s.student_number::text INTO v_student, v_number FROM student s WHERE s.student_number = btrim(p_student_number);
    -- Same error for "unknown" and "out of scope": no student enumeration.
    IF v_student IS NULL OR NOT sims_private.can_student(ARRAY['FEES.FEE_ASSESSMENT.CREATE']::text[], v_student, true) THEN
        RAISE EXCEPTION 'Not authorised (FEES.FEE_ASSESSMENT.CREATE) or unknown student' USING ERRCODE = '42501';
    END IF;
    SELECT student_account_id INTO v_id FROM student_financial_account WHERE account_number = 'ACC-' || v_number;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    INSERT INTO student_financial_account (student_id, account_number) VALUES (v_student, 'ACC-' || v_number) RETURNING student_account_id INTO v_id;
    PERFORM sims_private.fin_audit('ACCOUNT_OPENED', 'student_financial_account', v_id, NULL, jsonb_build_object('student_id', v_student, 'account_number', 'ACC-' || v_number));
    RETURN v_id;
END $$;

-- Payments and refunds on an account with the names a finance screen needs (rows themselves are read under RLS).
REVOKE ALL ON FUNCTION public.fin_accounts(text, text, integer, integer), public.fin_account_info(bigint), public.fin_open_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_accounts(text, text, integer, integer), public.fin_account_info(bigint), public.fin_open_account(text) TO authenticated;

-- Academic years for the assessment form (finance staff typically lack ACADEMIC_CALENDAR read; the values are plain reference data).
CREATE FUNCTION public.fin_academic_years() RETURNS TABLE (academic_year_id integer, year_code text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT y.academic_year_id::integer, y.year_code::text, y.status::text FROM academic_year y
    WHERE sims_private.current_user_id() IS NOT NULL ORDER BY y.start_date DESC
$$;
REVOKE ALL ON FUNCTION public.fin_academic_years() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_academic_years() TO authenticated;
