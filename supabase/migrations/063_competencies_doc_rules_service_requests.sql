-- Employee competencies, employee document access rules, and student service requests (hall ticket, hostel check-out, graduation) with their fee holds. Hand-written (not from the MySQL source).
--
-- 1  COMPETENCIES (employee_competency, composite key): an employee is competent to teach a course at a level for a period. Read: the employee or EMPLOYEE.ALL.READ; write: EMPLOYEE.ALL.CREATE /
--    UPDATE / DELETE at the employee's scope (HR, not the employee: a self-declared competency would be unreviewed). The row's validity period must be consistent. Audited.
-- 2  DOCUMENT ACCESS RULES (employee_document_access_rule): EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE at the employee's scope can let a named user, or everyone holding a role, VIEW and/or DOWNLOAD one
--    HR document for a period (valid_from / valid_to). A rule widens access to that single document only; it never lets anyone verify, approve, change or delete, and the other flag columns are kept
--    false. The owner cannot create rules. Rules are honoured by employee_document_list / download_info and by the Storage policy (signed URLs). Every change is audited.
-- 3  STUDENT SERVICE REQUESTS (my design: the source has no tables for them, so they live in sims_private and are reached only through RPCs): HALL_TICKET (per academic term, needs a registration in that
--    term), HOSTEL_CHECKOUT (a planned date), GRADUATION. The student (or staff with DOCUMENT.ALL.CREATE) requests; DOCUMENT.ALL.APPROVE approves or rejects; the approver completes it
--    (a hall ticket gets HT-<year>-<n>, the others a reference number). Fee holds: an EXAMINATION hold blocks requesting a hall ticket, a HALL_TICKET / HOSTEL_CHECKOUT / GRADUATION hold blocks approving
--    and completing the matching request. Releasing a hold lifts the block. KI-70.

-- ---------------------------------------------------------------
-- 1 competencies
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.emp_all_can(p_emp bigint, p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(p_emp IS NOT NULL AND sims_private.can_employee(ARRAY['EMPLOYEE.ALL.' || p_action]::text[], p_emp, p_action <> 'READ'), false)
$$;
REVOKE ALL ON FUNCTION sims_private.emp_all_can(bigint, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.emp_competency_list(p_employee_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT (sims_private.emp_is_owner(p_employee_id) OR sims_private.emp_all_can(p_employee_id, 'READ')) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.ALL.READ) or unknown employee' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('can_edit', sims_private.emp_all_can(p_employee_id, 'CREATE'), 'can_delete', sims_private.emp_all_can(p_employee_id, 'DELETE'),
        'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('course_id', c.course_id, 'course_code', k.course_code, 'course_title', k.course_title, 'level', c.competency_level, 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                  'active', (c.valid_from IS NULL OR c.valid_from <= current_date) AND (c.valid_to IS NULL OR c.valid_to >= current_date)) ORDER BY k.course_code)
                  FROM employee_competency c JOIN course_catalog k ON k.course_id = c.course_id WHERE c.employee_id = p_employee_id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.emp_competency_save(p_employee_id bigint, p_course_id bigint, p_level text, p_valid_from date DEFAULT NULL, p_valid_to date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_exists boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM employee_competency WHERE employee_id = p_employee_id AND course_id = p_course_id) INTO v_exists;
    IF NOT sims_private.emp_all_can(p_employee_id, CASE WHEN v_exists THEN 'UPDATE' ELSE 'CREATE' END) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.ALL.%) or unknown employee', CASE WHEN v_exists THEN 'UPDATE' ELSE 'CREATE' END USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM employee WHERE employee_id = p_employee_id) THEN RAISE EXCEPTION 'Unknown employee' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM course_catalog WHERE course_id = p_course_id) THEN RAISE EXCEPTION 'Unknown course' USING ERRCODE = '22023'; END IF;
    IF p_level IS NULL OR p_level NOT IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT') THEN RAISE EXCEPTION 'Choose a level: beginner, intermediate, advanced or expert' USING ERRCODE = '22023'; END IF;
    IF p_valid_from IS NOT NULL AND p_valid_to IS NOT NULL AND p_valid_to < p_valid_from THEN RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = '22023'; END IF;
    SELECT to_jsonb(c) INTO v_before FROM employee_competency c WHERE employee_id = p_employee_id AND course_id = p_course_id;
    INSERT INTO employee_competency (employee_id, course_id, competency_level, valid_from, valid_to) VALUES (p_employee_id, p_course_id, p_level, p_valid_from, p_valid_to)
    ON CONFLICT (employee_id, course_id) DO UPDATE SET competency_level = EXCLUDED.competency_level, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to;
    SELECT to_jsonb(c) INTO v_after FROM employee_competency c WHERE employee_id = p_employee_id AND course_id = p_course_id;
    PERFORM sims_private.audit_manual('EMPLOYEE', CASE WHEN v_before IS NULL THEN 'INSERT' ELSE 'UPDATE' END, 'employee_competency', p_employee_id, v_before, v_after);
END $$;

CREATE FUNCTION public.emp_competency_delete(p_employee_id bigint, p_course_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before jsonb;
BEGIN
    IF NOT sims_private.emp_all_can(p_employee_id, 'DELETE') THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.ALL.DELETE) or unknown employee' USING ERRCODE = '42501'; END IF;
    SELECT to_jsonb(c) INTO v_before FROM employee_competency c WHERE employee_id = p_employee_id AND course_id = p_course_id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown competency' USING ERRCODE = '22023'; END IF;
    DELETE FROM employee_competency WHERE employee_id = p_employee_id AND course_id = p_course_id;
    PERFORM sims_private.audit_manual('EMPLOYEE', 'DELETE', 'employee_competency', p_employee_id, v_before, NULL);
END $$;

-- ---------------------------------------------------------------
-- 2 document access rules
-- ---------------------------------------------------------------
-- does a valid rule let the caller view / download this document?
CREATE FUNCTION sims_private.emp_doc_rule_ok(p_doc bigint, p_need text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM employee_document_access_rule r
         WHERE r.employee_document_id = p_doc AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
           AND CASE p_need WHEN 'download' THEN r.can_download ELSE r.can_view OR r.can_download END
           AND (r.user_id = sims_private.current_user_id()
                OR (r.role_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.v_active_user_role a WHERE a.user_id = sims_private.current_user_id() AND a.role_id = r.role_id))))
