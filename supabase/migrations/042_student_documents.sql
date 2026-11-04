-- Student documents on Supabase Storage. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * One PRIVATE bucket, 'sims-documents'. A student's files live under student/<student_id>/<random>-<name>. Nothing is public; downloads use short-lived signed URLs that the app
--    creates only after student_document_download_info() has authorised the caller (and logged the access).
--  * Storage policies mirror the database permissions: an object is readable / uploadable by the student it belongs to, or by DOCUMENT.ALL.READ / CREATE at that student's scope.
--    Clients can delete only objects that no file_object row refers to (orphans left by a failed registration or by student_document_delete()).
--  * Metadata is written by RPCs only: student_document_register (upload registered as PENDING), student_document_review (VERIFY / reject), student_document_delete.
--    Direct client writes to file_object are not possible (no insert policy) and student_document keeps its generated policies and the VERIFY guard.
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-53):
--  1  Allowed types PDF, JPEG, PNG; at most 10 MB; the name must end with the extension of the declared type.
--  2  A new upload is PENDING. Review: PENDING -> VERIFIED | REJECTED, nothing else; a rejected document is replaced by uploading a new one. Rejecting needs remarks.
--  3  Reviewing needs DOCUMENT.ALL.VERIFY at the student's scope. A student can delete their own PENDING or REJECTED documents; staff with DOCUMENT.ALL.DELETE can delete any that is not VERIFIED.
--  4  A VERIFIED document whose expiry date has passed is shown as EXPIRED (effective_status); the stored status is not rewritten.
--  5  Every signed-URL authorisation writes an activity_audit row (DOWNLOAD). Confidentiality is CONFIDENTIAL for all student documents.

DO $$
BEGIN
    IF to_regclass('storage.buckets') IS NOT NULL THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('sims-documents', 'sims-documents', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
        ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];
    END IF;
END $$;

CREATE TRIGGER trg_student_document_audit AFTER INSERT OR UPDATE OR DELETE ON student_document FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('DOCUMENT', 'student_document_id');
CREATE TRIGGER trg_file_object_audit AFTER INSERT OR UPDATE OR DELETE ON file_object FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('DOCUMENT', 'file_object_id');

-- 'student/<id>/<file>' -> id, otherwise NULL
CREATE FUNCTION sims_private.doc_student_id(p_name text) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN length(p_name) <= 400 AND p_name ~ '^student/[0-9]{1,15}/[^/]+$' THEN split_part(p_name, '/', 2)::bigint END
$$;

CREATE FUNCTION sims_private.can_use_student_doc_path(p_name text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(sims_private.doc_student_id(p_name) = sims_private.current_student_id()
                    OR sims_private.can_student(ARRAY[CASE WHEN p_write THEN 'DOCUMENT.ALL.CREATE' ELSE 'DOCUMENT.ALL.READ' END]::text[], sims_private.doc_student_id(p_name), p_write), false)
$$;

-- Orphan: no file_object refers to the key (so removing the bytes loses no metadata).
CREATE FUNCTION sims_private.storage_key_is_orphan(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_name)
$$;

DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
        EXECUTE $p$CREATE POLICY sims_documents_select ON storage.objects FOR SELECT TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.can_use_student_doc_path(name, false))$p$;
        EXECUTE $p$CREATE POLICY sims_documents_insert ON storage.objects FOR INSERT TO authenticated
                   WITH CHECK (bucket_id = 'sims-documents' AND sims_private.can_use_student_doc_path(name, true))$p$;
        EXECUTE $p$CREATE POLICY sims_documents_delete ON storage.objects FOR DELETE TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.can_use_student_doc_path(name, true) AND sims_private.storage_key_is_orphan(name))$p$;
    END IF;
END $$;

