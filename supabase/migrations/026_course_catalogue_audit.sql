-- Course catalogue: audit trail. Hand-written (not from the MySQL source).
-- Authorisation is unchanged (migration 018):
--   course_category            global reference data       -> global CURRICULUM.ALL.CONFIGURE
--   course_catalog             anchored to owning department -> CURRICULUM.ALL.* at department scope
--   curriculum_course          anchored to the scheme's programme
--   course_prerequisite        anchored to the course's department
-- NOT enforced (not stated in the source): prevention of prerequisite cycles (A requires B requires A). See KNOWN_ISSUES KI-26.
CREATE TRIGGER trg_course_category_audit AFTER INSERT OR UPDATE OR DELETE ON course_category
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('CURRICULUM', 'course_category_id');
CREATE TRIGGER trg_course_catalog_audit AFTER INSERT OR UPDATE OR DELETE ON course_catalog
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('CURRICULUM', 'course_id');
CREATE TRIGGER trg_curriculum_course_audit AFTER INSERT OR UPDATE OR DELETE ON curriculum_course
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('CURRICULUM', 'curriculum_course_id');
CREATE TRIGGER trg_course_prerequisite_audit AFTER INSERT OR UPDATE OR DELETE ON course_prerequisite
    FOR EACH ROW EXECUTE FUNCTION sims_private.audit_row('CURRICULUM', 'course_id');
