-- Grievance. Hand-written (not from the MySQL source).
--
-- DESIGN
--  * grievance and grievance_action are RPC-only for writes. Filing a grievance is a right of every student, but the seed gives students
--    no GRIEVANCE permission at all, so the RPCs authorise a student by identity (their own record), not by a permission.
--  * Staff act on a grievance with GRIEVANCE.ALL.UPDATE at the student's scope and read it with GRIEVANCE.ALL.READ (generated policies).
--  * The source has no assignee column: ASSIGNED only records that the grievance has been taken up (see grievance_action for who did it).
--
-- ASSUMPTIONS (the source defines none of these; KNOWN_ISSUES KI-50):
--  1  Numbers are GRV-<year>-<6-digit sequence>.
--  2  A student may have at most 10 grievances that are not CLOSED.
--  3  Transitions: SUBMITTED -> ASSIGNED | REJECTED; ASSIGNED -> UNDER_REVIEW | REJECTED; UNDER_REVIEW -> RESOLVED | REJECTED;
--     RESOLVED -> CLOSED | UNDER_REVIEW (re-opened); REJECTED -> CLOSED; CLOSED is final. RESOLVED and REJECTED need a resolution text;
--     resolved_at is set when a grievance becomes RESOLVED or REJECTED and cleared when it is re-opened.
--  4  The student may close a RESOLVED or REJECTED grievance, or re-open a RESOLVED one; every other change is staff-only.
--  5  Actions of type INTERNAL_NOTE are never shown to the student; every other action is.
--  6  The optional department must belong to the student's institution.

CREATE SEQUENCE sims_private.grievance_seq;

DROP POLICY grievance_insert ON grievance;
DROP POLICY grievance_update ON grievance;
DROP POLICY grievance_delete ON grievance;
DROP POLICY grievance_action_insert ON grievance_action;
DROP POLICY grievance_action_update ON grievance_action;
DROP POLICY grievance_action_delete ON grievance_action;
REVOKE INSERT, UPDATE, DELETE ON grievance, grievance_action FROM authenticated;

CREATE TRIGGER trg_grievance_audit AFTER INSERT OR UPDATE OR DELETE ON grievance FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('GRIEVANCE', 'grievance_id');

CREATE FUNCTION sims_private.grievance_transition_ok(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_from, p_to) IN (('SUBMITTED', 'ASSIGNED'), ('SUBMITTED', 'REJECTED'), ('ASSIGNED', 'UNDER_REVIEW'), ('ASSIGNED', 'REJECTED'), ('UNDER_REVIEW', 'RESOLVED'),
                              ('UNDER_REVIEW', 'REJECTED'), ('RESOLVED', 'CLOSED'), ('RESOLVED', 'UNDER_REVIEW'), ('REJECTED', 'CLOSED'))
$$;

-- ---------------------------------------------------------------
-- Student side
-- ---------------------------------------------------------------
CREATE FUNCTION public.grievance_submit(p_category_id integer, p_department_id integer, p_subject text, p_description text, p_priority text DEFAULT 'NORMAL') RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_student bigint := sims_private.current_student_id(); v_inst integer; v_id bigint; v_number text; v_open integer;
BEGIN
    IF v_student IS NULL THEN RAISE EXCEPTION 'Only students can submit a grievance' USING ERRCODE = '42501'; END IF;
    IF p_subject IS NULL OR btrim(p_subject) = '' OR length(btrim(p_subject)) > 200 THEN RAISE EXCEPTION 'The subject is required (at most 200 characters)' USING ERRCODE = '22023'; END IF;
    IF p_description IS NULL OR btrim(p_description) = '' OR length(p_description) > 5000 THEN RAISE EXCEPTION 'The description is required (at most 5000 characters)' USING ERRCODE = '22023'; END IF;
    IF p_priority NOT IN ('LOW', 'NORMAL', 'HIGH', 'URGENT') THEN RAISE EXCEPTION 'Invalid priority' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM grievance_category WHERE grievance_category_id = p_category_id AND is_active) THEN RAISE EXCEPTION 'Choose an active grievance category' USING ERRCODE = '22023'; END IF;
    IF p_department_id IS NOT NULL THEN
        SELECT c.institution_id INTO v_inst FROM department d JOIN campus c ON c.campus_id = d.campus_id WHERE d.department_id = p_department_id;
        IF v_inst IS NULL OR NOT EXISTS (SELECT 1 FROM student_programme_enrolment e WHERE e.student_id = v_student AND sims_private.programme_institution(e.programme_id) = v_inst) THEN
            RAISE EXCEPTION 'That department does not belong to your institution' USING ERRCODE = '22023';
        END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('grievance:' || v_student, 0));
    SELECT count(*) INTO v_open FROM grievance WHERE student_id = v_student AND status <> 'CLOSED';
    IF v_open >= 10 THEN RAISE EXCEPTION 'You already have 10 open grievances; wait for them to be closed' USING ERRCODE = '45000'; END IF;
    v_number := 'GRV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sims_private.grievance_seq')::text, 6, '0');
    INSERT INTO grievance (grievance_number, student_id, grievance_category_id, department_id, subject, description, priority)
    VALUES (v_number, v_student, p_category_id, p_department_id, btrim(p_subject), btrim(p_description), p_priority) RETURNING grievance_id INTO v_id;
    INSERT INTO grievance_action (grievance_id, action_type, action_notes, new_status) VALUES (v_id, 'SUBMITTED', NULL, 'SUBMITTED');
    RETURN v_id;
