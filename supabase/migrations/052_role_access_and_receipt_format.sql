-- Role-based access completion and receipt numbering. Hand-written (not from the MySQL source).
--
-- DECISIONS (owner answers D-5 and D-9; the owner said "use your defaults"):
--  1  Students may read their own fee assessments and payments/receipts (FEES.FEE_ASSESSMENT.READ and FEES.FEE_PAYMENT.READ at SELF scope; the existing row-level policies resolve this through can_student).
--  2  SUPER_ADMIN gets READ and EXPORT on every FEES resource plus CONFIGURE on FEE_STRUCTURE (so it can maintain fee reference lists). It gets no money-moving permission (create, update, approve, delete, verify).
--  3  Oversight roles (VICE_CHANCELLOR, INTERNAL_AUDITOR, EXTERNAL_AUDITOR) get read access to fee data (auditors and the VC may also export, the external auditor may not).
--  4  GRIEVANCE_OFFICER, which held no permission at all, gets GRIEVANCE READ / UPDATE / EXPORT, so it is the grievance handler role (KI-50).
--  5  Receipt numbers become REC/<academic year>/<6-digit sequence> (e.g. REC/2026-27/000123). The academic year runs April to March and the sequence restarts each academic year (counter table below).
-- DATABASE_ADMIN deliberately holds no application permission: it is a technical role that needs no business data.

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r CROSS JOIN permission p
WHERE r.role_code = 'STUDENT' AND p.permission_code IN ('FEES.FEE_ASSESSMENT.READ', 'FEES.FEE_PAYMENT.READ')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code = 'SUPER_ADMIN' AND p.permission_code LIKE 'FEES.%'
  AND (aa.action_code IN ('READ', 'EXPORT') OR p.permission_code = 'FEES.FEE_STRUCTURE.CONFIGURE')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE p.permission_code LIKE 'FEES.%'
  AND ((r.role_code IN ('VICE_CHANCELLOR', 'INTERNAL_AUDITOR') AND aa.action_code IN ('READ', 'EXPORT'))
    OR (r.role_code = 'EXTERNAL_AUDITOR' AND aa.action_code = 'READ'))
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r CROSS JOIN permission p
JOIN access_action aa ON aa.access_action_id = p.access_action_id
WHERE r.role_code = 'GRIEVANCE_OFFICER' AND p.permission_code LIKE 'GRIEVANCE.%'
  AND aa.action_code IN ('READ', 'UPDATE', 'EXPORT')
ON CONFLICT DO NOTHING;

-- receipt numbering (replaces the RCP-<year> rule of migration 047; same signature, so the callers are unchanged)
CREATE TABLE sims_private.receipt_counter (academic_year text PRIMARY KEY, last_number integer NOT NULL);
REVOKE ALL ON sims_private.receipt_counter FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sims_private.fin_next_receipt_number() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE y integer := extract(year FROM now())::integer; m integer := extract(month FROM now())::integer; ay text; n integer;
BEGIN
    IF m < 4 THEN y := y - 1; END IF;
    ay := y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0');
    INSERT INTO sims_private.receipt_counter AS c (academic_year, last_number) VALUES (ay, 1)
    ON CONFLICT (academic_year) DO UPDATE SET last_number = c.last_number + 1 RETURNING c.last_number INTO n;
    RETURN 'REC/' || ay || '/' || lpad(n::text, 6, '0');
END $$;
REVOKE ALL ON FUNCTION sims_private.fin_next_receipt_number() FROM PUBLIC, anon, authenticated;
