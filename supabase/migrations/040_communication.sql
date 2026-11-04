-- Communication (announcements). Hand-written (not from the MySQL source).
--
-- DESIGN
--  * announcement and announcement_attachment become RPC-only for clients: the approval workflow and the audience rules must be
--    enforced by the server. The source has no author column, so the author is kept in sims_private.announcement_author.
--  * Recipients read through announcements_feed(), which applies the audience rules; the generated SELECT policy stays for staff.
--  * Attachments need file storage, which is not built yet, so announcement_attachment has no RPC (KNOWN_ISSUES KI-51).
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-51):
--  1  Workflow: DRAFT -> PENDING (submitted) -> APPROVED | REJECTED; REJECTED -> DRAFT (edited) or PENDING (resubmitted);
--     DRAFT | APPROVED | REJECTED -> ARCHIVED. Editing is allowed only in DRAFT or REJECTED.
--  2  Creating needs COMMUNICATION.ALL.CREATE at the department (an announcement without a department is institution-wide and needs a
--     global grant). Approving or rejecting needs COMMUNICATION.ALL.APPROVE at the same scope and may not be done by the author,
--     except by a global COMMUNICATION.ALL.CONFIGURE holder. Approval is also the publication (PUBLISH is not checked separately).
--  3  Audience: ALL = students and staff, STUDENTS, STAFF, DEPARTMENT = students and staff of that department. With a department set,
--     the audience is limited to that department's active students (programme enrolment) and staff (current assignment). The audience
--     types PROGRAMME and CUSTOM cannot be targeted because the schema has no column for them, so they are refused.
--  4  An approved announcement is shown while publish_from <= now() and (publish_to is empty or in the future).

CREATE TABLE sims_private.announcement_author (
    announcement_id bigint PRIMARY KEY REFERENCES public.announcement(announcement_id) ON DELETE CASCADE,
    user_id bigint NOT NULL
);
ALTER TABLE sims_private.announcement_author ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sims_private.announcement_author FROM PUBLIC, anon, authenticated;

DROP POLICY announcement_insert ON announcement;
DROP POLICY announcement_update ON announcement;
DROP POLICY announcement_delete ON announcement;
DROP POLICY announcement_attachment_insert ON announcement_attachment;
DROP POLICY announcement_attachment_update ON announcement_attachment;
DROP POLICY announcement_attachment_delete ON announcement_attachment;
REVOKE INSERT, UPDATE, DELETE ON announcement, announcement_attachment FROM authenticated;

CREATE TRIGGER trg_announcement_audit AFTER INSERT OR UPDATE OR DELETE ON announcement FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('COMMUNICATION', 'announcement_id');

-- Is the caller (student and/or staff member) in the audience of an announcement with this audience type and department?
CREATE FUNCTION sims_private.announcement_audience_ok(p_audience text, p_department integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_student_id() AS sid, sims_private.current_employee_id() AS eid),
    s AS (
        SELECT (SELECT sid FROM me) IS NOT NULL AS is_student,
               EXISTS (SELECT 1 FROM student_programme_enrolment e JOIN programme p ON p.programme_id = e.programme_id
                       WHERE e.student_id = (SELECT sid FROM me) AND e.enrolment_status = 'ACTIVE' AND (p_department IS NULL OR p.department_id = p_department)) AS student_in,
               (SELECT eid FROM me) IS NOT NULL AS is_staff,
               EXISTS (SELECT 1 FROM employee_assignment a
                       WHERE a.employee_id = (SELECT eid FROM me) AND (a.end_date IS NULL OR a.end_date >= current_date) AND (p_department IS NULL OR a.department_id = p_department)) AS staff_in
    )
    SELECT CASE p_audience
        WHEN 'ALL' THEN (is_student AND student_in) OR (is_staff AND staff_in)
        WHEN 'STUDENTS' THEN is_student AND student_in
        WHEN 'STAFF' THEN is_staff AND staff_in
        WHEN 'DEPARTMENT' THEN p_department IS NOT NULL AND ((is_student AND student_in) OR (is_staff AND staff_in))
        ELSE false END
    FROM s
$$;

