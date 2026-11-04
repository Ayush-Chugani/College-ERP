-- Certificate requests (KI-53). Hand-written (not from the MySQL source).
--
-- FLOW (my inferences, KI-69): the student (or staff with DOCUMENT.ALL.CREATE on their behalf) requests a certificate of an active type with a purpose (at most 5 open requests); staff with
-- DOCUMENT.ALL.APPROVE approve or reject (reject needs a reason); staff with DOCUMENT.ALL.CREATE issue an approved request by uploading the signed PDF under student/<id>/ (the existing
-- storage policies apply) and giving the certificate number; the student downloads it from their requests (logged). A student can cancel a request that is still SUBMITTED. Numbers: CR-<year>-<6 digits>.
-- The UNDER_REVIEW status of the source is not used. Certificate types are reference data (DOCUMENT.ALL.CONFIGURE); a few common ones are seeded below.

INSERT INTO certificate_type (certificate_code, certificate_name) VALUES
    ('BONAFIDE', 'Bonafide certificate'), ('CHARACTER', 'Character certificate'), ('NO_DUES', 'No-dues certificate'), ('MIGRATION', 'Migration certificate'), ('STUDY', 'Study certificate')
ON CONFLICT DO NOTHING;

CREATE SEQUENCE sims_private.certificate_request_seq;

-- never NULL: "is this student the caller?" (a plain comparison is NULL for callers without a student record, which would turn NOT (...) checks into passes)
CREATE FUNCTION sims_private.is_me_student(p_student bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT COALESCE(p_student = sims_private.current_student_id(), false) $$;
REVOKE ALL ON FUNCTION sims_private.is_me_student(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.is_me_student(bigint) TO authenticated;

CREATE FUNCTION public.cert_request_create(p_type_id integer, p_purpose text, p_student_id bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint := COALESCE(p_student_id, sims_private.current_student_id()); v_id bigint;
BEGIN
    IF v_student IS NULL OR NOT (sims_private.is_me_student(v_student) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.CREATE']::text[], v_student, true)) THEN
        RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.CREATE)' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM certificate_type WHERE certificate_type_id = p_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active certificate type' USING ERRCODE = '22023'; END IF;
    IF p_purpose IS NULL OR length(btrim(p_purpose)) < 3 OR length(p_purpose) > 500 THEN RAISE EXCEPTION 'State the purpose (3 to 500 characters)' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM certificate_request WHERE student_id = v_student AND request_status IN ('SUBMITTED', 'APPROVED')) >= 5 THEN RAISE EXCEPTION 'There are already 5 open requests' USING ERRCODE = '45000'; END IF;
    INSERT INTO certificate_request (request_number, student_id, certificate_type_id, purpose, request_status)
    VALUES ('CR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.certificate_request_seq')::text, 6, '0'), v_student, p_type_id, btrim(p_purpose), 'SUBMITTED') RETURNING certificate_request_id INTO v_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'CERT_REQUESTED', 'certificate_request', v_id::text, jsonb_build_object('student_id', v_student));
    RETURN v_id;
END $$;

