-- Student activities and evidence (module 23). Hand-written (not from the MySQL source).
--
-- DESIGN
--  * student_activity, student_activity_team_member, student_activity_evidence, ..._version and ..._audit are RPC-only for writes. A student acts on their OWN activities by identity (the seed gives
--    students SELF-scope grants, which never authorise writes); staff act with STUDENT.STUDENT_ACTIVITY[_EVIDENCE].* at the student's scope.
--  * Evidence files live in the private bucket 'sims-documents' under student/<student_id>/... (policies from migration 042 already let the owner and DOCUMENT-permission staff upload there).
--    Evidence rows keep every uploaded version; replacing a file adds a version and never deletes bytes. Removing evidence is a soft delete.
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-54):
--  1  Approval: DRAFT -> SUBMITTED -> (verification) -> UNDER_REVIEW -> APPROVED | REJECTED. Verification: NOT_SUBMITTED -> PENDING (on submit) -> VERIFIED | NEEDS_CORRECTION | REJECTED.
--     VERIFIED moves approval to UNDER_REVIEW; NEEDS_CORRECTION returns it to DRAFT (remarks required); REJECTED at either step ends it as REJECTED (remarks required). Approval needs VERIFIED first.
--  2  Only DRAFT activities can be edited, get team members or evidence changes, or be soft-deleted (a REJECTED one can be soft-deleted too).
--  3  Submitting needs: a title, a start date, the team name when the type requires team details, and at least minimum_files current evidence items for every mandatory requirement of the type.
--  4  The activity's institution / campus / department / programme come from the student's most recent enrolment; a student without one cannot record an activity.
--  5  Evidence is CONFIDENTIAL; the same file-type, size and key rules as student documents apply. Every evidence action writes student_activity_evidence_audit.

REVOKE INSERT, UPDATE, DELETE ON student_activity, student_activity_team_member, student_activity_evidence, student_activity_evidence_version, student_activity_evidence_audit FROM authenticated;
DROP POLICY student_activity_insert ON student_activity;
DROP POLICY student_activity_update ON student_activity;
DROP POLICY student_activity_delete ON student_activity;
DROP POLICY student_activity_team_member_insert ON student_activity_team_member;
DROP POLICY student_activity_team_member_update ON student_activity_team_member;
DROP POLICY student_activity_team_member_delete ON student_activity_team_member;
DROP POLICY student_activity_evidence_insert ON student_activity_evidence;
DROP POLICY student_activity_evidence_update ON student_activity_evidence;
DROP POLICY student_activity_evidence_delete ON student_activity_evidence;
DROP POLICY student_activity_evidence_version_insert ON student_activity_evidence_version;
DROP POLICY student_activity_evidence_version_update ON student_activity_evidence_version;
DROP POLICY student_activity_evidence_version_delete ON student_activity_evidence_version;
DROP POLICY student_activity_evidence_audit_insert ON student_activity_evidence_audit;
DROP POLICY student_activity_evidence_audit_update ON student_activity_evidence_audit;
DROP POLICY student_activity_evidence_audit_delete ON student_activity_evidence_audit;

CREATE TRIGGER trg_student_activity_audit AFTER INSERT OR UPDATE OR DELETE ON student_activity FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('STUDENT', 'student_activity_id');

CREATE FUNCTION sims_private.vstatus(p_code text) RETURNS smallint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT verification_status_id FROM verification_status WHERE status_code = p_code $$;
CREATE FUNCTION sims_private.astatus(p_code text) RETURNS smallint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT approval_status_id FROM approval_status WHERE status_code = p_code $$;

