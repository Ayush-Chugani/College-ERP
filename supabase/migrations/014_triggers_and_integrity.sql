-- Hand-ported triggers (source lines 3070-3353) and updated_at maintenance

-- Hand-port of the 16 MySQL triggers in SIMS-DatabaseWithoutLessonPlan.sql (lines 3070-3353).
-- Trigger names are preserved 1:1; MySQL SIGNAL SQLSTATE '45000' becomes RAISE ... ERRCODE '45000'.
-- MySQL "<=>" becomes IS NOT DISTINCT FROM. SELECT ... INTO without STRICT leaves NULLs on no row, as in MySQL.
-- MySQL row locks (FOR UPDATE) are kept; under READ COMMITTED each later statement sees committed rows after the lock wait.

-- ---------------------------------------------------------------
-- Shared: ON UPDATE CURRENT_TIMESTAMP replacement (37 tables with updated_at)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    -- MySQL ON UPDATE only bumps the column when the row actually changed.
    IF NEW IS DISTINCT FROM OLD THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------
-- RBAC scope integrity
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_user_role_assignment_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_role_level text;
BEGIN
    SELECT role_level INTO v_role_level FROM role WHERE role_id = NEW.role_id;
    IF v_role_level <> NEW.scope_type THEN
        RAISE EXCEPTION 'Role level must match assignment scope_type' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_user_role_assignment_scope_bi BEFORE INSERT ON user_role_assignment
    FOR EACH ROW EXECUTE FUNCTION sims_user_role_assignment_scope();
CREATE TRIGGER trg_user_role_assignment_scope_bu BEFORE UPDATE ON user_role_assignment
    FOR EACH ROW EXECUTE FUNCTION sims_user_role_assignment_scope();

CREATE OR REPLACE FUNCTION sims_user_permission_override_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.scope_type = 'INSTITUTION' AND NOT EXISTS (SELECT 1 FROM institution WHERE institution_id = NEW.scope_entity_id) THEN
        RAISE EXCEPTION 'Invalid institution scope_entity_id' USING ERRCODE = '45000';
    ELSIF NEW.scope_type = 'CAMPUS' AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id = NEW.scope_entity_id) THEN
        RAISE EXCEPTION 'Invalid campus scope_entity_id' USING ERRCODE = '45000';
    ELSIF NEW.scope_type = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department WHERE department_id = NEW.scope_entity_id) THEN
        RAISE EXCEPTION 'Invalid department scope_entity_id' USING ERRCODE = '45000';
    ELSIF NEW.scope_type = 'PROGRAMME' AND NOT EXISTS (SELECT 1 FROM programme WHERE programme_id = NEW.scope_entity_id) THEN
        RAISE EXCEPTION 'Invalid programme scope_entity_id' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_user_permission_override_scope_bi BEFORE INSERT ON user_permission_override
    FOR EACH ROW EXECUTE FUNCTION sims_user_permission_override_scope();
CREATE TRIGGER trg_user_permission_override_scope_bu BEFORE UPDATE ON user_permission_override
    FOR EACH ROW EXECUTE FUNCTION sims_user_permission_override_scope();