$$;
REVOKE ALL ON FUNCTION sims_private.emp_doc_rule_ok(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.emp_doc_rule_ok(bigint, text) TO authenticated;

CREATE FUNCTION public.emp_doc_rule_list(p_document_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp bigint;
BEGIN
    SELECT employee_id INTO v_emp FROM employee_document WHERE employee_document_id = p_document_id AND deleted_at IS NULL;
    IF v_emp IS NULL OR NOT sims_private.emp_can(v_emp, 'EMPLOYEE_DOCUMENT', 'UPDATE', true) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE) or unknown document' USING ERRCODE = '42501'; END IF;
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.employee_document_access_rule_id, 'who', COALESCE('role ' || ro.role_name, 'user ' || u.username), 'can_view', r.can_view, 'can_download', r.can_download,
              'valid_from', r.valid_from, 'valid_to', r.valid_to, 'active', r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())) ORDER BY r.employee_document_access_rule_id DESC)
              FROM employee_document_access_rule r LEFT JOIN role ro ON ro.role_id = r.role_id LEFT JOIN user_account u ON u.user_id = r.user_id WHERE r.employee_document_id = p_document_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.emp_doc_rule_set(p_document_id bigint, p_role_code text, p_username text, p_can_view boolean, p_can_download boolean, p_valid_to timestamptz DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp bigint; v_role integer; v_user bigint; v_id bigint;
BEGIN
    SELECT employee_id INTO v_emp FROM employee_document WHERE employee_document_id = p_document_id AND deleted_at IS NULL;
    IF v_emp IS NULL OR NOT sims_private.emp_can(v_emp, 'EMPLOYEE_DOCUMENT', 'UPDATE', true) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE) or unknown document' USING ERRCODE = '42501'; END IF;
    IF (NULLIF(btrim(p_role_code), '') IS NULL) = (NULLIF(btrim(p_username), '') IS NULL) THEN RAISE EXCEPTION 'Name either a role or a user' USING ERRCODE = '22023'; END IF;
    IF NOT (COALESCE(p_can_view, false) OR COALESCE(p_can_download, false)) THEN RAISE EXCEPTION 'Allow viewing, downloading or both' USING ERRCODE = '22023'; END IF;
    IF p_valid_to IS NOT NULL AND p_valid_to <= now() THEN RAISE EXCEPTION 'The end of the rule must be in the future' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_role_code), '') IS NOT NULL THEN
        SELECT role_id INTO v_role FROM role WHERE role_code = btrim(p_role_code) AND is_active;
        IF v_role IS NULL THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023'; END IF;
        IF btrim(p_role_code) IN ('STUDENT', 'APPLICANT', 'PARENT_GUARDIAN', 'ALUMNI') THEN RAISE EXCEPTION 'HR documents cannot be shared with that role' USING ERRCODE = '22023'; END IF;
    ELSE
        SELECT user_id INTO v_user FROM user_account WHERE lower(username) = lower(btrim(p_username)) AND account_status = 'ACTIVE';
        IF v_user IS NULL THEN RAISE EXCEPTION 'Unknown or inactive user' USING ERRCODE = '22023'; END IF;
        IF EXISTS (SELECT 1 FROM student_user_account WHERE user_id = v_user) THEN RAISE EXCEPTION 'HR documents cannot be shared with a student' USING ERRCODE = '22023'; END IF;
    END IF;
    INSERT INTO employee_document_access_rule (employee_document_id, role_id, user_id, can_view, can_download, can_update, can_verify, can_approve, valid_to, granted_by_user_id)
    VALUES (p_document_id, v_role, v_user, COALESCE(p_can_view, false) OR COALESCE(p_can_download, false), COALESCE(p_can_download, false), false, false, false, p_valid_to, sims_private.current_user_id())
    RETURNING employee_document_access_rule_id INTO v_id;
    PERFORM sims_private.emp_sensitive_log(v_emp, 'UPDATE', 'EMPLOYEE_DOCUMENT', p_document_id, 'access rule added', p_document_id);
    RETURN v_id;
