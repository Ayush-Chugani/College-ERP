-- Announcement attachments (KI-54). Hand-written (not from the MySQL source). Same private bucket and flow as student documents; prefix announcement/<id>/<random>-<name>.
--
-- RULES (my inferences, KI-69): the author of a DRAFT or REJECTED announcement, or staff with COMMUNICATION.ALL.UPDATE for its department, can add and remove files (PDF, JPEG, PNG, 10 MB each,
-- at most 10 per announcement). Anyone who may see the announcement (the audience of a published one, or its managers) can list and download; every download authorisation is logged in activity_audit.
-- Files are visible to the audience only after approval, because they follow the announcement's visibility. A published announcement's files cannot be changed (edit is locked after submission).

CREATE FUNCTION sims_private.doc_announcement_id(p_name text) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN length(p_name) <= 400 AND p_name ~ '^announcement/[0-9]{1,15}/[^/]+$' THEN split_part(p_name, '/', 2)::bigint END $$;

-- may the caller see this announcement (published to them, or managing it)?
CREATE FUNCTION sims_private.announcement_visible(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT (aa.user_id IS NOT NULL AND aa.user_id IS NOT DISTINCT FROM sims_private.current_user_id())
                         OR sims_private.announcement_can('READ', a.department_id)
                         OR (a.approval_status = 'APPROVED' AND a.publish_from <= now() AND (a.publish_to IS NULL OR a.publish_to > now()) AND sims_private.announcement_audience_ok(a.audience_type, a.department_id))
                     FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id WHERE a.announcement_id = p_id), false)
$$;

-- may the caller change this announcement's files?
CREATE FUNCTION sims_private.announcement_editable(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT a.approval_status IN ('DRAFT', 'REJECTED')
                         AND ((aa.user_id IS NOT NULL AND aa.user_id IS NOT DISTINCT FROM sims_private.current_user_id()) OR sims_private.announcement_can('UPDATE', a.department_id))
                     FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id WHERE a.announcement_id = p_id), false)
$$;