CREATE FUNCTION sims_private.announcement_can(p_action text, p_department integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT sims_private.can_department(ARRAY['COMMUNICATION.ALL.' || p_action]::text[], p_department)
$$;

CREATE FUNCTION sims_private.announcement_check(p_type integer, p_department integer, p_title text, p_description text, p_from timestamptz, p_to timestamptz, p_audience text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_title IS NULL OR btrim(p_title) = '' OR length(btrim(p_title)) > 250 THEN RAISE EXCEPTION 'The title is required (at most 250 characters)' USING ERRCODE = '22023'; END IF;
    IF p_description IS NULL OR btrim(p_description) = '' OR length(p_description) > 20000 THEN RAISE EXCEPTION 'The text is required (at most 20000 characters)' USING ERRCODE = '22023'; END IF;
    IF p_audience NOT IN ('ALL', 'STUDENTS', 'STAFF', 'DEPARTMENT') THEN RAISE EXCEPTION 'The audience must be ALL, STUDENTS, STAFF or DEPARTMENT' USING ERRCODE = '22023'; END IF;
    IF p_audience = 'DEPARTMENT' AND p_department IS NULL THEN RAISE EXCEPTION 'A department audience needs a department' USING ERRCODE = '22023'; END IF;
    IF p_from IS NULL THEN RAISE EXCEPTION 'The publication start is required' USING ERRCODE = '22023'; END IF;
    IF p_to IS NOT NULL AND p_to <= p_from THEN RAISE EXCEPTION 'The publication end must be after the start' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM announcement_type WHERE announcement_type_id = p_type AND is_active) THEN RAISE EXCEPTION 'Choose an active announcement type' USING ERRCODE = '22023'; END IF;
    IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department WHERE department_id = p_department) THEN RAISE EXCEPTION 'Unknown department' USING ERRCODE = '22023'; END IF;
END $$;

-- ---------------------------------------------------------------
-- Authoring and workflow
-- ---------------------------------------------------------------
CREATE FUNCTION public.announcement_save(p_id bigint, p_type_id integer, p_department_id integer, p_title text, p_description text, p_publish_from timestamptz, p_publish_to timestamptz, p_audience text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_id bigint; v_author bigint;
BEGIN
    PERFORM sims_private.announcement_check(p_type_id, p_department_id, p_title, p_description, p_publish_from, p_publish_to, p_audience);
    IF p_id IS NULL THEN
        IF NOT sims_private.announcement_can('CREATE', p_department_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.CREATE) for this department' USING ERRCODE = '42501'; END IF;
        INSERT INTO announcement (announcement_type_id, department_id, title, description, publish_from, publish_to, approval_status, audience_type)
        VALUES (p_type_id, p_department_id, btrim(p_title), btrim(p_description), p_publish_from, p_publish_to, 'DRAFT', p_audience) RETURNING announcement_id INTO v_id;
        INSERT INTO sims_private.announcement_author (announcement_id, user_id) VALUES (v_id, sims_private.current_user_id());
        RETURN v_id;
    END IF;
    SELECT a.announcement_id, a.department_id, a.approval_status, aa.user_id INTO v FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id
    WHERE a.announcement_id = p_id FOR UPDATE OF a;
    IF v IS NULL OR NOT (v.user_id IS NOT DISTINCT FROM sims_private.current_user_id() OR sims_private.announcement_can('UPDATE', v.department_id)) THEN
        RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or unknown announcement' USING ERRCODE = '42501';
    END IF;
    IF v.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % announcement cannot be edited', v.approval_status USING ERRCODE = '45000'; END IF;
    -- moving it to another department needs the right to create there
    IF p_department_id IS DISTINCT FROM v.department_id AND NOT sims_private.announcement_can('CREATE', p_department_id) THEN
        RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.CREATE) for that department' USING ERRCODE = '42501';
    END IF;
    UPDATE announcement SET announcement_type_id = p_type_id, department_id = p_department_id, title = btrim(p_title), description = btrim(p_description), publish_from = p_publish_from,
        publish_to = p_publish_to, audience_type = p_audience, approval_status = 'DRAFT' WHERE announcement_id = p_id;
    RETURN p_id;
END $$;

