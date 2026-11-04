-- Timetable. Hand-written (not from the MySQL source).
--
-- The source defines a weekly recurring timetable (timetable_session) with one unique key (day, slot, room, effective_from) and nothing
-- else. The rules below are INFERENCES, documented in KNOWN_ISSUES KI-43:
--  1  effective_to >= effective_from.
--  2  the time slot must be active and not a break; the room must be active and in the slot's campus.
--  3  the instructor assignment must belong to the same teaching section and be ACTIVE.
--  4  no double booking: two entries on the same day whose effective periods overlap and whose slots overlap in time (back to back is
--     allowed) must not share a room, an instructor (employee) or a teaching section. Checked under advisory locks.
--  5  student-group clashes (a student registered in two overlapping sections) are NOT checked.
-- Entries are written directly under RLS (TIMETABLE.ALL.*); this guard runs as SECURITY DEFINER so that clashes with entries the caller
-- cannot see are still caught. Class sessions are generated from the timetable by timetable_generate_sessions().

CREATE FUNCTION sims_timetable_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_slot record; v_room record; v_fa record; v_emp bigint; v_to date := COALESCE(NEW.effective_to, 'infinity'::date);
BEGIN
    IF NEW.effective_to IS NOT NULL AND NEW.effective_to < NEW.effective_from THEN
        RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = '45000';
    END IF;

    SELECT campus_id, start_time, end_time, is_break, is_active INTO v_slot FROM time_slot WHERE time_slot_id = NEW.time_slot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown time slot' USING ERRCODE = '23503'; END IF;
    IF v_slot.is_break THEN RAISE EXCEPTION 'A break slot cannot hold a class' USING ERRCODE = '45000'; END IF;
    IF NOT v_slot.is_active THEN RAISE EXCEPTION 'The time slot is inactive' USING ERRCODE = '45000'; END IF;

    IF NEW.room_id IS NOT NULL THEN
        SELECT b.campus_id, r.is_active INTO v_room FROM room r JOIN building b ON b.building_id = r.building_id WHERE r.room_id = NEW.room_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Unknown room' USING ERRCODE = '23503'; END IF;
        IF NOT v_room.is_active THEN RAISE EXCEPTION 'The room is inactive' USING ERRCODE = '45000'; END IF;
        IF v_room.campus_id <> v_slot.campus_id THEN RAISE EXCEPTION 'The room is on a different campus from the time slot' USING ERRCODE = '45000'; END IF;
    END IF;

    IF NEW.faculty_assignment_id IS NOT NULL THEN
        SELECT course_offering_section_id, employee_id, assignment_status INTO v_fa FROM faculty_course_assignment WHERE faculty_assignment_id = NEW.faculty_assignment_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Unknown instructor assignment' USING ERRCODE = '23503'; END IF;
        IF v_fa.course_offering_section_id <> NEW.course_offering_section_id THEN
            RAISE EXCEPTION 'The instructor assignment belongs to a different teaching section' USING ERRCODE = '45000';
        END IF;
        IF v_fa.assignment_status <> 'ACTIVE' THEN RAISE EXCEPTION 'The instructor assignment is not ACTIVE' USING ERRCODE = '45000'; END IF;
        v_emp := v_fa.employee_id;
    END IF;

    -- Fixed lock order (room, instructor, section) so concurrent writers cannot deadlock.
    IF NEW.room_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('tt:room:' || NEW.room_id, 0)); END IF;
    IF v_emp IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('tt:emp:' || v_emp, 0)); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('tt:cos:' || NEW.course_offering_section_id, 0));

    IF NEW.room_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM timetable_session t JOIN time_slot s ON s.time_slot_id = t.time_slot_id
        WHERE t.room_id = NEW.room_id AND t.day_of_week = NEW.day_of_week AND t.timetable_session_id IS DISTINCT FROM NEW.timetable_session_id
          AND t.effective_from <= v_to AND COALESCE(t.effective_to, 'infinity'::date) >= NEW.effective_from
          AND s.start_time < v_slot.end_time AND s.end_time > v_slot.start_time) THEN
        RAISE EXCEPTION 'The room is already booked at that time' USING ERRCODE = '45000';
    END IF;

    IF v_emp IS NOT NULL AND EXISTS (
        SELECT 1 FROM timetable_session t JOIN time_slot s ON s.time_slot_id = t.time_slot_id
        JOIN faculty_course_assignment fa ON fa.faculty_assignment_id = t.faculty_assignment_id
        WHERE fa.employee_id = v_emp AND t.day_of_week = NEW.day_of_week AND t.timetable_session_id IS DISTINCT FROM NEW.timetable_session_id
          AND t.effective_from <= v_to AND COALESCE(t.effective_to, 'infinity'::date) >= NEW.effective_from
          AND s.start_time < v_slot.end_time AND s.end_time > v_slot.start_time) THEN
        RAISE EXCEPTION 'The instructor already teaches at that time' USING ERRCODE = '45000';
    END IF;

    IF EXISTS (
        SELECT 1 FROM timetable_session t JOIN time_slot s ON s.time_slot_id = t.time_slot_id
        WHERE t.course_offering_section_id = NEW.course_offering_section_id AND t.day_of_week = NEW.day_of_week AND t.timetable_session_id IS DISTINCT FROM NEW.timetable_session_id
          AND t.effective_from <= v_to AND COALESCE(t.effective_to, 'infinity'::date) >= NEW.effective_from
          AND s.start_time < v_slot.end_time AND s.end_time > v_slot.start_time) THEN
        RAISE EXCEPTION 'This teaching section already has a class at that time' USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_timetable_session_guard BEFORE INSERT OR UPDATE ON timetable_session FOR EACH ROW EXECUTE FUNCTION sims_timetable_guard();