CREATE FUNCTION public.cert_request_list(p_student_id bigint DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS TABLE (certificate_request_id bigint, request_number text, student_id bigint, student_number text, student_name text, certificate_name text, purpose text, request_status text, requested_at timestamptz,
               issued_at timestamptz, certificate_number text, has_file boolean, can_approve boolean, can_issue boolean, can_cancel boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.certificate_request_id::bigint, r.request_number::text, r.student_id::bigint, s.student_number::text, s.display_name::text, t.certificate_name::text, r.purpose::text, r.request_status::text, r.requested_at, r.issued_at,
           r.certificate_number::text, r.file_object_id IS NOT NULL,
           r.request_status = 'SUBMITTED' AND sims_private.can_student(ARRAY['DOCUMENT.ALL.APPROVE']::text[], r.student_id, true),
           r.request_status = 'APPROVED' AND sims_private.can_student(ARRAY['DOCUMENT.ALL.CREATE']::text[], r.student_id, true),
           r.request_status = 'SUBMITTED' AND (sims_private.is_me_student(r.student_id) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.UPDATE']::text[], r.student_id, true))
    FROM certificate_request r JOIN student s ON s.student_id = r.student_id JOIN certificate_type t ON t.certificate_type_id = r.certificate_type_id
    WHERE (p_student_id IS NULL OR r.student_id = p_student_id) AND (p_status IS NULL OR r.request_status = p_status)
      AND (sims_private.is_me_student(r.student_id) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.READ']::text[], r.student_id, false))
    ORDER BY r.requested_at DESC, r.certificate_request_id DESC LIMIT 200
$$;

CREATE FUNCTION public.cert_request_decide(p_id bigint, p_approve boolean, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT certificate_request_id, student_id, request_status INTO r FROM certificate_request WHERE certificate_request_id = p_id FOR UPDATE;
    IF r.certificate_request_id IS NULL OR NOT sims_private.can_student(ARRAY['DOCUMENT.ALL.APPROVE']::text[], r.student_id, true) THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.APPROVE) or unknown request' USING ERRCODE = '42501'; END IF;
    IF r.request_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted request can be decided (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    IF NOT p_approve AND (p_remarks IS NULL OR btrim(p_remarks) = '') THEN RAISE EXCEPTION 'A reason is required to reject' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_remarks, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    UPDATE certificate_request SET request_status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END WHERE certificate_request_id = p_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details)
    VALUES (sims_private.current_user_id(), 'DOCUMENT', CASE WHEN p_approve THEN 'CERT_APPROVED' ELSE 'CERT_REJECTED' END, 'certificate_request', p_id::text, jsonb_build_object('remarks', p_remarks));
END $$;

CREATE FUNCTION public.cert_request_cancel(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT certificate_request_id, student_id, request_status INTO r FROM certificate_request WHERE certificate_request_id = p_id FOR UPDATE;
    IF r.certificate_request_id IS NULL OR NOT (sims_private.is_me_student(r.student_id) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.UPDATE']::text[], r.student_id, true)) THEN
        RAISE EXCEPTION 'Not authorised or unknown request' USING ERRCODE = '42501';
    END IF;
    IF r.request_status = 'CANCELLED' THEN RETURN; END IF;
    IF r.request_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only a submitted request can be cancelled (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    UPDATE certificate_request SET request_status = 'CANCELLED' WHERE certificate_request_id = p_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'CERT_CANCELLED', 'certificate_request', p_id::text, '{}'::jsonb);
END $$;

CREATE FUNCTION public.cert_request_issue(p_id bigint, p_certificate_number text, p_storage_key text, p_file_name text, p_size bigint, p_checksum text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_file bigint; v_meta jsonb; v_num text := NULLIF(btrim(p_certificate_number), '');
BEGIN
    SELECT certificate_request_id, student_id, request_status INTO r FROM certificate_request WHERE certificate_request_id = p_id FOR UPDATE;
    IF r.certificate_request_id IS NULL OR NOT sims_private.can_student(ARRAY['DOCUMENT.ALL.CREATE']::text[], r.student_id, true) THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.CREATE) or unknown request' USING ERRCODE = '42501'; END IF;
    IF r.request_status <> 'APPROVED' THEN RAISE EXCEPTION 'Only an approved request can be issued (status %)', r.request_status USING ERRCODE = '45000'; END IF;
    IF v_num IS NULL OR length(v_num) > 50 THEN RAISE EXCEPTION 'The certificate number is required (at most 50 characters)' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM certificate_request WHERE certificate_number = v_num) THEN RAISE EXCEPTION 'That certificate number is already used' USING ERRCODE = '23505'; END IF;
    IF sims_private.doc_student_id(p_storage_key) IS DISTINCT FROM r.student_id THEN RAISE EXCEPTION 'The file is not stored under this student' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR lower(p_file_name) !~ '\.pdf$' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The issued certificate must be a PDF file' USING ERRCODE = '22023'; END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_storage_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_storage_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), 'application/pdf', p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), 'pdf', 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    UPDATE certificate_request SET request_status = 'ISSUED', issued_at = now(), certificate_number = v_num, file_object_id = v_file WHERE certificate_request_id = p_id;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'CERT_ISSUED', 'certificate_request', p_id::text, jsonb_build_object('certificate_number', v_num));
END $$;

CREATE FUNCTION public.cert_request_download_info(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT c.certificate_request_id, c.student_id, c.request_status, f.storage_key, f.original_file_name INTO r FROM certificate_request c JOIN file_object f ON f.file_object_id = c.file_object_id WHERE c.certificate_request_id = p_id;
    IF r.certificate_request_id IS NULL OR r.request_status <> 'ISSUED' OR NOT (sims_private.is_me_student(r.student_id) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.READ']::text[], r.student_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.READ) or no issued certificate' USING ERRCODE = '42501';
    END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details) VALUES (sims_private.current_user_id(), 'DOCUMENT', 'DOWNLOAD', 'certificate_request', p_id::text, jsonb_build_object('student_id', r.student_id));
    RETURN jsonb_build_object('storage_key', r.storage_key, 'file_name', r.original_file_name, 'mime_type', 'application/pdf');
END $$;

REVOKE ALL ON FUNCTION public.cert_request_create(integer, text, bigint), public.cert_request_list(bigint, text), public.cert_request_decide(bigint, boolean, text), public.cert_request_cancel(bigint),
    public.cert_request_issue(bigint, text, text, text, bigint, text), public.cert_request_download_info(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cert_request_create(integer, text, bigint), public.cert_request_list(bigint, text), public.cert_request_decide(bigint, boolean, text), public.cert_request_cancel(bigint),
    public.cert_request_issue(bigint, text, text, text, bigint, text), public.cert_request_download_info(bigint) TO authenticated;

-- certificate types join the reference-data administration
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
        ('certificate_type', 'DOCUMENT.ALL.CONFIGURE', 'DOCUMENT', 'Certificate types'), ('qualification_level', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Qualification levels'), ('education_institution', 'EMPLOYEE.ALL.CONFIGURE', 'EMPLOYEE', 'Education institutions'),
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
    SELECT ARRAY['blood_group', 'caste', 'country', 'gender', 'religion', 'social_category', 'state', 'sub_caste', 'document_type', 'certificate_type', 'publication_type', 'journal_type', 'indexing_agency', 'funding_type',
                 'award_category', 'membership_type', 'metric_type', 'journal_metric', 'qualification_level', 'education_institution', 'awarding_body', 'study_mode', 'previous_organization', 'staff_category', 'staff_type',
                 'designation', 'fee_category', 'financial_ledger_account', 'fee_type', 'late_fee_rule', 'late_fee_slab', 'concession_type', 'scholarship_scheme', 'installment_plan', 'payment_mode']
$$;