-- ---------------------------------------------------------------
-- Fee assessment header totals follow item rows
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_sync_fee_assessment_totals(p_assessment_id bigint) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
    UPDATE student_fee_assessment a
    SET gross_amount        = (SELECT COALESCE(SUM(i.original_amount),0)   FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        concession_amount   = (SELECT COALESCE(SUM(i.concession_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        scholarship_amount  = (SELECT COALESCE(SUM(i.scholarship_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        adjustment_amount   = (SELECT COALESCE(SUM(i.adjustment_amount),0) FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        net_payable_amount  = (SELECT COALESCE(SUM(i.net_amount),0)        FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        amount_paid         = (SELECT COALESCE(SUM(i.amount_paid),0)       FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id),
        balance_amount      = (SELECT COALESCE(SUM(i.balance_amount),0)    FROM student_fee_assessment_item i WHERE i.fee_assessment_id = p_assessment_id)
    WHERE a.fee_assessment_id = p_assessment_id;
$$;

CREATE OR REPLACE FUNCTION sims_fee_item_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM sims_sync_fee_assessment_totals(NEW.fee_assessment_id);
    END IF;
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.fee_assessment_id <> NEW.fee_assessment_id) THEN
        PERFORM sims_sync_fee_assessment_totals(OLD.fee_assessment_id);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_fee_item_ai AFTER INSERT ON student_fee_assessment_item FOR EACH ROW EXECUTE FUNCTION sims_fee_item_sync();
CREATE TRIGGER trg_fee_item_au AFTER UPDATE ON student_fee_assessment_item FOR EACH ROW EXECUTE FUNCTION sims_fee_item_sync();
CREATE TRIGGER trg_fee_item_ad AFTER DELETE ON student_fee_assessment_item FOR EACH ROW EXECUTE FUNCTION sims_fee_item_sync();

-- ---------------------------------------------------------------
-- Payment allocation guards
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_payment_allocation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    v_payment_amount numeric(12,2);
    v_status text;
    v_payment_account bigint;
    v_payment_application bigint;
    v_item_net numeric(12,2);
    v_assessment_account bigint;
    v_assessment_application bigint;
    v_existing_payment numeric(12,2);
    v_existing_item numeric(12,2);
    v_self bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.payment_allocation_id ELSE NULL END;
BEGIN
    SELECT amount, payment_status, student_account_id, application_id
      INTO v_payment_amount, v_status, v_payment_account, v_payment_application
      FROM payment_transaction WHERE payment_transaction_id = NEW.payment_transaction_id FOR UPDATE;
    IF v_status <> 'SUCCESS' THEN
        RAISE EXCEPTION 'Only SUCCESS payments can be allocated' USING ERRCODE = '45000';
    END IF;
    SELECT i.net_amount, a.student_account_id, a.application_id
      INTO v_item_net, v_assessment_account, v_assessment_application
      FROM student_fee_assessment_item i JOIN student_fee_assessment a ON a.fee_assessment_id = i.fee_assessment_id
      WHERE i.assessment_item_id = NEW.assessment_item_id FOR UPDATE;
    IF NOT ((v_payment_account IS NOT NULL AND v_payment_account IS NOT DISTINCT FROM v_assessment_account)
            OR (v_payment_application IS NOT NULL AND v_payment_application IS NOT DISTINCT FROM v_assessment_application)) THEN
        RAISE EXCEPTION 'Payment and assessment contexts do not match' USING ERRCODE = '45000';
    END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_payment FROM payment_allocation
      WHERE payment_transaction_id = NEW.payment_transaction_id
        AND (v_self IS NULL OR payment_allocation_id <> v_self);
    IF v_existing_payment + NEW.allocated_amount > v_payment_amount THEN
        RAISE EXCEPTION 'Allocation exceeds payment amount' USING ERRCODE = '45000';
    END IF;
    SELECT COALESCE(SUM(allocated_amount),0) INTO v_existing_item FROM payment_allocation
      WHERE assessment_item_id = NEW.assessment_item_id
        AND (v_self IS NULL OR payment_allocation_id <> v_self);
    IF v_existing_item + NEW.allocated_amount > v_item_net THEN
        RAISE EXCEPTION 'Allocation exceeds assessment item net amount' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_payment_allocation_bi BEFORE INSERT ON payment_allocation FOR EACH ROW EXECUTE FUNCTION sims_payment_allocation_guard();
CREATE TRIGGER trg_payment_allocation_bu BEFORE UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION sims_payment_allocation_guard();

CREATE OR REPLACE FUNCTION sims_recalc_fee_item_paid(p_item_id bigint) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
    UPDATE student_fee_assessment_item i
    SET amount_paid     = (SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id = p_item_id),
        balance_amount  = net_amount - (SELECT COALESCE(SUM(pa.allocated_amount),0) FROM payment_allocation pa WHERE pa.assessment_item_id = p_item_id)
    WHERE i.assessment_item_id = p_item_id;
$$;

CREATE OR REPLACE FUNCTION sims_payment_allocation_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM sims_recalc_fee_item_paid(NEW.assessment_item_id);
    END IF;
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.assessment_item_id <> NEW.assessment_item_id) THEN
        PERFORM sims_recalc_fee_item_paid(OLD.assessment_item_id);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_payment_allocation_ai AFTER INSERT ON payment_allocation FOR EACH ROW EXECUTE FUNCTION sims_payment_allocation_sync();
CREATE TRIGGER trg_payment_allocation_au AFTER UPDATE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION sims_payment_allocation_sync();
CREATE TRIGGER trg_payment_allocation_ad AFTER DELETE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION sims_payment_allocation_sync();

-- ---------------------------------------------------------------
-- Benefit totals cannot exceed the original assessed item amount
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_fee_benefit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    v_original numeric(12,2);
    v_existing numeric(12,2);
    v_self bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.assessment_benefit_id ELSE NULL END;
BEGIN
    SELECT original_amount INTO v_original FROM student_fee_assessment_item WHERE assessment_item_id = NEW.assessment_item_id FOR UPDATE;
    SELECT COALESCE(SUM(benefit_amount),0) INTO v_existing FROM fee_assessment_benefit
      WHERE assessment_item_id = NEW.assessment_item_id AND (v_self IS NULL OR assessment_benefit_id <> v_self);
    IF v_existing + NEW.benefit_amount > v_original THEN
        RAISE EXCEPTION 'Benefits exceed original assessment item amount' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_fee_benefit_bi BEFORE INSERT ON fee_assessment_benefit FOR EACH ROW EXECUTE FUNCTION sims_fee_benefit_guard();
CREATE TRIGGER trg_fee_benefit_bu BEFORE UPDATE ON fee_assessment_benefit FOR EACH ROW EXECUTE FUNCTION sims_fee_benefit_guard();

-- ---------------------------------------------------------------
-- Refunds cannot exceed approval or the original payment
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION sims_fee_refund_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    v_approved numeric(12,2);
    v_request_status text;
    v_payment_id bigint;
    v_payment_amount numeric(12,2);
    v_request_refunded numeric(12,2);
    v_payment_refunded numeric(12,2);
    v_self bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.fee_refund_id ELSE NULL END;
BEGIN
    SELECT approved_amount, request_status, payment_transaction_id INTO v_approved, v_request_status, v_payment_id
      FROM refund_request WHERE refund_request_id = NEW.refund_request_id FOR UPDATE;
    IF v_approved IS NULL OR v_request_status NOT IN ('APPROVED','PROCESSED') THEN
        RAISE EXCEPTION 'Refund request must be approved' USING ERRCODE = '45000';
    END IF;
    SELECT COALESCE(SUM(refund_amount),0) INTO v_request_refunded FROM fee_refund
      WHERE refund_request_id = NEW.refund_request_id AND refund_status = 'SUCCESS'
        AND (v_self IS NULL OR fee_refund_id <> v_self);
    IF NEW.refund_status = 'SUCCESS' AND v_request_refunded + NEW.refund_amount > v_approved THEN
        RAISE EXCEPTION 'Refund exceeds approved amount' USING ERRCODE = '45000';
    END IF;
    IF v_payment_id IS NOT NULL AND NEW.refund_status = 'SUCCESS' THEN
        SELECT amount INTO v_payment_amount FROM payment_transaction WHERE payment_transaction_id = v_payment_id FOR UPDATE;
        SELECT COALESCE(SUM(fr.refund_amount),0) INTO v_payment_refunded
          FROM fee_refund fr JOIN refund_request rr ON rr.refund_request_id = fr.refund_request_id
          WHERE rr.payment_transaction_id = v_payment_id AND fr.refund_status = 'SUCCESS'
            AND (v_self IS NULL OR fr.fee_refund_id <> v_self);
        IF v_payment_refunded + NEW.refund_amount > v_payment_amount THEN
            RAISE EXCEPTION 'Cumulative refund exceeds payment amount' USING ERRCODE = '45000';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_fee_refund_bi BEFORE INSERT ON fee_refund FOR EACH ROW EXECUTE FUNCTION sims_fee_refund_guard();
CREATE TRIGGER trg_fee_refund_bu BEFORE UPDATE ON fee_refund FOR EACH ROW EXECUTE FUNCTION sims_fee_refund_guard();

-- ON UPDATE CURRENT_TIMESTAMP replacement for the 37 columns that used it
CREATE TRIGGER trg_university_touch_updated_at BEFORE UPDATE ON university FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_institution_touch_updated_at BEFORE UPDATE ON institution FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_touch_updated_at BEFORE UPDATE ON student FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_staff_type_touch_updated_at BEFORE UPDATE ON staff_type FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_staff_category_touch_updated_at BEFORE UPDATE ON staff_category FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employment_source_touch_updated_at BEFORE UPDATE ON employment_source FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_external_agency_touch_updated_at BEFORE UPDATE ON external_agency FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_touch_updated_at BEFORE UPDATE ON employee FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_admission_applicant_touch_updated_at BEFORE UPDATE ON admission_applicant FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_admission_application_touch_updated_at BEFORE UPDATE ON admission_application FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_file_object_touch_updated_at BEFORE UPDATE ON file_object FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_user_account_touch_updated_at BEFORE UPDATE ON user_account FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_role_touch_updated_at BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_qualification_level_touch_updated_at BEFORE UPDATE ON qualification_level FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_education_institution_touch_updated_at BEFORE UPDATE ON education_institution FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_awarding_body_touch_updated_at BEFORE UPDATE ON awarding_body FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_previous_organization_touch_updated_at BEFORE UPDATE ON previous_organization FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_qualification_touch_updated_at BEFORE UPDATE ON employee_qualification FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_previous_employment_touch_updated_at BEFORE UPDATE ON employee_previous_employment FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_bank_account_touch_updated_at BEFORE UPDATE ON employee_bank_account FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_pan_touch_updated_at BEFORE UPDATE ON employee_pan FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_aadhaar_touch_updated_at BEFORE UPDATE ON employee_aadhaar FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_employee_document_touch_updated_at BEFORE UPDATE ON employee_document FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_fee_category_touch_updated_at BEFORE UPDATE ON fee_category FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_fee_type_touch_updated_at BEFORE UPDATE ON fee_type FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_fee_structure_touch_updated_at BEFORE UPDATE ON fee_structure FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_financial_account_touch_updated_at BEFORE UPDATE ON student_financial_account FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_fee_assessment_touch_updated_at BEFORE UPDATE ON student_fee_assessment FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_publication_type_touch_updated_at BEFORE UPDATE ON publication_type FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_external_organization_touch_updated_at BEFORE UPDATE ON external_organization FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_staff_activity_touch_updated_at BEFORE UPDATE ON staff_activity FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_journal_touch_updated_at BEFORE UPDATE ON journal FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_conference_event_touch_updated_at BEFORE UPDATE ON conference_event FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_evidence_document_touch_updated_at BEFORE UPDATE ON evidence_document FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_activity_type_touch_updated_at BEFORE UPDATE ON student_activity_type FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_activity_touch_updated_at BEFORE UPDATE ON student_activity FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
CREATE TRIGGER trg_student_activity_evidence_touch_updated_at BEFORE UPDATE ON student_activity_evidence FOR EACH ROW EXECUTE FUNCTION sims_touch_updated_at();