CREATE TRIGGER trg_timetable_session_audit AFTER INSERT OR UPDATE OR DELETE ON timetable_session
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('TIMETABLE', 'timetable_session_id');

-- ---------------------------------------------------------------
-- Class sessions from the timetable
-- ---------------------------------------------------------------
-- Creates a PLANNED class_session for every date in [p_from, p_to] on which an entry of the section applies. Existing sessions (same
-- section, date and start time) are left alone, so the call is idempotent. Returns the number of sessions created.
CREATE FUNCTION public.timetable_generate_sessions(p_cos_id bigint, p_from date, p_to date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
    PERFORM sims_private.att_authorize_cos(p_cos_id, 'ATTENDANCE', 'CREATE');
    PERFORM sims_private.att_authorize_cos(p_cos_id, 'TIMETABLE', 'READ');
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Give a valid date range' USING ERRCODE = '22023'; END IF;
    IF p_to - p_from > 366 THEN RAISE EXCEPTION 'Generate at most 367 days at a time' USING ERRCODE = '22023'; END IF;

    INSERT INTO class_session (course_offering_section_id, faculty_assignment_id, timetable_session_id, session_date, start_time, end_time, room_id, session_type, session_status)
    SELECT t.course_offering_section_id, t.faculty_assignment_id, t.timetable_session_id, d::date, s.start_time, s.end_time, t.room_id, cos.session_type, 'PLANNED'
    FROM timetable_session t
    JOIN time_slot s ON s.time_slot_id = t.time_slot_id
    JOIN course_offering_section cos ON cos.course_offering_section_id = t.course_offering_section_id
    CROSS JOIN LATERAL generate_series(GREATEST(p_from, t.effective_from), LEAST(p_to, COALESCE(t.effective_to, p_to)), interval '1 day') d
    WHERE t.course_offering_section_id = p_cos_id AND extract(isodow FROM d)::int = t.day_of_week
    ON CONFLICT ON CONSTRAINT uq_class_session DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- ---------------------------------------------------------------
-- Read helpers: timetable staff need not hold TEACHING / REGISTRATION / INSTITUTION / ACADEMIC_CALENDAR / EMPLOYEE read access
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.tt_can_read_pto(p_pto bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT sims_private.can_programme(ARRAY['TIMETABLE.ALL.READ']::text[], pto.programme_id) FROM public.programme_term_offering pto WHERE pto.programme_term_offering_id = p_pto), false)
$$;