END $$;

-- The signed-in student's own grievances.
CREATE FUNCTION public.grievance_my()
RETURNS TABLE (grievance_id bigint, grievance_number text, category_name text, subject text, priority text, status text, submitted_at timestamptz, resolved_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT g.grievance_id::bigint, g.grievance_number::text, c.category_name::text, g.subject::text, g.priority::text, g.status::text, g.submitted_at, g.resolved_at
    FROM grievance g JOIN grievance_category c ON c.grievance_category_id = g.grievance_category_id
    WHERE g.student_id = sims_private.current_student_id() ORDER BY g.submitted_at DESC, g.grievance_id DESC
$$;

CREATE FUNCTION public.grievance_student_respond(p_grievance_id bigint, p_response text, p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_to text;
BEGIN
    SELECT grievance_id, student_id, status INTO v FROM grievance WHERE grievance_id = p_grievance_id FOR UPDATE;
    IF v IS NULL OR v.student_id IS DISTINCT FROM sims_private.current_student_id() THEN RAISE EXCEPTION 'Unknown grievance' USING ERRCODE = '42501'; END IF;
    IF p_response NOT IN ('CLOSE', 'REOPEN') THEN RAISE EXCEPTION 'The response must be CLOSE or REOPEN' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_notes, '')) > 2000 THEN RAISE EXCEPTION 'Notes are limited to 2000 characters' USING ERRCODE = '22023'; END IF;
    v_to := CASE p_response WHEN 'CLOSE' THEN 'CLOSED' ELSE 'UNDER_REVIEW' END;
    IF v.status = v_to AND p_response = 'CLOSE' THEN RETURN; END IF; -- idempotent close
    IF p_response = 'CLOSE' AND v.status NOT IN ('RESOLVED', 'REJECTED') THEN RAISE EXCEPTION 'Only a resolved or rejected grievance can be closed' USING ERRCODE = '45000'; END IF;
    IF p_response = 'REOPEN' AND v.status <> 'RESOLVED' THEN RAISE EXCEPTION 'Only a resolved grievance can be re-opened' USING ERRCODE = '45000'; END IF;
    UPDATE grievance SET status = v_to, resolved_at = CASE WHEN v_to = 'UNDER_REVIEW' THEN NULL ELSE resolved_at END WHERE grievance_id = p_grievance_id;
    INSERT INTO grievance_action (grievance_id, action_type, action_notes, new_status) VALUES (p_grievance_id, 'STUDENT_' || p_response, NULLIF(btrim(p_notes), ''), v_to);
END $$;