CREATE FUNCTION public.announcement_submit(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT a.department_id, a.approval_status, aa.user_id INTO v FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id WHERE a.announcement_id = p_id FOR UPDATE OF a;
    IF v IS NULL OR NOT (v.user_id IS NOT DISTINCT FROM sims_private.current_user_id() OR sims_private.announcement_can('UPDATE', v.department_id)) THEN
        RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or unknown announcement' USING ERRCODE = '42501';
    END IF;
    IF v.approval_status = 'PENDING' THEN RETURN; END IF; -- idempotent replay
    IF v.approval_status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'A % announcement cannot be submitted', v.approval_status USING ERRCODE = '45000'; END IF;
    UPDATE announcement SET approval_status = 'PENDING' WHERE announcement_id = p_id;
END $$;

CREATE FUNCTION public.announcement_decide(p_id bigint, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_to text := CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END;
BEGIN
    SELECT a.department_id, a.approval_status, aa.user_id INTO v FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id WHERE a.announcement_id = p_id FOR UPDATE OF a;
    IF v IS NULL OR NOT sims_private.announcement_can('APPROVE', v.department_id) THEN RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.APPROVE) or unknown announcement' USING ERRCODE = '42501'; END IF;
    IF v.user_id IS NOT DISTINCT FROM sims_private.current_user_id() AND NOT sims_private.can_global(ARRAY['COMMUNICATION.ALL.CONFIGURE']::text[]) THEN
        RAISE EXCEPTION 'You cannot approve or reject your own announcement' USING ERRCODE = '42501';
    END IF;
    IF v.approval_status = v_to THEN RETURN; END IF; -- idempotent replay
    IF v.approval_status <> 'PENDING' THEN RAISE EXCEPTION 'Only a PENDING announcement can be approved or rejected (this one is %)', v.approval_status USING ERRCODE = '45000'; END IF;
    UPDATE announcement SET approval_status = v_to WHERE announcement_id = p_id;
END $$;

CREATE FUNCTION public.announcement_archive(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT a.department_id, a.approval_status, aa.user_id INTO v FROM announcement a LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id WHERE a.announcement_id = p_id FOR UPDATE OF a;
    IF v IS NULL OR NOT (sims_private.announcement_can('UPDATE', v.department_id) OR (v.user_id IS NOT DISTINCT FROM sims_private.current_user_id() AND v.approval_status IN ('DRAFT', 'REJECTED'))) THEN
        RAISE EXCEPTION 'Not authorised (COMMUNICATION.ALL.UPDATE) or unknown announcement' USING ERRCODE = '42501';
    END IF;
    IF v.approval_status = 'ARCHIVED' THEN RETURN; END IF;
    IF v.approval_status = 'PENDING' THEN RAISE EXCEPTION 'Approve or reject the announcement before archiving it' USING ERRCODE = '45000'; END IF;
    UPDATE announcement SET approval_status = 'ARCHIVED' WHERE announcement_id = p_id;
END $$;

-- ---------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------
-- Announcements the caller manages: readable at the department (or global), or their own drafts.
CREATE FUNCTION public.announcements_manage(p_status text DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (announcement_id bigint, title text, type_name text, department_name text, audience_type text, approval_status text, publish_from timestamptz, publish_to timestamptz, is_mine boolean, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH visible AS (
        SELECT a.announcement_id, a.title::text, t.type_name::text, d.department_name::text, a.audience_type::text, a.approval_status::text, a.publish_from, a.publish_to,
               COALESCE(aa.user_id = sims_private.current_user_id(), false) AS is_mine
        FROM announcement a JOIN announcement_type t ON t.announcement_type_id = a.announcement_type_id LEFT JOIN department d ON d.department_id = a.department_id
        LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = a.announcement_id
        WHERE (p_status IS NULL OR a.approval_status = p_status)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(a.title)) > 0)
          AND (sims_private.announcement_can('READ', a.department_id) OR aa.user_id = sims_private.current_user_id())
    )
    SELECT v.announcement_id::bigint, v.title, v.type_name, v.department_name, v.audience_type, v.approval_status, v.publish_from, v.publish_to, v.is_mine, count(*) OVER ()
    FROM visible v ORDER BY v.publish_from DESC, v.announcement_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- What the signed-in user should see now.
CREATE FUNCTION public.announcements_feed(p_limit integer DEFAULT 20)
RETURNS TABLE (announcement_id bigint, title text, description text, type_name text, department_name text, publish_from timestamptz, publish_to timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.announcement_id::bigint, a.title::text, a.description::text, t.type_name::text, d.department_name::text, a.publish_from, a.publish_to
    FROM announcement a JOIN announcement_type t ON t.announcement_type_id = a.announcement_type_id LEFT JOIN department d ON d.department_id = a.department_id
    WHERE a.approval_status = 'APPROVED' AND a.publish_from <= now() AND (a.publish_to IS NULL OR a.publish_to > now())
      AND sims_private.announcement_audience_ok(a.audience_type, a.department_id)
    ORDER BY a.publish_from DESC, a.announcement_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

-- One announcement: managers see any status, recipients see only what the feed would show them.
CREATE FUNCTION public.announcement_detail(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_author boolean; v_manage boolean; v_can_edit boolean;
BEGIN
    SELECT x.*, t.type_name, d.department_name, aa.user_id AS author_id INTO a
    FROM announcement x JOIN announcement_type t ON t.announcement_type_id = x.announcement_type_id LEFT JOIN department d ON d.department_id = x.department_id
    LEFT JOIN sims_private.announcement_author aa ON aa.announcement_id = x.announcement_id WHERE x.announcement_id = p_id;
    IF a.announcement_id IS NULL THEN RAISE EXCEPTION 'Unknown announcement' USING ERRCODE = '42501'; END IF;
    v_author := a.author_id IS NOT DISTINCT FROM sims_private.current_user_id() AND a.author_id IS NOT NULL;
    v_manage := v_author OR sims_private.announcement_can('READ', a.department_id);
    IF NOT v_manage AND NOT (a.approval_status = 'APPROVED' AND a.publish_from <= now() AND (a.publish_to IS NULL OR a.publish_to > now()) AND sims_private.announcement_audience_ok(a.audience_type, a.department_id)) THEN
        RAISE EXCEPTION 'Unknown announcement' USING ERRCODE = '42501';
    END IF;
    v_can_edit := v_author OR sims_private.announcement_can('UPDATE', a.department_id);
    RETURN jsonb_build_object('announcement_id', a.announcement_id, 'title', a.title, 'description', a.description, 'type_id', a.announcement_type_id, 'type_name', a.type_name,
        'department_id', a.department_id, 'department_name', a.department_name, 'audience_type', a.audience_type, 'approval_status', a.approval_status,
        'publish_from', a.publish_from, 'publish_to', a.publish_to, 'is_mine', v_author,
        'can_edit', v_manage AND v_can_edit AND a.approval_status IN ('DRAFT', 'REJECTED'),
        'can_submit', v_manage AND v_can_edit AND a.approval_status IN ('DRAFT', 'REJECTED'),
        'can_decide', v_manage AND a.approval_status = 'PENDING' AND sims_private.announcement_can('APPROVE', a.department_id)
                      AND (NOT v_author OR sims_private.can_global(ARRAY['COMMUNICATION.ALL.CONFIGURE']::text[])),
        'can_archive', v_manage AND a.approval_status IN ('DRAFT', 'APPROVED', 'REJECTED') AND (sims_private.announcement_can('UPDATE', a.department_id) OR (v_author AND a.approval_status IN ('DRAFT', 'REJECTED'))),
        'managed', v_manage);
END $$;

REVOKE ALL ON FUNCTION public.announcement_save(bigint, integer, integer, text, text, timestamptz, timestamptz, text), public.announcement_submit(bigint), public.announcement_decide(bigint, boolean),
    public.announcement_archive(bigint), public.announcements_manage(text, text, integer, integer), public.announcements_feed(integer), public.announcement_detail(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_save(bigint, integer, integer, text, text, timestamptz, timestamptz, text), public.announcement_submit(bigint), public.announcement_decide(bigint, boolean),
    public.announcement_archive(bigint), public.announcements_manage(text, text, integer, integer), public.announcements_feed(integer), public.announcement_detail(bigint) TO authenticated;
REVOKE ALL ON FUNCTION sims_private.announcement_audience_ok(text, integer), sims_private.announcement_can(text, integer),
    sims_private.announcement_check(integer, integer, text, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;

-- Departments the caller may post to (and whether an institution-wide post is allowed), for the editor.
CREATE FUNCTION public.announcement_targets() RETURNS TABLE (department_id integer, department_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT d.department_id::integer, d.department_name::text FROM department d WHERE sims_private.announcement_can('CREATE', d.department_id) ORDER BY d.department_name
$$;
CREATE FUNCTION public.announcement_can_post_global() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT sims_private.announcement_can('CREATE', NULL) $$;
REVOKE ALL ON FUNCTION public.announcement_targets(), public.announcement_can_post_global() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_targets(), public.announcement_can_post_global() TO authenticated;
