-- Announcements (Communication module). Hand-written (not from the MySQL source).
--
-- DESIGN
--  * The generated direct-write policies and the APPROVE workflow guard on announcement stay in place (the screens use the RPCs, which add the lifecycle rules below). Every RPC authorises with the COMMUNICATION permissions at the
--    announcement's department scope; a NULL department means institution-wide and therefore needs a GLOBAL grant (sims_private.can_department falls back to can_global).
--  * Everyone who is an active member reads the feed through announcement_feed(); staff manage through announcement_manage_list().
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-51):
--  1  Lifecycle: DRAFT -> PENDING (submit) -> APPROVED | REJECTED; APPROVED -> ARCHIVED; REJECTED -> DRAFT (to rework). Only DRAFT and REJECTED can be edited; only DRAFT can be deleted.
--     Submitting needs UPDATE; APPROVED / REJECTED need APPROVE; ARCHIVED needs UPDATE.
--  2  Feed: APPROVED, publish_from <= now and (publish_to is null or in the future). Audience: ALL everyone; STUDENTS students; STAFF employees;
--     DEPARTMENT and PROGRAMME (there is no programme column) members of announcement.department_id (a student enrolled in one of its programmes, an employee with a current assignment there);
--     CUSTOM has no recipient list in the schema and is therefore never shown in the feed.
--  3  DEPARTMENT / PROGRAMME audiences need a department; publish_to must be later than publish_from.

CREATE TRIGGER trg_announcement_audit AFTER INSERT OR UPDATE OR DELETE ON announcement FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('COMMUNICATION', 'announcement_id');

CREATE FUNCTION sims_private.announcement_transition_ok(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_from, p_to) IN (('DRAFT', 'PENDING'), ('PENDING', 'APPROVED'), ('PENDING', 'REJECTED'), ('APPROVED', 'ARCHIVED'), ('REJECTED', 'DRAFT'))
$$;

-- Create (p_id null) or edit a DRAFT / REJECTED announcement. Returns its id.
CREATE FUNCTION public.announcement_save(p_id bigint, p_type_id integer, p_department_id integer, p_title text, p_description text, p_publish_from timestamptz, p_publish_to timestamptz, p_audience text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_id bigint;
BEGIN
    IF p_title IS NULL OR btrim(p_title) = '' OR length(btrim(p_title)) > 250 THEN RAISE EXCEPTION 'The title is required (at most 250 characters)' USING ERRCODE = '22023'; END IF;
    IF p_description IS NULL OR btrim(p_description) = '' OR length(p_description) > 10000 THEN RAISE EXCEPTION 'The description is required (at most 10000 characters)' USING ERRCODE = '22023'; END IF;
    IF p_audience NOT IN ('ALL', 'STUDENTS', 'STAFF', 'PROGRAMME', 'DEPARTMENT', 'CUSTOM') THEN RAISE EXCEPTION 'Invalid audience' USING ERRCODE = '22023'; END IF;
    IF p_audience IN ('PROGRAMME', 'DEPARTMENT') AND p_department_id IS NULL THEN RAISE EXCEPTION 'A department is required for this audience' USING ERRCODE = '22023'; END IF;
    IF p_publish_from IS NULL THEN RAISE EXCEPTION 'The publish-from date is required' USING ERRCODE = '22023'; END IF;
    IF p_publish_to IS NOT NULL AND p_publish_to <= p_publish_from THEN RAISE EXCEPTION 'The publish-to date must be later than the publish-from date' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM announcement_type WHERE announcement_type_id = p_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active announcement type' USING ERRCODE = '22023'; END IF;
    IF p_department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department WHERE department_id = p_department_id) THEN RAISE EXCEPTION 'Unknown department' USING ERRCODE = '22023'; END IF;
    IF p_id IS NULL THEN
        IF NOT sims_private.can_department(ARRAY['COMMUNICATION.ALL.CREATE']::text[], p_department_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.CREATE)' USING ERRCODE = '42501'; END IF;
        INSERT INTO announcement (announcement_type_id, department_id, title, description, publish_from, publish_to, audience_type)
        VALUES (p_type_id, p_department_id, btrim(p_title), btrim(p_description), p_publish_from, p_publish_to, p_audience) RETURNING announcement_id INTO v_id;
        RETURN v_id;
    END IF;
    SELECT announcement_id, department_id, approval_status INTO v FROM announcement WHERE announcement_id = p_id FOR UPDATE;
    IF v IS NULL OR NOT sims_private.can_department(ARRAY['COMMUNICATION.ALL.UPDATE']::text[], v.department_id)
       OR NOT sims_private.can_department(ARRAY['COMMUNICATION.ALL.UPDATE']::text[], p_department_id) THEN
        RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or unknown announcement' USING ERRCODE = '42501';
    END IF;
    IF v.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'Only a draft or rejected announcement can be edited' USING ERRCODE = '45000'; END IF;
    UPDATE announcement SET announcement_type_id = p_type_id, department_id = p_department_id, title = btrim(p_title), description = btrim(p_description),
        publish_from = p_publish_from, publish_to = p_publish_to, audience_type = p_audience WHERE announcement_id = p_id;
    RETURN p_id;