-- Who may act on an activity of student p_student: 'owner', 'staff' (p_perm at scope) or NULL.
CREATE FUNCTION sims_private.activity_actor(p_student bigint, p_perm text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN COALESCE(p_student = sims_private.current_student_id(), false) THEN 'owner'
                WHEN sims_private.can_student(ARRAY[p_perm]::text[], p_student, true) THEN 'staff' END
$$;

-- Shared upload checks (same rules as student_document_register).
CREATE FUNCTION sims_private.check_student_upload(p_student bigint, p_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ext text; v_meta jsonb;
BEGIN
    IF sims_private.doc_student_id(p_key) IS DISTINCT FROM p_student THEN RAISE EXCEPTION 'The file is not stored under this student' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR btrim(p_file_name) = '' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The file name is required (at most 255 characters)' USING ERRCODE = '22023'; END IF;
    IF p_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN RAISE EXCEPTION 'Only PDF, JPEG and PNG files are accepted' USING ERRCODE = '22023'; END IF;
    v_ext := lower(substring(p_file_name FROM '\.([A-Za-z0-9]{1,10})$'));
    IF v_ext IS NULL OR NOT ((p_mime = 'application/pdf' AND v_ext = 'pdf') OR (p_mime = 'image/jpeg' AND v_ext IN ('jpg', 'jpeg')) OR (p_mime = 'image/png' AND v_ext = 'png')) THEN
        RAISE EXCEPTION 'The file name does not match its type' USING ERRCODE = '22023';
    END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    RETURN v_ext;
END $$;

-- ---------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------
-- p_student_id NULL = the caller's own student record. p_activity_id NULL = create. Returns the activity id.
CREATE FUNCTION public.student_activity_save(p_activity_id bigint, p_student_id bigint, p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_student bigint; v_act student_activity%ROWTYPE; v_actor text; v_id bigint; v_enrol record;
    v_type integer := NULLIF(p ->> 'student_activity_type_id', '')::integer;
    v_title text := NULLIF(btrim(p ->> 'activity_title'), '');
    v_start date := NULLIF(p ->> 'start_date', '')::date; v_end date := NULLIF(p ->> 'end_date', '')::date;
    v_ach text := COALESCE(NULLIF(p ->> 'achievement_type', ''), 'PARTICIPATION'); v_rank integer := NULLIF(p ->> 'position_rank', '')::integer;
    v_url text := NULLIF(btrim(p ->> 'activity_url'), '');
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'p must be an object' USING ERRCODE = '22023'; END IF;
    IF p_activity_id IS NOT NULL THEN
        SELECT * INTO v_act FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
        IF v_act.student_activity_id IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.UPDATE) or unknown activity' USING ERRCODE = '42501'; END IF;
        v_student := v_act.student_id;
        v_actor := sims_private.activity_actor(v_student, 'STUDENT.STUDENT_ACTIVITY.UPDATE');
    ELSE
        v_student := COALESCE(p_student_id, sims_private.current_student_id());
        v_actor := CASE WHEN v_student IS NULL THEN NULL ELSE sims_private.activity_actor(v_student, 'STUDENT.STUDENT_ACTIVITY.CREATE') END;
    END IF;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.CREATE / UPDATE) or unknown activity' USING ERRCODE = '42501'; END IF;
    IF p_activity_id IS NOT NULL AND v_act.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft activity can be edited' USING ERRCODE = '45000'; END IF;
    IF v_title IS NULL OR length(v_title) > 500 THEN RAISE EXCEPTION 'The title is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM student_activity_type WHERE student_activity_type_id = v_type AND is_active) THEN RAISE EXCEPTION 'Choose an active activity type' USING ERRCODE = '22023'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = '22023'; END IF;
    IF v_ach NOT IN ('PARTICIPATION','WINNER','RUNNER_UP','FIRST_PLACE','SECOND_PLACE','THIRD_PLACE','MERIT','SPECIAL_MENTION','QUALIFIED','FINALIST','MEDAL_GOLD','MEDAL_SILVER','MEDAL_BRONZE','RECOGNITION','OTHER') THEN
        RAISE EXCEPTION 'Invalid achievement type' USING ERRCODE = '22023';
    END IF;
    IF v_rank IS NOT NULL AND v_rank <= 0 THEN RAISE EXCEPTION 'The rank must be positive' USING ERRCODE = '22023'; END IF;
    IF v_url IS NOT NULL AND v_url !~* '^https?://[^\s]+$' THEN RAISE EXCEPTION 'The link must start with http:// or https://' USING ERRCODE = '22023'; END IF;
    IF NULLIF(p ->> 'academic_year_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_year WHERE academic_year_id = (p ->> 'academic_year_id')::integer) THEN RAISE EXCEPTION 'Unknown academic year' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p ->> 'description', '')) > 5000 OR length(COALESCE(p ->> 'outcomes', '')) > 5000 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;

    SELECT p2.programme_id, d.department_id, c.campus_id, c.institution_id INTO v_enrol
    FROM student_programme_enrolment e JOIN programme p2 ON p2.programme_id = e.programme_id JOIN department d ON d.department_id = p2.department_id JOIN campus c ON c.campus_id = d.campus_id
    WHERE e.student_id = v_student ORDER BY e.enrolment_id DESC LIMIT 1;
    IF v_enrol.programme_id IS NULL THEN RAISE EXCEPTION 'The student has no programme enrolment' USING ERRCODE = '22023'; END IF;

    IF p_activity_id IS NULL THEN
        INSERT INTO student_activity (student_id, student_activity_type_id, academic_year_id, institution_id, campus_id, department_id, programme_id, participation_level_id, event_mode_id, organizer_name,
            activity_title, event_name, team_name, participation_role, start_date, end_date, venue_name, city, achievement_type, position_rank, award_name, activity_url, description, outcomes,
            verification_status_id, approval_status_id, created_by_user_id)
        VALUES (v_student, v_type, NULLIF(p ->> 'academic_year_id', '')::integer, v_enrol.institution_id, v_enrol.campus_id, v_enrol.department_id, v_enrol.programme_id,
            NULLIF(p ->> 'participation_level_id', '')::integer, NULLIF(p ->> 'event_mode_id', '')::integer, NULLIF(btrim(p ->> 'organizer_name'), ''),
            v_title, NULLIF(btrim(p ->> 'event_name'), ''), NULLIF(btrim(p ->> 'team_name'), ''), NULLIF(btrim(p ->> 'participation_role'), ''), v_start, v_end, NULLIF(btrim(p ->> 'venue_name'), ''),
            NULLIF(btrim(p ->> 'city'), ''), v_ach, v_rank, NULLIF(btrim(p ->> 'award_name'), ''), v_url, NULLIF(btrim(p ->> 'description'), ''), NULLIF(btrim(p ->> 'outcomes'), ''),
            sims_private.vstatus('NOT_SUBMITTED'), sims_private.astatus('DRAFT'), sims_private.current_user_id())
        RETURNING student_activity_id INTO v_id;
        RETURN v_id;
    END IF;
    UPDATE student_activity SET student_activity_type_id = v_type, academic_year_id = NULLIF(p ->> 'academic_year_id', '')::integer, participation_level_id = NULLIF(p ->> 'participation_level_id', '')::integer,
        event_mode_id = NULLIF(p ->> 'event_mode_id', '')::integer, organizer_name = NULLIF(btrim(p ->> 'organizer_name'), ''), activity_title = v_title, event_name = NULLIF(btrim(p ->> 'event_name'), ''),
        team_name = NULLIF(btrim(p ->> 'team_name'), ''), participation_role = NULLIF(btrim(p ->> 'participation_role'), ''), start_date = v_start, end_date = v_end, venue_name = NULLIF(btrim(p ->> 'venue_name'), ''),
        city = NULLIF(btrim(p ->> 'city'), ''), achievement_type = v_ach, position_rank = v_rank, award_name = NULLIF(btrim(p ->> 'award_name'), ''), activity_url = v_url,
        description = NULLIF(btrim(p ->> 'description'), ''), outcomes = NULLIF(btrim(p ->> 'outcomes'), ''), updated_by_user_id = sims_private.current_user_id(), updated_at = now()
    WHERE student_activity_id = p_activity_id;
    RETURN p_activity_id;
END $$;

CREATE FUNCTION public.student_activity_submit(p_activity_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; t record; r record; v_count integer;
BEGIN
    SELECT * INTO a FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.UPDATE) or unknown activity' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id = sims_private.astatus('SUBMITTED') THEN RETURN; END IF; -- idempotent replay
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft activity can be submitted' USING ERRCODE = '45000'; END IF;
    SELECT * INTO t FROM student_activity_type WHERE student_activity_type_id = a.student_activity_type_id;
    IF a.start_date IS NULL THEN RAISE EXCEPTION 'The start date is required before submitting' USING ERRCODE = '45000'; END IF;
    IF t.requires_team_details AND a.team_name IS NULL THEN RAISE EXCEPTION 'The team name is required for this type of activity' USING ERRCODE = '45000'; END IF;
    FOR r IN SELECT q.evidence_type_id, q.minimum_files, e.evidence_type_name FROM student_activity_evidence_requirement q JOIN evidence_type e ON e.evidence_type_id = q.evidence_type_id
             WHERE q.student_activity_type_id = a.student_activity_type_id AND q.is_active AND q.is_mandatory AND (q.valid_from IS NULL OR q.valid_from <= CURRENT_DATE) AND (q.valid_to IS NULL OR q.valid_to >= CURRENT_DATE) LOOP
        SELECT count(*) INTO v_count FROM student_activity_evidence ev WHERE ev.student_activity_id = p_activity_id AND ev.evidence_type_id = r.evidence_type_id AND ev.is_active AND ev.deleted_at IS NULL;
        IF v_count < GREATEST(r.minimum_files, 1) THEN RAISE EXCEPTION 'Evidence required: %', r.evidence_type_name USING ERRCODE = '45000'; END IF;
    END LOOP;
    UPDATE student_activity SET approval_status_id = sims_private.astatus('SUBMITTED'), verification_status_id = sims_private.vstatus('PENDING'), rejection_reason = NULL, updated_at = now() WHERE student_activity_id = p_activity_id;
END $$;

-- p_step VERIFY: p_decision VERIFIED | NEEDS_CORRECTION | REJECTED.  p_step APPROVE: p_decision APPROVED | REJECTED.
CREATE FUNCTION public.student_activity_review(p_activity_id bigint, p_step text, p_decision text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_remarks text := NULLIF(btrim(p_remarks), ''); v_perm text;
BEGIN
    IF p_step NOT IN ('VERIFY', 'APPROVE') THEN RAISE EXCEPTION 'The step must be VERIFY or APPROVE' USING ERRCODE = '22023'; END IF;
    v_perm := 'STUDENT.STUDENT_ACTIVITY.' || p_step;
    SELECT * INTO a FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR NOT sims_private.can_student(ARRAY[v_perm]::text[], a.student_id, true) THEN RAISE EXCEPTION 'Not authorised (%) or unknown activity', v_perm USING ERRCODE = '42501'; END IF;
    IF length(COALESCE(v_remarks, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    IF p_step = 'VERIFY' THEN
        IF p_decision NOT IN ('VERIFIED', 'NEEDS_CORRECTION', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be VERIFIED, NEEDS_CORRECTION or REJECTED' USING ERRCODE = '22023'; END IF;
        IF p_decision <> 'VERIFIED' AND v_remarks IS NULL THEN RAISE EXCEPTION 'Remarks are required unless the activity is verified' USING ERRCODE = '22023'; END IF;
        IF a.verification_status_id = sims_private.vstatus(p_decision) THEN RETURN; END IF; -- idempotent replay
        IF a.approval_status_id <> sims_private.astatus('SUBMITTED') OR a.verification_status_id <> sims_private.vstatus('PENDING') THEN RAISE EXCEPTION 'Only a submitted activity awaiting verification can be verified' USING ERRCODE = '45000'; END IF;
        UPDATE student_activity SET verification_status_id = sims_private.vstatus(p_decision), verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_remarks,
            approval_status_id = CASE p_decision WHEN 'VERIFIED' THEN sims_private.astatus('UNDER_REVIEW') WHEN 'NEEDS_CORRECTION' THEN sims_private.astatus('DRAFT') ELSE sims_private.astatus('REJECTED') END,
            rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN v_remarks END, updated_at = now() WHERE student_activity_id = p_activity_id;
    ELSE
        IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be APPROVED or REJECTED' USING ERRCODE = '22023'; END IF;
        IF p_decision = 'REJECTED' AND v_remarks IS NULL THEN RAISE EXCEPTION 'Remarks are required to reject an activity' USING ERRCODE = '22023'; END IF;
        IF a.approval_status_id = sims_private.astatus(p_decision) THEN RETURN; END IF; -- idempotent replay
        IF a.approval_status_id <> sims_private.astatus('UNDER_REVIEW') OR a.verification_status_id <> sims_private.vstatus('VERIFIED') THEN RAISE EXCEPTION 'Only a verified activity under review can be approved or rejected' USING ERRCODE = '45000'; END IF;
        UPDATE student_activity SET approval_status_id = sims_private.astatus(p_decision), approved_by_user_id = sims_private.current_user_id(), approved_at = now(), approval_remarks = v_remarks,
            rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN v_remarks END, updated_at = now() WHERE student_activity_id = p_activity_id;
    END IF;
END $$;

CREATE FUNCTION public.student_activity_delete(p_activity_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
    SELECT * INTO a FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR (sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.DELETE') IS NULL) THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.DELETE) or unknown activity' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id NOT IN (sims_private.astatus('DRAFT'), sims_private.astatus('REJECTED')) THEN RAISE EXCEPTION 'Only a draft or rejected activity can be deleted' USING ERRCODE = '45000'; END IF;
    IF length(COALESCE(v_reason, '')) > 1000 THEN RAISE EXCEPTION 'The reason is limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    UPDATE student_activity SET deleted_at = now(), deleted_by_user_id = sims_private.current_user_id(), deletion_reason = v_reason WHERE student_activity_id = p_activity_id;
END $$;

-- ---------------------------------------------------------------
-- Team members
-- ---------------------------------------------------------------
CREATE FUNCTION public.student_activity_team_add(p_activity_id bigint, p_student_id bigint, p_external_name text, p_external_email text, p_role text, p_is_lead boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_id bigint; v_name text := NULLIF(btrim(p_external_name), '');
BEGIN
    SELECT * INTO a FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.UPDATE) or unknown activity' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft activity can be changed' USING ERRCODE = '45000'; END IF;
    IF (p_student_id IS NULL) = (v_name IS NULL) THEN RAISE EXCEPTION 'Give either a student or an external member name' USING ERRCODE = '22023'; END IF;
    IF p_student_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM student WHERE student_id = p_student_id) THEN RAISE EXCEPTION 'Unknown student' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_name, '')) > 250 OR length(COALESCE(p_external_email, '')) > 254 OR length(COALESCE(p_role, '')) > 150 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    IF p_student_id IS NOT NULL AND EXISTS (SELECT 1 FROM student_activity_team_member WHERE student_activity_id = p_activity_id AND student_id = p_student_id) THEN RAISE EXCEPTION 'That student is already a team member' USING ERRCODE = '23505'; END IF;
    INSERT INTO student_activity_team_member (student_activity_id, student_id, external_member_name, external_member_email, member_role, is_team_lead, member_sequence)
    VALUES (p_activity_id, p_student_id, v_name, NULLIF(btrim(p_external_email), ''), NULLIF(btrim(p_role), ''), COALESCE(p_is_lead, false),
            (SELECT COALESCE(max(member_sequence), 0) + 1 FROM student_activity_team_member WHERE student_activity_id = p_activity_id)) RETURNING student_activity_team_member_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.student_activity_team_remove(p_member_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; m record;
BEGIN
    SELECT * INTO m FROM student_activity_team_member WHERE student_activity_team_member_id = p_member_id;
    SELECT * INTO a FROM student_activity WHERE student_activity_id = m.student_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.UPDATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.UPDATE) or unknown member' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Only a draft activity can be changed' USING ERRCODE = '45000'; END IF;
    DELETE FROM student_activity_team_member WHERE student_activity_team_member_id = p_member_id;
END $$;

-- ---------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------
-- Adds an evidence item (version 1) for an uploaded object. Returns the evidence id.
CREATE FUNCTION public.student_activity_evidence_add(p_activity_id bigint, p_document_type_id integer, p_evidence_type_id integer, p_title text, p_issue_date date, p_issuing_authority text, p_certificate_number text,
                                                     p_storage_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_ext text; v_file bigint; v_ev bigint; v_title text := NULLIF(btrim(p_title), '');
BEGIN
    SELECT * INTO a FROM student_activity WHERE student_activity_id = p_activity_id AND deleted_at IS NULL FOR UPDATE;
    IF a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY_EVIDENCE.CREATE') IS NULL THEN RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY_EVIDENCE.CREATE) or unknown activity' USING ERRCODE = '42501'; END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be added to a draft activity' USING ERRCODE = '45000'; END IF;
    IF v_title IS NULL OR length(v_title) > 500 THEN RAISE EXCEPTION 'The title is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM document_type WHERE document_type_id = p_document_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active document type' USING ERRCODE = '22023'; END IF;
    IF p_evidence_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence_type WHERE evidence_type_id = p_evidence_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active evidence type' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_issuing_authority, '')) > 300 OR length(COALESCE(p_certificate_number, '')) > 150 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    v_ext := sims_private.check_student_upload(a.student_id, p_storage_key, p_file_name, p_mime, p_size, p_checksum);
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    INSERT INTO student_activity_evidence (student_activity_id, document_type_id, evidence_type_id, confidentiality_level_id, document_title, document_issue_date, issuing_authority, certificate_document_number,
        verification_status_id, approval_status_id, created_by_user_id)
    VALUES (p_activity_id, p_document_type_id, p_evidence_type_id, (SELECT confidentiality_level_id FROM confidentiality_level WHERE level_code = 'CONFIDENTIAL'), v_title, p_issue_date, NULLIF(btrim(p_issuing_authority), ''),
        NULLIF(btrim(p_certificate_number), ''), sims_private.vstatus('PENDING'), sims_private.astatus('DRAFT'), sims_private.current_user_id()) RETURNING student_activity_evidence_id INTO v_ev;
    INSERT INTO student_activity_evidence_version (student_activity_evidence_id, version_number, file_object_id, uploaded_by_user_id) VALUES (v_ev, 1, v_file, sims_private.current_user_id());
    INSERT INTO student_activity_evidence_audit (student_activity_evidence_id, action_code, performed_by_user_id, after_values) VALUES (v_ev, 'UPLOAD', sims_private.current_user_id(), jsonb_build_object('file_name', btrim(p_file_name), 'version', 1));
    RETURN v_ev;
END $$;

CREATE FUNCTION public.student_activity_evidence_replace(p_evidence_id bigint, p_reason text, p_storage_key text, p_file_name text, p_mime text, p_size bigint, p_checksum text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev record; a record; v_ext text; v_file bigint; v_ver integer;
BEGIN
    SELECT * INTO ev FROM student_activity_evidence WHERE student_activity_evidence_id = p_evidence_id AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO a FROM student_activity WHERE student_activity_id = ev.student_activity_id AND deleted_at IS NULL;
    IF ev.student_activity_evidence_id IS NULL OR a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY_EVIDENCE.UPDATE') IS NULL THEN
        RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY_EVIDENCE.UPDATE) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be replaced on a draft activity' USING ERRCODE = '45000'; END IF;
    IF length(COALESCE(p_reason, '')) > 1000 THEN RAISE EXCEPTION 'The reason is limited to 1000 characters' USING ERRCODE = '22023'; END IF;
    v_ext := sims_private.check_student_upload(a.student_id, p_storage_key, p_file_name, p_mime, p_size, p_checksum);
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    v_ver := ev.current_version_number + 1;
    UPDATE student_activity_evidence_version SET is_current = false WHERE student_activity_evidence_id = p_evidence_id AND is_current;
    INSERT INTO student_activity_evidence_version (student_activity_evidence_id, version_number, file_object_id, change_reason, uploaded_by_user_id) VALUES (p_evidence_id, v_ver, v_file, NULLIF(btrim(p_reason), ''), sims_private.current_user_id());
    UPDATE student_activity_evidence SET current_version_number = v_ver, updated_by_user_id = sims_private.current_user_id(), updated_at = now() WHERE student_activity_evidence_id = p_evidence_id;
    INSERT INTO student_activity_evidence_audit (student_activity_evidence_id, action_code, performed_by_user_id, before_values, after_values, remarks)
    VALUES (p_evidence_id, 'REPLACE', sims_private.current_user_id(), jsonb_build_object('version', ev.current_version_number), jsonb_build_object('version', v_ver, 'file_name', btrim(p_file_name)), NULLIF(btrim(p_reason), ''));
    RETURN v_ver;
END $$;

CREATE FUNCTION public.student_activity_evidence_download_info(p_evidence_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT a.student_id, f.storage_key, f.original_file_name, f.mime_type, v.student_activity_evidence_version_id INTO d
    FROM student_activity_evidence ev JOIN student_activity a ON a.student_activity_id = ev.student_activity_id
    JOIN student_activity_evidence_version v ON v.student_activity_evidence_id = ev.student_activity_evidence_id AND v.is_current JOIN file_object f ON f.file_object_id = v.file_object_id
    WHERE ev.student_activity_evidence_id = p_evidence_id AND ev.deleted_at IS NULL AND a.deleted_at IS NULL;
    IF d.student_id IS NULL OR NOT (COALESCE(d.student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY_EVIDENCE.READ']::text[], d.student_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY_EVIDENCE.READ) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    INSERT INTO student_activity_evidence_audit (student_activity_evidence_id, student_activity_evidence_version_id, action_code, performed_by_user_id) VALUES (p_evidence_id, d.student_activity_evidence_version_id, 'DOWNLOAD', sims_private.current_user_id());
    RETURN jsonb_build_object('storage_key', d.storage_key, 'file_name', d.original_file_name, 'mime_type', d.mime_type);
END $$;

CREATE FUNCTION public.student_activity_evidence_delete(p_evidence_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev record; a record;
BEGIN
    SELECT * INTO ev FROM student_activity_evidence WHERE student_activity_evidence_id = p_evidence_id AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO a FROM student_activity WHERE student_activity_id = ev.student_activity_id AND deleted_at IS NULL;
    IF ev.student_activity_evidence_id IS NULL OR a.student_activity_id IS NULL OR sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY_EVIDENCE.DELETE') IS NULL THEN
        RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY_EVIDENCE.DELETE) or unknown evidence' USING ERRCODE = '42501';
    END IF;
    IF a.approval_status_id <> sims_private.astatus('DRAFT') THEN RAISE EXCEPTION 'Evidence can only be removed from a draft activity' USING ERRCODE = '45000'; END IF;
    UPDATE student_activity_evidence SET deleted_at = now(), deleted_by_user_id = sims_private.current_user_id(), deletion_reason = NULLIF(btrim(p_reason), ''), is_active = false WHERE student_activity_evidence_id = p_evidence_id;
    INSERT INTO student_activity_evidence_audit (student_activity_evidence_id, action_code, performed_by_user_id, remarks) VALUES (p_evidence_id, 'SOFT_DELETE', sims_private.current_user_id(), NULLIF(btrim(p_reason), ''));
END $$;

-- ---------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------
-- Own activities plus every activity the caller may read; p_student_id narrows to one student.
CREATE FUNCTION public.student_activity_list(p_student_id bigint DEFAULT NULL, p_search text DEFAULT NULL, p_approval text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (student_activity_id bigint, student_id bigint, student_number text, student_name text, type_name text, activity_title text, achievement_type text, start_date date, verification_status text, approval_status text, evidence_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH v AS (
        SELECT a.student_activity_id, a.student_id, s.student_number::text, s.display_name::text AS student_name, t.type_name::text, a.activity_title::text, a.achievement_type::text, a.start_date,
               vs.status_code::text AS verification_status, aps.status_code::text AS approval_status, a.created_at,
               (SELECT count(*) FROM student_activity_evidence ev WHERE ev.student_activity_id = a.student_activity_id AND ev.deleted_at IS NULL) AS evidence_count
        FROM student_activity a JOIN student s ON s.student_id = a.student_id JOIN student_activity_type t ON t.student_activity_type_id = a.student_activity_type_id
        JOIN verification_status vs ON vs.verification_status_id = a.verification_status_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
        WHERE a.deleted_at IS NULL AND (p_student_id IS NULL OR a.student_id = p_student_id)
          AND (COALESCE(a.student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.READ']::text[], a.student_id, false))
    )
    SELECT v.student_activity_id::bigint, v.student_id::bigint, v.student_number, v.student_name, v.type_name, v.activity_title, v.achievement_type, v.start_date, v.verification_status, v.approval_status, v.evidence_count, count(*) OVER ()
    FROM v
    WHERE true
      AND (p_approval IS NULL OR v.approval_status = p_approval)
      AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(v.activity_title || ' ' || v.student_name || ' ' || v.student_number)) > 0)
    ORDER BY v.created_at DESC, v.student_activity_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.student_activity_get(p_activity_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_owner boolean; v_draft boolean;
BEGIN
    SELECT x.*, t.type_name, t.requires_team_details, s.student_number AS snum, s.display_name AS sname, vs.status_code AS vcode, aps.status_code AS acode INTO a
    FROM student_activity x JOIN student_activity_type t ON t.student_activity_type_id = x.student_activity_type_id JOIN student s ON s.student_id = x.student_id
    JOIN verification_status vs ON vs.verification_status_id = x.verification_status_id JOIN approval_status aps ON aps.approval_status_id = x.approval_status_id
    WHERE x.student_activity_id = p_activity_id AND x.deleted_at IS NULL;
    v_owner := COALESCE(a.student_id = sims_private.current_student_id(), false);
    IF a.student_activity_id IS NULL OR NOT (v_owner OR sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.READ']::text[], a.student_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (STUDENT.STUDENT_ACTIVITY.READ) or unknown activity' USING ERRCODE = '42501';
    END IF;
    v_draft := a.acode = 'DRAFT';
    RETURN jsonb_build_object('student_activity_id', a.student_activity_id, 'student_id', a.student_id, 'student_number', a.snum, 'student_name', a.sname, 'student_activity_type_id', a.student_activity_type_id, 'type_name', a.type_name,
        'requires_team_details', a.requires_team_details, 'academic_year_id', a.academic_year_id, 'participation_level_id', a.participation_level_id, 'event_mode_id', a.event_mode_id, 'organizer_name', a.organizer_name,
        'activity_title', a.activity_title, 'event_name', a.event_name, 'team_name', a.team_name, 'participation_role', a.participation_role, 'start_date', a.start_date, 'end_date', a.end_date, 'venue_name', a.venue_name,
        'city', a.city, 'achievement_type', a.achievement_type, 'position_rank', a.position_rank, 'award_name', a.award_name, 'activity_url', a.activity_url, 'description', a.description, 'outcomes', a.outcomes,
        'verification_status', a.vcode, 'verification_remarks', a.verification_remarks, 'approval_status', a.acode, 'approval_remarks', a.approval_remarks, 'rejection_reason', a.rejection_reason,
        'is_owner', v_owner,
        'can_edit', v_draft AND sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.UPDATE') IS NOT NULL,
        'can_delete', a.acode IN ('DRAFT', 'REJECTED') AND sims_private.activity_actor(a.student_id, 'STUDENT.STUDENT_ACTIVITY.DELETE') IS NOT NULL,
        'can_verify', a.acode = 'SUBMITTED' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.VERIFY']::text[], a.student_id, true),
        'can_approve', a.acode = 'UNDER_REVIEW' AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY.APPROVE']::text[], a.student_id, true),
        'team', COALESCE((SELECT jsonb_agg(jsonb_build_object('member_id', m.student_activity_team_member_id, 'name', COALESCE(ms.display_name, m.external_member_name), 'is_student', m.student_id IS NOT NULL, 'role', m.member_role, 'is_lead', m.is_team_lead) ORDER BY m.member_sequence, m.student_activity_team_member_id)
                          FROM student_activity_team_member m LEFT JOIN student ms ON ms.student_id = m.student_id WHERE m.student_activity_id = a.student_activity_id), '[]'::jsonb),
        'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object('evidence_id', ev.student_activity_evidence_id, 'title', ev.document_title, 'evidence_type', et.evidence_type_name, 'version', ev.current_version_number,
                                'file_name', f.original_file_name, 'size', f.file_size_bytes, 'issued', ev.document_issue_date, 'authority', ev.issuing_authority, 'certificate_number', ev.certificate_document_number) ORDER BY ev.student_activity_evidence_id)
                          FROM student_activity_evidence ev LEFT JOIN evidence_type et ON et.evidence_type_id = ev.evidence_type_id
                          JOIN student_activity_evidence_version v ON v.student_activity_evidence_id = ev.student_activity_evidence_id AND v.is_current JOIN file_object f ON f.file_object_id = v.file_object_id
                          WHERE ev.student_activity_id = a.student_activity_id AND ev.deleted_at IS NULL), '[]'::jsonb));
END $$;

-- Counts per activity type and approval status for staff (scope-filtered by the same read permission).
CREATE FUNCTION public.student_activity_report(p_year integer DEFAULT NULL)
RETURNS TABLE (type_name text, approval_status text, activities bigint, winners bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT t.type_name::text, aps.status_code::text, count(*), count(*) FILTER (WHERE a.achievement_type NOT IN ('PARTICIPATION', 'OTHER'))
    FROM student_activity a JOIN student_activity_type t ON t.student_activity_type_id = a.student_activity_type_id JOIN approval_status aps ON aps.approval_status_id = a.approval_status_id
    WHERE a.deleted_at IS NULL AND (p_year IS NULL OR a.academic_year_id = p_year) AND sims_private.can_student(ARRAY['STUDENT.STUDENT_ACTIVITY_REPORT.READ']::text[], a.student_id, false)
    GROUP BY t.type_name, aps.status_code ORDER BY t.type_name, aps.status_code
$$;

REVOKE ALL ON FUNCTION sims_private.vstatus(text), sims_private.astatus(text), sims_private.activity_actor(bigint, text), sims_private.check_student_upload(bigint, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_activity_save(bigint, bigint, jsonb), public.student_activity_submit(bigint), public.student_activity_review(bigint, text, text, text), public.student_activity_delete(bigint, text),
    public.student_activity_team_add(bigint, bigint, text, text, text, boolean), public.student_activity_team_remove(bigint),
    public.student_activity_evidence_add(bigint, integer, integer, text, date, text, text, text, text, text, bigint, text), public.student_activity_evidence_replace(bigint, text, text, text, text, bigint, text),
    public.student_activity_evidence_download_info(bigint), public.student_activity_evidence_delete(bigint, text), public.student_activity_list(bigint, text, text, integer, integer),
    public.student_activity_get(bigint), public.student_activity_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_activity_save(bigint, bigint, jsonb), public.student_activity_submit(bigint), public.student_activity_review(bigint, text, text, text), public.student_activity_delete(bigint, text),
    public.student_activity_team_add(bigint, bigint, text, text, text, boolean), public.student_activity_team_remove(bigint),
    public.student_activity_evidence_add(bigint, integer, integer, text, date, text, text, text, text, text, bigint, text), public.student_activity_evidence_replace(bigint, text, text, text, text, bigint, text),
    public.student_activity_evidence_download_info(bigint), public.student_activity_evidence_delete(bigint, text), public.student_activity_list(bigint, text, text, integer, integer),
    public.student_activity_get(bigint), public.student_activity_report(integer) TO authenticated;