CREATE FUNCTION sims_private.can_use_announcement_path(p_name text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(CASE WHEN p_write THEN sims_private.announcement_editable(sims_private.doc_announcement_id(p_name)) ELSE sims_private.announcement_visible(sims_private.doc_announcement_id(p_name)) END, false)
$$;
REVOKE ALL ON FUNCTION sims_private.doc_announcement_id(text), sims_private.announcement_visible(bigint), sims_private.announcement_editable(bigint), sims_private.can_use_announcement_path(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.doc_announcement_id(text), sims_private.announcement_visible(bigint), sims_private.announcement_editable(bigint), sims_private.can_use_announcement_path(text, boolean) TO authenticated;

DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
        EXECUTE $p$CREATE POLICY sims_announcement_files_select ON storage.objects FOR SELECT TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.doc_announcement_id(name) IS NOT NULL AND sims_private.can_use_announcement_path(name, false))$p$;
        EXECUTE $p$CREATE POLICY sims_announcement_files_insert ON storage.objects FOR INSERT TO authenticated
                   WITH CHECK (bucket_id = 'sims-documents' AND sims_private.doc_announcement_id(name) IS NOT NULL AND sims_private.can_use_announcement_path(name, true))$p$;
        EXECUTE $p$CREATE POLICY sims_announcement_files_delete ON storage.objects FOR DELETE TO authenticated
                   USING (bucket_id = 'sims-documents' AND sims_private.doc_announcement_id(name) IS NOT NULL AND sims_private.can_use_announcement_path(name, true) AND sims_private.storage_key_is_orphan(name))$p$;
    END IF;
END $$;

CREATE FUNCTION public.announcement_attachment_register(p_id bigint, p_storage_key text, p_file_name text, p_mime_type text, p_size bigint, p_checksum text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file bigint; v_ext text; v_meta jsonb; v_n integer;
BEGIN
    IF NOT sims_private.announcement_editable(p_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or the announcement can no longer be edited' USING ERRCODE = '42501'; END IF;
    IF sims_private.doc_announcement_id(p_storage_key) IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'The file is not stored under this announcement' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR btrim(p_file_name) = '' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The file name is required (at most 255 characters)' USING ERRCODE = '22023'; END IF;
    IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN RAISE EXCEPTION 'Only PDF, JPEG and PNG files are accepted' USING ERRCODE = '22023'; END IF;
    v_ext := lower(substring(p_file_name FROM '\.([A-Za-z0-9]{1,10})$'));
    IF v_ext IS NULL OR NOT ((p_mime_type = 'application/pdf' AND v_ext = 'pdf') OR (p_mime_type = 'image/jpeg' AND v_ext IN ('jpg', 'jpeg')) OR (p_mime_type = 'image/png' AND v_ext = 'png')) THEN RAISE EXCEPTION 'The file name does not match its type' USING ERRCODE = '22023'; END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    SELECT count(*) INTO v_n FROM announcement_attachment WHERE announcement_id = p_id;
    IF v_n >= 10 THEN RAISE EXCEPTION 'An announcement can have at most 10 attachments' USING ERRCODE = '45000'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_storage_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_storage_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime_type, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'INTERNAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    INSERT INTO announcement_attachment (announcement_id, file_object_id, display_order) VALUES (p_id, v_file, v_n + 1);
    RETURN v_file;
END $$;

CREATE FUNCTION public.announcement_attachment_list(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.announcement_visible(p_id) THEN RAISE EXCEPTION 'Unknown announcement' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('can_edit', sims_private.announcement_editable(p_id),
        'files', COALESCE((SELECT jsonb_agg(jsonb_build_object('file_id', f.file_object_id, 'name', f.original_file_name, 'mime', f.mime_type, 'size', f.file_size_bytes) ORDER BY t.display_order, f.file_object_id)
                           FROM announcement_attachment t JOIN file_object f ON f.file_object_id = t.file_object_id WHERE t.announcement_id = p_id AND f.deleted_at IS NULL), '[]'::jsonb));
END $$;

CREATE FUNCTION public.announcement_attachment_download_info(p_id bigint, p_file_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f record;
BEGIN
    SELECT f0.storage_key, f0.original_file_name, f0.mime_type INTO f FROM announcement_attachment t JOIN file_object f0 ON f0.file_object_id = t.file_object_id
     WHERE t.announcement_id = p_id AND t.file_object_id = p_file_id AND f0.deleted_at IS NULL;
    IF f.storage_key IS NULL OR NOT sims_private.announcement_visible(p_id) THEN RAISE EXCEPTION 'Unknown announcement or file' USING ERRCODE = '42501'; END IF;
    INSERT INTO activity_audit (user_id, module_code, action_code, entity_name, entity_id, details)
    VALUES (sims_private.current_user_id(), 'COMMUNICATION', 'DOWNLOAD', 'announcement_attachment', p_id::text, jsonb_build_object('file_object_id', p_file_id));
    RETURN jsonb_build_object('storage_key', f.storage_key, 'file_name', f.original_file_name, 'mime_type', f.mime_type);
END $$;

-- removes the link and the metadata and returns the key so the caller can delete the (now orphaned) object
CREATE FUNCTION public.announcement_attachment_remove(p_id bigint, p_file_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text;
BEGIN
    IF NOT sims_private.announcement_editable(p_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or the announcement can no longer be edited' USING ERRCODE = '42501'; END IF;
    SELECT f.storage_key INTO v_key FROM announcement_attachment t JOIN file_object f ON f.file_object_id = t.file_object_id WHERE t.announcement_id = p_id AND t.file_object_id = p_file_id;
    IF v_key IS NULL THEN RAISE EXCEPTION 'Unknown file' USING ERRCODE = '22023'; END IF;
    DELETE FROM announcement_attachment WHERE announcement_id = p_id AND file_object_id = p_file_id;
    DELETE FROM file_object WHERE file_object_id = p_file_id;
    RETURN v_key;
END $$;

REVOKE ALL ON FUNCTION public.announcement_attachment_register(bigint, text, text, text, bigint, text), public.announcement_attachment_list(bigint), public.announcement_attachment_download_info(bigint, bigint), public.announcement_attachment_remove(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_attachment_register(bigint, text, text, text, bigint, text), public.announcement_attachment_list(bigint), public.announcement_attachment_download_info(bigint, bigint), public.announcement_attachment_remove(bigint, bigint) TO authenticated;