-- Registers an uploaded object as a PENDING document. Returns the student_document id.
CREATE FUNCTION public.student_document_register(p_student_id bigint, p_document_type_id integer, p_storage_key text, p_file_name text, p_mime_type text, p_size bigint, p_checksum text,
                                                 p_document_number text DEFAULT NULL, p_issue_date date DEFAULT NULL, p_expiry_date date DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file bigint; v_doc bigint; v_ext text; v_meta jsonb; v_number text := NULLIF(btrim(p_document_number), '');
BEGIN
    IF NOT (COALESCE(p_student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.CREATE']::text[], p_student_id, true)) THEN
        RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.CREATE)' USING ERRCODE = '42501';
    END IF;
    IF sims_private.doc_student_id(p_storage_key) IS DISTINCT FROM p_student_id THEN RAISE EXCEPTION 'The file is not stored under this student' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR btrim(p_file_name) = '' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The file name is required (at most 255 characters)' USING ERRCODE = '22023'; END IF;
    IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN RAISE EXCEPTION 'Only PDF, JPEG and PNG files are accepted' USING ERRCODE = '22023'; END IF;
    v_ext := lower(substring(p_file_name FROM '\.([A-Za-z0-9]{1,10})$'));
    IF v_ext IS NULL OR NOT ((p_mime_type = 'application/pdf' AND v_ext = 'pdf') OR (p_mime_type = 'image/jpeg' AND v_ext IN ('jpg', 'jpeg')) OR (p_mime_type = 'image/png' AND v_ext = 'png')) THEN
        RAISE EXCEPTION 'The file name does not match its type' USING ERRCODE = '22023';
    END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_number, '')) > 100 THEN RAISE EXCEPTION 'The document number is limited to 100 characters' USING ERRCODE = '22023'; END IF;
    IF p_issue_date IS NOT NULL AND p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN RAISE EXCEPTION 'The expiry date cannot be before the issue date' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM student WHERE student_id = p_student_id) THEN RAISE EXCEPTION 'Unknown student' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM document_type WHERE document_type_id = p_document_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active document type' USING ERRCODE = '22023'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_storage_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_storage_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime_type, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id())
    RETURNING file_object_id INTO v_file;
    INSERT INTO student_document (student_id, document_type_id, file_object_id, document_number, issue_date, expiry_date)
    VALUES (p_student_id, p_document_type_id, v_file, v_number, p_issue_date, p_expiry_date) RETURNING student_document_id INTO v_doc;
    RETURN v_doc;
END $$;

