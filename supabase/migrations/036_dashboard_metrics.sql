-- Dashboard aggregates. Hand-written (not from the MySQL source).
--
-- All functions are SECURITY INVOKER on purpose: they aggregate over the real tables, so row-level security decides what each caller
-- counts. A registrar sees their institution's numbers, a super admin everything, a student only their own rows. No authorisation
-- logic is duplicated here. Names come from joins that are also subject to RLS; where the caller cannot read the name table, a
-- generic label is used instead (counts are never widened).
-- Months are UTC calendar months.

CREATE FUNCTION public.dash_enrolments() RETURNS TABLE (programme_id integer, label text, enrolment_status text, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT e.programme_id::integer, COALESCE(p.programme_name, 'Programme #' || e.programme_id)::text, e.enrolment_status::text, count(*)
    FROM student_programme_enrolment e LEFT JOIN programme p ON p.programme_id = e.programme_id
    GROUP BY e.programme_id, p.programme_name, e.enrolment_status ORDER BY 2, 3
$$;

CREATE FUNCTION public.dash_applications() RETURNS TABLE (application_status text, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT a.application_status::text, count(*) FROM admission_application a GROUP BY a.application_status ORDER BY 1
$$;

CREATE FUNCTION public.dash_registrations() RETURNS TABLE (registration_status text, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT r.registration_status::text, count(*) FROM student_term_registration r GROUP BY r.registration_status ORDER BY 1
$$;

CREATE FUNCTION public.dash_employees() RETURNS TABLE (employment_type text, employment_status text, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT e.employment_type::text, e.employment_status::text, count(*) FROM employee e GROUP BY e.employment_type, e.employment_status ORDER BY 1, 2
$$;

-- Class sessions dated within the last p_days days (including today and future sessions up to today).
CREATE FUNCTION public.dash_sessions(p_days integer DEFAULT 30) RETURNS TABLE (session_status text, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT c.session_status::text, count(*) FROM class_session c
    WHERE c.session_date <= current_date AND c.session_date > current_date - GREATEST(LEAST(COALESCE(p_days, 30), 366), 1)
    GROUP BY c.session_status ORDER BY 1
$$;

CREATE FUNCTION public.dash_term_results() RETURNS TABLE (result_status text, published boolean, n bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT r.result_status::text, r.published_at IS NOT NULL, count(*) FROM student_term_result r GROUP BY r.result_status, r.published_at IS NOT NULL ORDER BY 1, 2
$$;

-- Successful payments per month for the last p_months months (months without payments are included with zero).
CREATE FUNCTION public.dash_fee_collection(p_months integer DEFAULT 6) RETURNS TABLE (month date, collected numeric, payments bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    WITH m AS (
        SELECT generate_series(date_trunc('month', timezone('UTC', now()))::date - ((GREATEST(LEAST(COALESCE(p_months, 6), 36), 1) - 1) * interval '1 month'),
                               date_trunc('month', timezone('UTC', now()))::date, interval '1 month')::date AS month
    )
    SELECT m.month, COALESCE(sum(p.amount), 0), count(p.payment_transaction_id)
    FROM m LEFT JOIN payment_transaction p
      ON p.payment_status = 'SUCCESS' AND date_trunc('month', timezone('UTC', p.transaction_date))::date = m.month
    GROUP BY m.month ORDER BY m.month
$$;

CREATE FUNCTION public.dash_fee_outstanding() RETURNS TABLE (payable numeric, paid numeric, balance numeric, overdue_assessments bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT COALESCE(sum(f.net_payable_amount), 0), COALESCE(sum(f.amount_paid), 0), COALESCE(sum(f.balance_amount), 0),
           count(*) FILTER (WHERE f.balance_amount > 0 AND f.due_date IS NOT NULL AND f.due_date < current_date)
    FROM student_fee_assessment f WHERE f.assessment_status NOT IN ('CANCELLED', 'WAIVED', 'DRAFT')
$$;

REVOKE ALL ON FUNCTION public.dash_enrolments(), public.dash_applications(), public.dash_registrations(), public.dash_employees(), public.dash_sessions(integer),
    public.dash_term_results(), public.dash_fee_collection(integer), public.dash_fee_outstanding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_enrolments(), public.dash_applications(), public.dash_registrations(), public.dash_employees(), public.dash_sessions(integer),
    public.dash_term_results(), public.dash_fee_collection(integer), public.dash_fee_outstanding() TO authenticated;