CREATE FUNCTION public.timetable_offerings(p_term bigint DEFAULT NULL, p_programme integer DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (programme_term_offering_id bigint, term_name text, programme_name text, semester_name text, section_count bigint, entry_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH visible AS (
        SELECT pto.programme_term_offering_id, t.term_name::text, p.programme_name::text, s.semester_name::text,
               (SELECT count(*) FROM course_offering_section c WHERE c.programme_term_offering_id = pto.programme_term_offering_id) AS section_count,
               (SELECT count(*) FROM timetable_session x JOIN course_offering_section c ON c.course_offering_section_id = x.course_offering_section_id WHERE c.programme_term_offering_id = pto.programme_term_offering_id) AS entry_count
        FROM programme_term_offering pto
        JOIN academic_term t ON t.academic_term_id = pto.academic_term_id
        JOIN programme p ON p.programme_id = pto.programme_id
        JOIN semester s ON s.semester_id = pto.semester_id
        WHERE (p_term IS NULL OR pto.academic_term_id = p_term) AND (p_programme IS NULL OR pto.programme_id = p_programme)
          AND sims_private.can_programme(ARRAY['TIMETABLE.ALL.READ']::text[], pto.programme_id)
    )
    SELECT v.programme_term_offering_id, v.term_name, v.programme_name, v.semester_name, v.section_count, v.entry_count, count(*) OVER ()
    FROM visible v ORDER BY v.programme_term_offering_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

CREATE FUNCTION public.timetable_offering_info(p_pto bigint) RETURNS TABLE (programme_term_offering_id bigint, term_name text, programme_name text, semester_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.tt_can_read_pto(p_pto) THEN RAISE EXCEPTION 'Not authorised (TIMETABLE.ALL.READ) or unknown offering' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT pto.programme_term_offering_id::bigint, t.term_name::text, p.programme_name::text, s.semester_name::text
    FROM programme_term_offering pto JOIN academic_term t ON t.academic_term_id = pto.academic_term_id JOIN programme p ON p.programme_id = pto.programme_id JOIN semester s ON s.semester_id = pto.semester_id
    WHERE pto.programme_term_offering_id = p_pto;
END $$;

-- Teaching sections of the programme-term offering, with labels (for the entry form and the grid).
CREATE FUNCTION public.timetable_sections(p_pto bigint)
RETURNS TABLE (course_offering_section_id bigint, course_label text, section_code text, batch_code text, session_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.tt_can_read_pto(p_pto) THEN RAISE EXCEPTION 'Not authorised (TIMETABLE.ALL.READ) or unknown offering' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    SELECT cos.course_offering_section_id::bigint, (c.course_code || ' — ' || c.course_title)::text, cs.section_code::text, b.batch_code::text, cos.session_type::text
    FROM course_offering_section cos
    JOIN course_offering co ON co.course_offering_id = cos.course_offering_id
    JOIN course_catalog c ON c.course_id = co.course_id
    JOIN class_section cs ON cs.class_section_id = cos.class_section_id
    LEFT JOIN class_batch b ON b.class_batch_id = cos.class_batch_id
    WHERE cos.programme_term_offering_id = p_pto
    ORDER BY c.course_code, cs.section_code, b.batch_code NULLS FIRST, cos.session_type;
END $$;

-- Instructor assignments of one teaching section (ACTIVE ones can be placed on the timetable).
CREATE FUNCTION public.timetable_assignments(p_cos_id bigint)
RETURNS TABLE (faculty_assignment_id bigint, employee_name text, assignment_role text, assignment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM sims_private.att_authorize_cos(p_cos_id, 'TIMETABLE', 'READ');
    RETURN QUERY
    SELECT fa.faculty_assignment_id::bigint, e.display_name::text, fa.assignment_role::text, fa.assignment_status::text
    FROM faculty_course_assignment fa JOIN employee e ON e.employee_id = fa.employee_id
    WHERE fa.course_offering_section_id = p_cos_id ORDER BY e.display_name, fa.faculty_assignment_id;
END $$;

-- The programme-term offering's weekly entries.
CREATE FUNCTION public.timetable_entries(p_pto bigint)
RETURNS TABLE (timetable_session_id bigint, course_offering_section_id bigint, course_label text, section_code text, batch_code text, session_type text, instructor_name text,
               day_of_week integer, time_slot_id integer, slot_code text, start_time time, end_time time, room_id bigint, room_label text, effective_from date, effective_to date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.tt_can_read_pto(p_pto) THEN RAISE EXCEPTION 'Not authorised (TIMETABLE.ALL.READ) or unknown offering' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    SELECT t.timetable_session_id::bigint, cos.course_offering_section_id::bigint, (c.course_code || ' — ' || c.course_title)::text, cs.section_code::text, b.batch_code::text, cos.session_type::text,
           e.display_name::text, t.day_of_week::integer, t.time_slot_id::integer, s.slot_code::text, s.start_time, s.end_time, t.room_id::bigint,
           (bl.building_code || '-' || r.room_code)::text, t.effective_from, t.effective_to
    FROM timetable_session t
    JOIN course_offering_section cos ON cos.course_offering_section_id = t.course_offering_section_id
    JOIN course_offering co ON co.course_offering_id = cos.course_offering_id
    JOIN course_catalog c ON c.course_id = co.course_id
    JOIN class_section cs ON cs.class_section_id = cos.class_section_id
    LEFT JOIN class_batch b ON b.class_batch_id = cos.class_batch_id
    JOIN time_slot s ON s.time_slot_id = t.time_slot_id
    LEFT JOIN room r ON r.room_id = t.room_id
    LEFT JOIN building bl ON bl.building_id = r.building_id
    LEFT JOIN faculty_course_assignment fa ON fa.faculty_assignment_id = t.faculty_assignment_id
    LEFT JOIN employee e ON e.employee_id = fa.employee_id
    WHERE cos.programme_term_offering_id = p_pto
    ORDER BY t.day_of_week, s.start_time, c.course_code, cs.section_code;
END $$;

-- Slots and rooms of the campuses where the caller may read or write the timetable.
CREATE FUNCTION public.timetable_slots() RETURNS TABLE (time_slot_id integer, campus_id integer, campus_name text, slot_code text, start_time time, end_time time, is_break boolean, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT s.time_slot_id::integer, s.campus_id::integer, c.campus_name::text, s.slot_code::text, s.start_time, s.end_time, s.is_break, s.is_active
    FROM time_slot s JOIN campus c ON c.campus_id = s.campus_id
    WHERE sims_private.can_campus(ARRAY['TIMETABLE.ALL.READ']::text[], s.campus_id)
    ORDER BY c.campus_name, s.start_time
$$;

CREATE FUNCTION public.timetable_rooms() RETURNS TABLE (room_id bigint, campus_id integer, campus_name text, room_label text, room_type text, capacity integer, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.room_id::bigint, b.campus_id::integer, c.campus_name::text, (b.building_code || '-' || r.room_code)::text, r.room_type::text, r.capacity::integer, r.is_active
    FROM room r JOIN building b ON b.building_id = r.building_id JOIN campus c ON c.campus_id = b.campus_id
    WHERE sims_private.can_campus(ARRAY['TIMETABLE.ALL.READ']::text[], b.campus_id)
    ORDER BY c.campus_name, b.building_code, r.room_code
$$;

REVOKE ALL ON FUNCTION public.timetable_generate_sessions(bigint, date, date), public.timetable_offerings(bigint, integer, integer, integer), public.timetable_offering_info(bigint),
    public.timetable_sections(bigint), public.timetable_assignments(bigint), public.timetable_entries(bigint), public.timetable_slots(), public.timetable_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timetable_generate_sessions(bigint, date, date), public.timetable_offerings(bigint, integer, integer, integer), public.timetable_offering_info(bigint),
    public.timetable_sections(bigint), public.timetable_assignments(bigint), public.timetable_entries(bigint), public.timetable_slots(), public.timetable_rooms() TO authenticated;