END $$;

CREATE FUNCTION public.emp_doc_rule_end(p_rule_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_emp bigint;
BEGIN
    SELECT employee_document_access_rule_id, employee_document_id, valid_from, valid_to INTO r FROM employee_document_access_rule WHERE employee_document_access_rule_id = p_rule_id FOR UPDATE;
    SELECT employee_id INTO v_emp FROM employee_document WHERE employee_document_id = r.employee_document_id;
    IF v_emp IS NULL OR NOT sims_private.emp_can(v_emp, 'EMPLOYEE_DOCUMENT', 'UPDATE', true) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.UPDATE) or unknown rule' USING ERRCODE = '42501'; END IF;
    IF r.valid_to IS NOT NULL AND r.valid_to <= now() THEN RETURN; END IF;
    UPDATE employee_document_access_rule SET valid_to = CASE WHEN now() > valid_from THEN now() ELSE valid_from + interval '1 microsecond' END WHERE employee_document_access_rule_id = p_rule_id;
    PERFORM sims_private.emp_sensitive_log(v_emp, 'UPDATE', 'EMPLOYEE_DOCUMENT', r.employee_document_id, 'access rule ended', r.employee_document_id);
END $$;

-- list and download honour the rules (redefined from migration 054, plus the rule check)
CREATE OR REPLACE FUNCTION public.employee_document_list(p_employee_id bigint)
RETURNS TABLE (employee_document_id bigint, category text, document_title text, original_file_name text, mime_type text, file_size_bytes bigint, document_number text, issue_date date, expiry_date date,
               verification_status text, effective_status text, approval_status text, verification_remarks text, uploaded_at timestamptz, confidentiality_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT d.employee_document_id::bigint, c.category_name::text, d.document_title::text, f.original_file_name::text, f.mime_type::text, f.file_size_bytes::bigint, d.document_number::text, d.issue_date, d.expiry_date,
           d.verification_status::text, CASE WHEN d.verification_status = 'VERIFIED' AND d.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE d.verification_status END::text, d.approval_status::text,
           d.verification_remarks::text, f.uploaded_at, d.confidentiality_level::text
    FROM employee_document d JOIN employee_document_category c ON c.employee_document_category_id = d.employee_document_category_id JOIN file_object f ON f.file_object_id = d.file_object_id
    WHERE d.employee_id = p_employee_id AND d.deleted_at IS NULL AND f.deleted_at IS NULL
      AND (sims_private.emp_is_owner(p_employee_id) OR sims_private.emp_can(p_employee_id, 'EMPLOYEE_DOCUMENT', 'READ', false) OR sims_private.emp_doc_rule_ok(d.employee_document_id, 'view'))
    ORDER BY f.uploaded_at DESC, d.employee_document_id DESC
$$;

CREATE OR REPLACE FUNCTION public.employee_document_download_info(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT d0.employee_document_id, d0.employee_id, f.storage_key, f.original_file_name, f.mime_type INTO d
    FROM employee_document d0 JOIN file_object f ON f.file_object_id = d0.file_object_id WHERE d0.employee_document_id = p_id AND d0.deleted_at IS NULL AND f.deleted_at IS NULL;
    IF d.employee_document_id IS NULL OR NOT (sims_private.emp_is_owner(d.employee_id) OR sims_private.emp_can(d.employee_id, 'EMPLOYEE_DOCUMENT', 'READ', false) OR sims_private.emp_doc_rule_ok(d.employee_document_id, 'download')) THEN
        RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.READ) or unknown document' USING ERRCODE = '42501';
    END IF;
    PERFORM sims_private.emp_sensitive_log(d.employee_id, 'DOWNLOAD', 'EMPLOYEE_DOCUMENT', p_id, NULL, p_id);
    RETURN jsonb_build_object('storage_key', d.storage_key, 'file_name', d.original_file_name, 'mime_type', d.mime_type);
END $$;

-- the Storage policy (via can_use_student_doc_path, last defined in 054) also admits a signed URL for a file a rule lets the caller download
CREATE OR REPLACE FUNCTION sims_private.can_use_student_doc_path(p_name text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(
      CASE WHEN p_name LIKE 'employee/%' THEN
        sims_private.doc_employee_id(p_name) = sims_private.current_employee_id()
        OR sims_private.can_employee(ARRAY[CASE WHEN p_write THEN 'EMPLOYEE.EMPLOYEE_DOCUMENT.CREATE' ELSE 'EMPLOYEE.EMPLOYEE_DOCUMENT.READ' END]::text[], sims_private.doc_employee_id(p_name), p_write)
        OR (NOT p_write AND EXISTS (SELECT 1 FROM file_object f JOIN employee_document d ON d.file_object_id = f.file_object_id WHERE f.storage_key = p_name AND d.deleted_at IS NULL AND sims_private.emp_doc_rule_ok(d.employee_document_id, 'download')))
      ELSE
        sims_private.doc_student_id(p_name) = sims_private.current_student_id()
        OR sims_private.can_student(ARRAY[CASE WHEN p_write THEN 'DOCUMENT.ALL.CREATE' ELSE 'DOCUMENT.ALL.READ' END]::text[], sims_private.doc_student_id(p_name), p_write)
      END, false)
$$;

-- ---------------------------------------------------------------
-- 3 service requests
-- ---------------------------------------------------------------
CREATE TABLE sims_private.student_service_request (
    service_request_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    request_number text NOT NULL UNIQUE,
    request_kind text NOT NULL CHECK (request_kind IN ('HALL_TICKET', 'HOSTEL_CHECKOUT', 'GRADUATION')),
    student_id bigint NOT NULL REFERENCES public.student(student_id),
    academic_term_id bigint REFERENCES public.academic_term(academic_term_id),
    planned_date date,
    detail text,
    request_status text NOT NULL DEFAULT 'SUBMITTED' CHECK (request_status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
    decision_remarks text,
    decided_by bigint REFERENCES public.user_account(user_id),
    decided_at timestamptz,
    reference_number text UNIQUE,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_service_request_open ON sims_private.student_service_request (student_id, request_kind, COALESCE(academic_term_id, 0)) WHERE request_status IN ('SUBMITTED', 'APPROVED');
REVOKE ALL ON sims_private.student_service_request FROM PUBLIC, anon, authenticated;
CREATE SEQUENCE sims_private.service_request_seq;
CREATE SEQUENCE sims_private.hall_ticket_seq;

-- holds that block each step: kind -> (hold at request, hold at approval / completion)
CREATE FUNCTION sims_private.svc_hold_check(p_student bigint, p_kind text, p_step text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hold text;
BEGIN
    v_hold := CASE WHEN p_step = 'request' THEN CASE p_kind WHEN 'HALL_TICKET' THEN 'EXAMINATION' END ELSE p_kind END;
    IF v_hold IS NOT NULL AND sims_private.fin_hold_active(p_student, v_hold) THEN RAISE EXCEPTION 'This is blocked by a fee hold (%). Please contact the fee office.', lower(replace(v_hold, '_', ' ')) USING ERRCODE = '45000'; END IF;
END $$;
REVOKE ALL ON FUNCTION sims_private.svc_hold_check(bigint, text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.svc_request_create(p_kind text, p_term_id bigint DEFAULT NULL, p_planned_date date DEFAULT NULL, p_detail text DEFAULT NULL, p_student_id bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint := COALESCE(p_student_id, sims_private.current_student_id()); v_id bigint;
BEGIN
    IF v_student IS NULL OR NOT (sims_private.is_me_student(v_student) OR COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.CREATE']::text[], v_student, true), false)) THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.CREATE)' USING ERRCODE = '42501'; END IF;
    IF p_kind NOT IN ('HALL_TICKET', 'HOSTEL_CHECKOUT', 'GRADUATION') THEN RAISE EXCEPTION 'Unknown request kind' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_detail, '')) > 500 THEN RAISE EXCEPTION 'The note is limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_kind = 'HALL_TICKET' THEN
        IF p_term_id IS NULL OR NOT EXISTS (SELECT 1 FROM student_term_registration tr JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id JOIN programme_term_offering o ON o.programme_term_offering_id = tr.programme_term_offering_id
                                            WHERE e.student_id = v_student AND o.academic_term_id = p_term_id AND tr.registration_status IN ('REGISTERED', 'APPROVED')) THEN
            RAISE EXCEPTION 'A hall ticket needs a registration in that academic term' USING ERRCODE = '22023';
        END IF;
    ELSE
        p_term_id := NULL;
    END IF;
    IF p_kind = 'HOSTEL_CHECKOUT' AND (p_planned_date IS NULL OR p_planned_date < current_date) THEN RAISE EXCEPTION 'Give the planned check-out date (today or later)' USING ERRCODE = '22023'; END IF;
    IF p_kind <> 'HOSTEL_CHECKOUT' THEN p_planned_date := NULL; END IF;
    PERFORM sims_private.svc_hold_check(v_student, p_kind, 'request');
    BEGIN
        INSERT INTO sims_private.student_service_request (request_number, request_kind, student_id, academic_term_id, planned_date, detail)
        VALUES ('SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.service_request_seq')::text, 6, '0'), p_kind, v_student, p_term_id, p_planned_date, NULLIF(btrim(p_detail), '')) RETURNING service_request_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'There is already an open request of this kind' USING ERRCODE = '45000';
    END;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'SERVICE_REQUESTED', 'student_service_request', v_id::text, jsonb_build_object('kind', p_kind, 'student_id', v_student));
    RETURN v_id;
END $$;

CREATE FUNCTION public.svc_request_list(p_kind text DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS TABLE (service_request_id bigint, request_number text, request_kind text, student_id bigint, student_number text, student_name text, term_name text, planned_date date, detail text, request_status text, decision_remarks text,
               reference_number text, created_at timestamptz, can_decide boolean, can_cancel boolean, hold_blocked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.service_request_id::bigint, r.request_number, r.request_kind, r.student_id::bigint, s.student_number::text, s.display_name::text, t.term_name::text, r.planned_date, r.detail, r.request_status, r.decision_remarks, r.reference_number, r.created_at,
           r.request_status IN ('SUBMITTED', 'APPROVED') AND COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.APPROVE']::text[], r.student_id, true), false),
           r.request_status = 'SUBMITTED' AND (sims_private.is_me_student(r.student_id) OR COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.UPDATE']::text[], r.student_id, true), false)),
           sims_private.fin_hold_active(r.student_id, r.request_kind)
    FROM sims_private.student_service_request r JOIN student s ON s.student_id = r.student_id LEFT JOIN academic_term t ON t.academic_term_id = r.academic_term_id
    WHERE (p_kind IS NULL OR r.request_kind = p_kind) AND (p_status IS NULL OR r.request_status = p_status)
      AND (sims_private.is_me_student(r.student_id) OR COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.READ']::text[], r.student_id, false), false))
    ORDER BY r.created_at DESC, r.service_request_id DESC LIMIT 200
$$;

-- p_action: APPROVE | REJECT | COMPLETE
CREATE FUNCTION public.svc_request_decide(p_id bigint, p_action text, p_remarks text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_ref text; v_rem text := NULLIF(btrim(p_remarks), '');
BEGIN
    SELECT * INTO r FROM sims_private.student_service_request WHERE service_request_id = p_id FOR UPDATE;
    IF r.service_request_id IS NULL OR NOT COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.APPROVE']::text[], r.student_id, true), false) THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.APPROVE) or unknown request' USING ERRCODE = '42501'; END IF;
    IF p_action NOT IN ('APPROVE', 'REJECT', 'COMPLETE') THEN RAISE EXCEPTION 'The action must be APPROVE, REJECT or COMPLETE' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_action = 'REJECT' AND v_rem IS NULL THEN RAISE EXCEPTION 'A reason is required to reject' USING ERRCODE = '22023'; END IF;
    IF p_action IN ('APPROVE', 'REJECT') AND r.request_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted request can be approved or rejected (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    IF p_action = 'COMPLETE' AND r.request_status <> 'APPROVED' THEN RAISE EXCEPTION 'Only an approved request can be completed (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    IF p_action IN ('APPROVE', 'COMPLETE') THEN PERFORM sims_private.svc_hold_check(r.student_id, r.request_kind, 'decide'); END IF;
    IF p_action = 'REJECT' THEN
        UPDATE sims_private.student_service_request SET request_status = 'REJECTED', decision_remarks = v_rem, decided_by = sims_private.current_user_id(), decided_at = now() WHERE service_request_id = p_id;
    ELSIF p_action = 'APPROVE' THEN
        UPDATE sims_private.student_service_request SET request_status = 'APPROVED', decision_remarks = v_rem, decided_by = sims_private.current_user_id(), decided_at = now() WHERE service_request_id = p_id;
    ELSE
        v_ref := CASE r.request_kind WHEN 'HALL_TICKET' THEN 'HT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.hall_ticket_seq')::text, 6, '0')
                                      WHEN 'HOSTEL_CHECKOUT' THEN 'HC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.service_request_seq')::text, 6, '0')
                                      ELSE 'GR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.service_request_seq')::text, 6, '0') END;
        UPDATE sims_private.student_service_request SET request_status = 'COMPLETED', completed_at = now(), reference_number = v_ref WHERE service_request_id = p_id;
    END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details)
    VALUES (sims_private.current_user_id(), 'DOCUMENT', 'SERVICE_' || p_action, 'student_service_request', p_id::text, jsonb_build_object('kind', r.request_kind, 'remarks', v_rem, 'reference', v_ref));
    RETURN v_ref;
END $$;

CREATE FUNCTION public.svc_request_cancel(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM sims_private.student_service_request WHERE service_request_id = p_id FOR UPDATE;
    IF r.service_request_id IS NULL OR NOT (sims_private.is_me_student(r.student_id) OR COALESCE(sims_private.can_student(ARRAY['DOCUMENT.ALL.UPDATE']::text[], r.student_id, true), false)) THEN RAISE EXCEPTION 'Not authorised or unknown request' USING ERRCODE = '42501'; END IF;
    IF r.request_status = 'CANCELLED' THEN RETURN; END IF;
    IF r.request_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted request can be cancelled (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    UPDATE sims_private.student_service_request SET request_status = 'CANCELLED' WHERE service_request_id = p_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'SERVICE_CANCELLED', 'student_service_request', p_id::text, '{}'::jsonb);
END $$;

-- terms the student can ask a hall ticket for
CREATE FUNCTION public.svc_my_terms() RETURNS TABLE (academic_term_id bigint, term_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT DISTINCT t.academic_term_id::bigint, t.term_name::text FROM student_term_registration tr JOIN student_programme_enrolment e ON e.enrolment_id = tr.enrolment_id
    JOIN programme_term_offering o ON o.programme_term_offering_id = tr.programme_term_offering_id JOIN academic_term t ON t.academic_term_id = o.academic_term_id
    WHERE e.student_id = sims_private.current_student_id() AND tr.registration_status IN ('REGISTERED', 'APPROVED') ORDER BY 2
$$;

REVOKE ALL ON FUNCTION public.emp_competency_list(bigint), public.emp_competency_save(bigint, bigint, text, date, date), public.emp_competency_delete(bigint, bigint), public.emp_doc_rule_list(bigint),
    public.emp_doc_rule_set(bigint, text, text, boolean, boolean, timestamptz), public.emp_doc_rule_end(bigint), public.svc_request_create(text, bigint, date, text, bigint), public.svc_request_list(text, text),
    public.svc_request_decide(bigint, text, text), public.svc_request_cancel(bigint), public.svc_my_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emp_competency_list(bigint), public.emp_competency_save(bigint, bigint, text, date, date), public.emp_competency_delete(bigint, bigint), public.emp_doc_rule_list(bigint),
    public.emp_doc_rule_set(bigint, text, text, boolean, boolean, timestamptz), public.emp_doc_rule_end(bigint), public.svc_request_create(text, bigint, date, text, bigint), public.svc_request_list(text, text),
    public.svc_request_decide(bigint, text, text), public.svc_request_cancel(bigint), public.svc_my_terms() TO authenticated;