END $$;

CREATE FUNCTION public.announcement_set_status(p_id bigint, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_perm text;
BEGIN
    SELECT announcement_id, department_id, approval_status INTO v FROM announcement WHERE announcement_id = p_id FOR UPDATE;
    v_perm := CASE WHEN p_status IN ('APPROVED', 'REJECTED') THEN 'COMMUNICATION.ALL.APPROVE' ELSE 'COMMUNICATION.ALL.UPDATE' END;
    IF v IS NULL OR NOT sims_private.can_department(ARRAY[v_perm]::text[], v.department_id) THEN RAISE EXCEPTION 'Not authorised (%) or unknown announcement', v_perm USING ERRCODE = '42501'; END IF;
    IF v.approval_status = p_status THEN RETURN; END IF; -- idempotent replay
    IF NOT sims_private.announcement_transition_ok(v.approval_status, p_status) THEN RAISE EXCEPTION 'A % announcement cannot become %', v.approval_status, p_status USING ERRCODE = '45000'; END IF;
    UPDATE announcement SET approval_status = p_status WHERE announcement_id = p_id;
END $$;

CREATE FUNCTION public.announcement_delete(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT announcement_id, department_id, approval_status INTO v FROM announcement WHERE announcement_id = p_id FOR UPDATE;
    IF v IS NULL OR NOT sims_private.can_department(ARRAY['COMMUNICATION.ALL.DELETE']::text[], v.department_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.DELETE) or unknown announcement' USING ERRCODE = '42501'; END IF;
    IF v.approval_status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft announcement can be deleted' USING ERRCODE = '45000'; END IF;
    DELETE FROM announcement_attachment WHERE announcement_id = p_id;
    DELETE FROM announcement WHERE announcement_id = p_id;
END $$;

-- Staff list (all statuses) of what the caller may read.
CREATE FUNCTION public.announcement_manage_list(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (announcement_id bigint, title text, type_name text, department_name text, audience_type text, approval_status text, publish_from timestamptz, publish_to timestamptz, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH v AS (
        SELECT a.announcement_id, a.title::text, t.type_name::text, d.department_name::text, a.audience_type::text, a.approval_status::text, a.publish_from, a.publish_to, a.created_at
        FROM announcement a JOIN announcement_type t ON t.announcement_type_id = a.announcement_type_id LEFT JOIN department d ON d.department_id = a.department_id
        WHERE (p_status IS NULL OR a.approval_status = p_status)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(a.title)) > 0)
          AND sims_private.can_department(ARRAY['COMMUNICATION.ALL.READ']::text[], a.department_id)
    )
    SELECT v.announcement_id::bigint, v.title, v.type_name, v.department_name, v.audience_type, v.approval_status, v.publish_from, v.publish_to, count(*) OVER ()
    FROM v ORDER BY v.created_at DESC, v.announcement_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- What the caller is meant to see right now (any active member).
CREATE FUNCTION public.announcement_feed(p_limit integer DEFAULT 50)
RETURNS TABLE (announcement_id bigint, title text, description text, type_name text, department_name text, publish_from timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.announcement_id::bigint, a.title::text, a.description, t.type_name::text, d.department_name::text, a.publish_from
    FROM announcement a JOIN announcement_type t ON t.announcement_type_id = a.announcement_type_id LEFT JOIN department d ON d.department_id = a.department_id
    WHERE sims_private.is_active_member() AND a.approval_status = 'APPROVED' AND a.publish_from <= now() AND (a.publish_to IS NULL OR a.publish_to > now())
      AND CASE a.audience_type
            WHEN 'ALL' THEN true
            WHEN 'STUDENTS' THEN sims_private.current_student_id() IS NOT NULL
            WHEN 'STAFF' THEN sims_private.current_employee_id() IS NOT NULL
            WHEN 'DEPARTMENT' THEN EXISTS (SELECT 1 FROM student_programme_enrolment e JOIN programme p ON p.programme_id = e.programme_id WHERE e.student_id = sims_private.current_student_id() AND p.department_id = a.department_id)
                                OR EXISTS (SELECT 1 FROM employee_assignment ea WHERE ea.employee_id = sims_private.current_employee_id() AND ea.end_date IS NULL AND ea.department_id = a.department_id)
            WHEN 'PROGRAMME' THEN EXISTS (SELECT 1 FROM student_programme_enrolment e JOIN programme p ON p.programme_id = e.programme_id WHERE e.student_id = sims_private.current_student_id() AND p.department_id = a.department_id)
                                OR EXISTS (SELECT 1 FROM employee_assignment ea WHERE ea.employee_id = sims_private.current_employee_id() AND ea.end_date IS NULL AND ea.department_id = a.department_id)
            ELSE false END
    ORDER BY a.publish_from DESC, a.announcement_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

CREATE FUNCTION public.announcement_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record;
BEGIN
    SELECT * INTO a FROM announcement WHERE announcement_id = p_id;
    IF a.announcement_id IS NULL OR NOT sims_private.can_department(ARRAY['COMMUNICATION.ALL.READ']::text[], a.department_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.READ) or unknown announcement' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('announcement_id', a.announcement_id, 'announcement_type_id', a.announcement_type_id, 'department_id', a.department_id, 'title', a.title, 'description', a.description,
        'publish_from', a.publish_from, 'publish_to', a.publish_to, 'approval_status', a.approval_status, 'audience_type', a.audience_type,
        'can_update', sims_private.can_department(ARRAY['COMMUNICATION.ALL.UPDATE']::text[], a.department_id), 'can_approve', sims_private.can_department(ARRAY['COMMUNICATION.ALL.APPROVE']::text[], a.department_id),
        'can_delete', sims_private.can_department(ARRAY['COMMUNICATION.ALL.DELETE']::text[], a.department_id));
END $$;

REVOKE ALL ON FUNCTION public.announcement_save(bigint, integer, integer, text, text, timestamptz, timestamptz, text), public.announcement_set_status(bigint, text), public.announcement_delete(bigint),
    public.announcement_manage_list(text, text, integer, integer), public.announcement_feed(integer), public.announcement_get(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_save(bigint, integer, integer, text, text, timestamptz, timestamptz, text), public.announcement_set_status(bigint, text), public.announcement_delete(bigint),
    public.announcement_manage_list(text, text, integer, integer), public.announcement_feed(integer), public.announcement_get(bigint) TO authenticated;
