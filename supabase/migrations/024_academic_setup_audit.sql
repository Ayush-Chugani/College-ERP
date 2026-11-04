-- Academic setup: audit trail for calendar and curriculum-scheme changes. Hand-written (not from the MySQL source).
-- Authorisation is unchanged and comes from migration 018:
--   academic_year / academic_term / semester are global reference data -> writes need a GLOBAL ACADEMIC_CALENDAR.ALL.CONFIGURE grant;
--   curriculum_scheme is anchored to its programme -> CURRICULUM.ALL.CREATE/UPDATE/DELETE at the programme's scope.
CREATE TRIGGER trg_academic_year_audit AFTER INSERT OR UPDATE OR DELETE ON academic_year
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ACADEMIC_CALENDAR', 'academic_year_id');
CREATE TRIGGER trg_academic_term_audit AFTER INSERT OR UPDATE OR DELETE ON academic_term
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ACADEMIC_CALENDAR', 'academic_term_id');
CREATE TRIGGER trg_semester_audit AFTER INSERT OR UPDATE OR DELETE ON semester
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('ACADEMIC_CALENDAR', 'semester_id');
CREATE TRIGGER trg_curriculum_scheme_audit AFTER INSERT OR UPDATE OR DELETE ON curriculum_scheme
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('CURRICULUM', 'curriculum_scheme_id');