-- ---------------------------------------------------------------
-- Staff side
-- ---------------------------------------------------------------
CREATE FUNCTION public.grievance_list(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_priority text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (grievance_id bigint, grievance_number text, student_number text, student_name text, category_name text, subject text, priority text, status text, submitted_at timestamptz, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH visible AS (
        SELECT g.grievance_id, g.grievance_number::text, s.student_number::text, s.display_name::text AS student_name, c.category_name::text, g.subject::text, g.priority::text, g.status::text, g.submitted_at
        FROM grievance g JOIN student s ON s.student_id = g.student_id JOIN grievance_category c ON c.grievance_category_id = g.grievance_category_id
        WHERE (p_status IS NULL OR g.status = p_status) AND (p_priority IS NULL OR g.priority = p_priority)
          AND (p_search IS NULL OR btrim(p_search) = '' OR position(lower(btrim(p_search)) IN lower(g.grievance_number || ' ' || g.subject || ' ' || s.student_number || ' ' || s.display_name)) > 0)
          AND sims_private.can_student(ARRAY['GRIEVANCE.ALL.READ']::text[], g.student_id, true)
    )
    SELECT v.grievance_id::bigint, v.grievance_number, v.student_number, v.student_name, v.category_name, v.subject, v.priority, v.status, v.submitted_at, count(*) OVER ()
    FROM visible v ORDER BY CASE v.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, v.submitted_at, v.grievance_id LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- One grievance with its history. The owner sees everything except INTERNAL_NOTE actions; staff readers see all.
CREATE FUNCTION public.grievance_detail(p_grievance_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; v_owner boolean; v_staff boolean;
BEGIN
    SELECT gr.*, s.student_number AS snum, s.display_name AS sname, c.category_name AS cname, d.department_name AS dname INTO g
    FROM grievance gr JOIN student s ON s.student_id = gr.student_id JOIN grievance_category c ON c.grievance_category_id = gr.grievance_category_id
    LEFT JOIN department d ON d.department_id = gr.department_id WHERE gr.grievance_id = p_grievance_id;
    v_owner := COALESCE(g.student_id = sims_private.current_student_id(), false);
    v_staff := g.student_id IS NOT NULL AND sims_private.can_student(ARRAY['GRIEVANCE.ALL.READ']::text[], g.student_id, true);
    IF g.grievance_id IS NULL OR NOT (v_owner OR v_staff) THEN RAISE EXCEPTION 'Not authorised (GRIEVANCE.ALL.READ) or unknown grievance' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object(
        'grievance_id', g.grievance_id, 'grievance_number', g.grievance_number, 'student_number', g.snum, 'student_name', g.sname, 'category_name', g.cname, 'department_name', g.dname,
        'subject', g.subject, 'description', g.description, 'priority', g.priority, 'status', g.status, 'submitted_at', g.submitted_at, 'resolved_at', g.resolved_at, 'resolution', g.resolution,
        'is_owner', v_owner, 'can_act', sims_private.can_student(ARRAY['GRIEVANCE.ALL.UPDATE']::text[], g.student_id, true),
        'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('action_at', a.action_at, 'action_type', a.action_type, 'action_notes', a.action_notes, 'new_status', a.new_status) ORDER BY a.action_at, a.grievance_action_id)
                              FROM grievance_action a WHERE a.grievance_id = g.grievance_id AND (v_staff OR a.action_type <> 'INTERNAL_NOTE')), '[]'::jsonb));
END $$;

-- p_action_type: COMMENT (visible to the student), INTERNAL_NOTE (staff only) or STATUS_CHANGE (needs p_new_status).
CREATE FUNCTION public.grievance_act(p_grievance_id bigint, p_action_type text, p_notes text DEFAULT NULL, p_new_status text DEFAULT NULL, p_resolution text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_notes text := NULLIF(btrim(p_notes), ''); v_res text := NULLIF(btrim(p_resolution), '');
BEGIN
    SELECT grievance_id, student_id, status, resolution INTO v FROM grievance WHERE grievance_id = p_grievance_id FOR UPDATE;
    IF v IS NULL OR NOT sims_private.can_student(ARRAY['GRIEVANCE.ALL.UPDATE']::text[], v.student_id, true) THEN
        RAISE EXCEPTION 'Not authorised (GRIEVANCE.ALL.UPDATE) or unknown grievance' USING ERRCODE = '42501';
    END IF;
    IF p_action_type NOT IN ('COMMENT', 'INTERNAL_NOTE', 'STATUS_CHANGE') THEN RAISE EXCEPTION 'Invalid action type' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_notes, '')) > 2000 OR length(COALESCE(v_res, '')) > 5000 THEN RAISE EXCEPTION 'Text is too long' USING ERRCODE = '22023'; END IF;
    IF p_action_type <> 'STATUS_CHANGE' THEN
        IF v_notes IS NULL THEN RAISE EXCEPTION 'A note is required' USING ERRCODE = '22023'; END IF;
        IF p_new_status IS NOT NULL THEN RAISE EXCEPTION 'Only a STATUS_CHANGE action changes the status' USING ERRCODE = '22023'; END IF;
        IF v.status = 'CLOSED' THEN RAISE EXCEPTION 'The grievance is CLOSED' USING ERRCODE = '45000'; END IF;
        INSERT INTO grievance_action (grievance_id, action_type, action_notes) VALUES (p_grievance_id, p_action_type, v_notes);
        RETURN;
    END IF;
    IF p_new_status IS NULL THEN RAISE EXCEPTION 'A new status is required' USING ERRCODE = '22023'; END IF;
    IF v.status = p_new_status THEN RETURN; END IF; -- idempotent replay
    IF NOT sims_private.grievance_transition_ok(v.status, p_new_status) THEN RAISE EXCEPTION 'A % grievance cannot become %', v.status, p_new_status USING ERRCODE = '45000'; END IF;
    IF p_new_status IN ('RESOLVED', 'REJECTED') AND v_res IS NULL THEN RAISE EXCEPTION 'A resolution text is required' USING ERRCODE = '22023'; END IF;
    UPDATE grievance SET status = p_new_status,
        resolved_at = CASE WHEN p_new_status IN ('RESOLVED', 'REJECTED') THEN now() WHEN p_new_status = 'UNDER_REVIEW' THEN NULL ELSE resolved_at END,
        resolution = CASE WHEN p_new_status IN ('RESOLVED', 'REJECTED') THEN v_res ELSE resolution END WHERE grievance_id = p_grievance_id;
    INSERT INTO grievance_action (grievance_id, action_type, action_notes, new_status) VALUES (p_grievance_id, 'STATUS_CHANGE', v_notes, p_new_status);
END $$;

REVOKE ALL ON FUNCTION public.grievance_submit(integer, integer, text, text, text), public.grievance_my(), public.grievance_student_respond(bigint, text, text),
    public.grievance_list(text, text, text, integer, integer), public.grievance_detail(bigint), public.grievance_act(bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grievance_submit(integer, integer, text, text, text), public.grievance_my(), public.grievance_student_respond(bigint, text, text),
    public.grievance_list(text, text, text, integer, integer), public.grievance_detail(bigint), public.grievance_act(bigint, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION sims_private.grievance_transition_ok(text, text) FROM PUBLIC, anon;