CREATE FUNCTION public.student_document_list(p_student_id bigint)
RETURNS TABLE (student_document_id bigint, document_type text, requires_verification boolean, original_file_name text, mime_type text, file_size_bytes bigint, document_number text,
               issue_date date, expiry_date date, verification_status text, effective_status text, verified_at timestamptz, remarks text, uploaded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT d.student_document_id::bigint, t.document_name::text, t.requires_verification, f.original_file_name::text, f.mime_type::text, f.file_size_bytes::bigint, d.document_number::text,
           d.issue_date, d.expiry_date, d.verification_status::text,
           CASE WHEN d.verification_status = 'VERIFIED' AND d.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE d.verification_status END::text,
           d.verified_at, d.remarks::text, f.uploaded_at
    FROM student_document d JOIN document_type t ON t.document_type_id = d.document_type_id JOIN file_object f ON f.file_object_id = d.file_object_id
    WHERE d.student_id = p_student_id AND f.deleted_at IS NULL
      AND (COALESCE(p_student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.READ']::text[], p_student_id, false))
    ORDER BY f.uploaded_at DESC, d.student_document_id DESC
$$;

-- Authorises a download, records it, and returns the key to sign.
CREATE FUNCTION public.student_document_download_info(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT d0.student_document_id, d0.student_id, f.storage_key, f.original_file_name, f.mime_type INTO d
    FROM student_document d0 JOIN file_object f ON f.file_object_id = d0.file_object_id WHERE d0.student_document_id = p_id AND f.deleted_at IS NULL;
    IF d.student_document_id IS NULL OR NOT (COALESCE(d.student_id = sims_private.current_student_id(), false) OR sims_private.can_student(ARRAY['DOCUMENT.ALL.READ']::text[], d.student_id, false)) THEN
        RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.READ) or unknown document' USING ERRCODE = '42501';
    END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details)
    VALUES (sims_private.current_user_id(), 'DOCUMENT', 'DOWNLOAD', 'student_document', p_id::text, jsonb_build_object('student_id', d.student_id));
    RETURN jsonb_build_object('storage_key', d.storage_key, 'file_name', d.original_file_name, 'mime_type', d.mime_type);
END $$;

CREATE FUNCTION public.student_document_review(p_id bigint, p_decision text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_remarks text := NULLIF(btrim(p_remarks), '');
BEGIN
    SELECT student_document_id, student_id, verification_status INTO d FROM student_document WHERE student_document_id = p_id FOR UPDATE;
    IF d.student_document_id IS NULL OR NOT sims_private.can_student(ARRAY['DOCUMENT.ALL.VERIFY']::text[], d.student_id, true) THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.VERIFY) or unknown document' USING ERRCODE = '42501'; END IF;
    IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be VERIFIED or REJECTED' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_remarks, '')) > 500 THEN RAISE EXCEPTION 'Remarks are limited to 500 characters' USING ERRCODE = '22023'; END IF;
    IF p_decision = 'REJECTED' AND v_remarks IS NULL THEN RAISE EXCEPTION 'Remarks are required to reject a document' USING ERRCODE = '22023'; END IF;
    IF d.verification_status = p_decision THEN RETURN; END IF; -- idempotent replay
    IF d.verification_status <> 'PENDING' THEN RAISE EXCEPTION 'Only a pending document can be reviewed' USING ERRCODE = '45000'; END IF;
    UPDATE student_document SET verification_status = p_decision, verified_at = now(), remarks = v_remarks WHERE student_document_id = p_id;
END $$;

-- Removes the metadata and returns the storage key, so the caller can then delete the (now orphaned) object.
CREATE FUNCTION public.student_document_delete(p_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT d0.student_document_id, d0.student_id, d0.verification_status, d0.file_object_id, f.storage_key INTO d
    FROM student_document d0 JOIN file_object f ON f.file_object_id = d0.file_object_id WHERE d0.student_document_id = p_id FOR UPDATE OF d0;
    IF d.student_document_id IS NULL THEN RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.DELETE) or unknown document' USING ERRCODE = '42501'; END IF;
    IF COALESCE(d.student_id = sims_private.current_student_id(), false) THEN
        IF d.verification_status = 'VERIFIED' THEN RAISE EXCEPTION 'A verified document cannot be deleted' USING ERRCODE = '45000'; END IF;
    ELSIF sims_private.can_student(ARRAY['DOCUMENT.ALL.DELETE']::text[], d.student_id, true) THEN
        IF d.verification_status = 'VERIFIED' THEN RAISE EXCEPTION 'A verified document cannot be deleted' USING ERRCODE = '45000'; END IF;
    ELSE
        RAISE EXCEPTION 'Not authorised (DOCUMENT.ALL.DELETE) or unknown document' USING ERRCODE = '42501';
    END IF;
    DELETE FROM student_document WHERE student_document_id = p_id;
    DELETE FROM file_object WHERE file_object_id = d.file_object_id;
    RETURN d.storage_key;
END $$;

REVOKE ALL ON FUNCTION sims_private.doc_student_id(text), sims_private.can_use_student_doc_path(text, boolean), sims_private.storage_key_is_orphan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.doc_student_id(text), sims_private.can_use_student_doc_path(text, boolean), sims_private.storage_key_is_orphan(text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_document_register(bigint, integer, text, text, text, bigint, text, text, date, date), public.student_document_list(bigint), public.student_document_download_info(bigint),
    public.student_document_review(bigint, text, text), public.student_document_delete(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_document_register(bigint, integer, text, text, text, bigint, text, text, date, date), public.student_document_list(bigint), public.student_document_download_info(bigint),
    public.student_document_review(bigint, text, text), public.student_document_delete(bigint) TO authenticated;
