-- Employee identity numbers (PAN, Aadhaar), bank accounts and HR documents. Hand-written (not from the MySQL source). Closes KI-8 and the employee part of KI-58/KI-53.
--
-- DECISIONS (owner answers D-7; "use your defaults"):
--  * The numbers are encrypted in the database with pgcrypto (pgp_sym_encrypt) under a key kept in Supabase Vault (secret 'sims_pii_key', created below if missing, 256 random bits).
--    Application roles can never read the key or the ciphertext columns; only the RPCs below (SECURITY DEFINER) can, and they return masked values. The only way to see a full number
--    is emp_sensitive_reveal, which needs the EXPORT permission (or ownership), a stated purpose for non-owners, and writes employee_sensitive_access_audit (action DECRYPT, no value).
--  * The unique fingerprint is a keyed HMAC-SHA256 of the normalised number, so a number cannot be registered for two employees and the fingerprint cannot be brute forced without the key.
--  * HR documents use the same workflow as student documents (private bucket, signed URLs, logged downloads) under the prefix employee/<id>/.
--
-- ASSUMPTIONS (KNOWN_ISSUES KI-8 closing note, KI-65):
--  1  PAN: AAAAA9999A, 4th letter one of P C H F A T B L J G. Aadhaar: 12 digits, first digit 2-9, Verhoeff check digit valid; the collection purpose is required (consent). Bank: account number 9 to 18
--     digits, entered twice, IFSC AAAA0AAAAAA; at most one primary account per employee.
--  2  The employee can submit and correct their own numbers while the record is PENDING or REJECTED; once VERIFIED only staff with UPDATE can change it. Any change to a number resets the
--     verification to PENDING. Verification needs EMPLOYEE.<resource>.VERIFY and someone other than the person who last changed the record.
--  3  Key rotation is not automated: rotate by creating a new secret, re-encrypting with a one-off script and swapping the name (KI-65).
--  4  Documents: scope EMPLOYEE_GENERAL only (qualification/experience/identity-linked scopes stay with the sections that own them). Review needs EMPLOYEE.EMPLOYEE_DOCUMENT.VERIFY (and .APPROVE when the
--     category requires approval), by someone other than the uploader. A VERIFIED document cannot be deleted. No versioning UI (the version_number column stays 1).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sims_pii_key') THEN
        PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sims_pii_key', 'Encrypts employee PAN, Aadhaar and bank account numbers');
    END IF;
END $$;

CREATE FUNCTION sims_private.pii_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sims_pii_key' $$;
CREATE FUNCTION sims_private.pii_encrypt(p text) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp AS $$ SELECT extensions.pgp_sym_encrypt(p, sims_private.pii_key()) $$;
CREATE FUNCTION sims_private.pii_decrypt(p bytea) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp AS $$ SELECT extensions.pgp_sym_decrypt(p, sims_private.pii_key()) $$;
CREATE FUNCTION sims_private.pii_fingerprint(p text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp AS $$ SELECT encode(extensions.hmac(p, sims_private.pii_key(), 'sha256'), 'hex') $$;
REVOKE ALL ON FUNCTION sims_private.pii_key(), sims_private.pii_encrypt(text), sims_private.pii_decrypt(bytea), sims_private.pii_fingerprint(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sims_private.verhoeff_valid(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    d integer[] := ARRAY[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
    pm integer[] := ARRAY[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
    c integer := 0; i integer; n integer := length(p);
BEGIN
    IF p !~ '^[0-9]+$' THEN RETURN false; END IF;
    FOR i IN 0..n - 1 LOOP
        c := d[c + 1][pm[(i % 8) + 1][substr(p, n - i, 1)::integer + 1] + 1];
    END LOOP;
    RETURN c = 0;
END $$;

-- ---------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------
CREATE FUNCTION sims_private.emp_is_owner(p_emp bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT COALESCE(p_emp = sims_private.current_employee_id(), false) $$;

CREATE FUNCTION sims_private.emp_can(p_emp bigint, p_resource text, p_action text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p_emp IS NOT NULL AND sims_private.can_employee(ARRAY['EMPLOYEE.' || p_resource || '.' || p_action]::text[], p_emp, p_write)
$$;

CREATE FUNCTION sims_private.emp_sensitive_log(p_emp bigint, p_action text, p_entity text, p_id bigint, p_purpose text, p_doc bigint DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO employee_sensitive_access_audit (user_id, employee_id, action_code, entity_type, entity_id, employee_document_id, access_purpose)
    VALUES (sims_private.current_user_id(), p_emp, p_action, p_entity, p_id, p_doc, left(p_purpose, 500))
$$;
REVOKE ALL ON FUNCTION sims_private.verhoeff_valid(text), sims_private.emp_is_owner(bigint), sims_private.emp_can(bigint, text, text, boolean), sims_private.emp_sensitive_log(bigint, text, text, bigint, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sims_private.verhoeff_valid(text), sims_private.emp_is_owner(bigint), sims_private.emp_can(bigint, text, text, boolean) TO authenticated;

-- may the caller write this resource of this employee? Owners only while the record is PENDING/REJECTED (or absent).
CREATE FUNCTION sims_private.emp_write_allowed(p_emp bigint, p_resource text, p_existing_status text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_emp IS NULL OR NOT EXISTS (SELECT 1 FROM employee WHERE employee_id = p_emp) THEN RAISE EXCEPTION 'Not authorised or unknown employee' USING ERRCODE = '42501'; END IF;
    IF sims_private.emp_can(p_emp, p_resource, CASE WHEN p_existing_status IS NULL THEN 'CREATE' ELSE 'UPDATE' END, true) THEN RETURN; END IF;
    IF sims_private.emp_is_owner(p_emp) THEN
        IF p_existing_status IS NULL OR p_existing_status IN ('PENDING', 'PENDING_VERIFICATION', 'REJECTED') THEN RETURN; END IF;
        RAISE EXCEPTION 'A verified record can only be changed by HR' USING ERRCODE = '45000';
    END IF;
    RAISE EXCEPTION 'Not authorised (EMPLOYEE.%.%) or unknown employee', p_resource, CASE WHEN p_existing_status IS NULL THEN 'CREATE' ELSE 'UPDATE' END USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION sims_private.emp_write_allowed(bigint, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- PAN
-- ---------------------------------------------------------------
CREATE FUNCTION public.emp_pan_save(p_employee_id bigint, p_pan text, p_name text, p_issue_date date DEFAULT NULL, p_remarks text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pan text := upper(regexp_replace(COALESCE(p_pan, ''), '\s', '', 'g')); v_ex record; v_fp text; v_id bigint; v_other bigint;
BEGIN
    SELECT employee_pan_id, verification_status, pan_number_fingerprint INTO v_ex FROM employee_pan WHERE employee_id = p_employee_id FOR UPDATE;
    PERFORM sims_private.emp_write_allowed(p_employee_id, 'PAN', v_ex.verification_status);
    IF v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' OR substr(v_pan, 4, 1) NOT IN ('P','C','H','F','A','T','B','L','J','G') THEN RAISE EXCEPTION 'Enter a valid PAN (for example ABCPE1234F)' USING ERRCODE = '22023'; END IF;
    IF p_name IS NULL OR btrim(p_name) = '' OR length(p_name) > 200 THEN RAISE EXCEPTION 'The name as on the PAN card is required' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_remarks, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    v_fp := sims_private.pii_fingerprint(v_pan);
    SELECT employee_id INTO v_other FROM employee_pan WHERE pan_number_fingerprint = v_fp AND employee_id <> p_employee_id;
    IF FOUND THEN RAISE EXCEPTION 'That PAN is already registered for another employee' USING ERRCODE = '23505'; END IF;
    IF v_ex.employee_pan_id IS NULL THEN
        INSERT INTO employee_pan (employee_id, pan_number_ciphertext, pan_number_fingerprint, pan_number_masked, name_as_per_pan, pan_issue_date, format_validated, remarks, created_by_user_id, updated_by_user_id)
        VALUES (p_employee_id, sims_private.pii_encrypt(v_pan), v_fp, 'XXXXX' || substr(v_pan, 6), btrim(p_name), p_issue_date, true, p_remarks, sims_private.current_user_id(), sims_private.current_user_id())
        RETURNING employee_pan_id INTO v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'CREATE', 'PAN', v_id, NULL);
    ELSE
        v_id := v_ex.employee_pan_id;
        UPDATE employee_pan SET pan_number_ciphertext = CASE WHEN v_fp <> v_ex.pan_number_fingerprint THEN sims_private.pii_encrypt(v_pan) ELSE pan_number_ciphertext END, pan_number_fingerprint = v_fp,
               pan_number_masked = 'XXXXX' || substr(v_pan, 6), name_as_per_pan = btrim(p_name), pan_issue_date = p_issue_date, remarks = p_remarks, format_validated = true,
               verification_status = 'PENDING', verified_by_user_id = NULL, verified_at = NULL, verification_remarks = NULL, updated_by_user_id = sims_private.current_user_id()
         WHERE employee_pan_id = v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'UPDATE', 'PAN', v_id, NULL);
    END IF;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Aadhaar
-- ---------------------------------------------------------------
CREATE FUNCTION public.emp_aadhaar_save(p_employee_id bigint, p_aadhaar text, p_name text, p_purpose text, p_remarks text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v text := regexp_replace(COALESCE(p_aadhaar, ''), '[\s-]', '', 'g'); v_ex record; v_fp text; v_id bigint; v_other bigint;
BEGIN
    SELECT employee_aadhaar_id, verification_status, aadhaar_number_fingerprint INTO v_ex FROM employee_aadhaar WHERE employee_id = p_employee_id FOR UPDATE;
    PERFORM sims_private.emp_write_allowed(p_employee_id, 'AADHAAR', v_ex.verification_status);
    IF v !~ '^[2-9][0-9]{11}$' OR NOT sims_private.verhoeff_valid(v) THEN RAISE EXCEPTION 'Enter a valid 12-digit Aadhaar number' USING ERRCODE = '22023'; END IF;
    IF p_name IS NULL OR btrim(p_name) = '' OR length(p_name) > 200 THEN RAISE EXCEPTION 'The name as on the Aadhaar card is required' USING ERRCODE = '22023'; END IF;
    IF p_purpose IS NULL OR length(btrim(p_purpose)) < 5 OR length(p_purpose) > 500 THEN RAISE EXCEPTION 'State why the Aadhaar number is collected (5 to 500 characters)' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_remarks, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    v_fp := sims_private.pii_fingerprint(v);
    SELECT employee_id INTO v_other FROM employee_aadhaar WHERE aadhaar_number_fingerprint = v_fp AND employee_id <> p_employee_id;
    IF FOUND THEN RAISE EXCEPTION 'That Aadhaar number is already registered for another employee' USING ERRCODE = '23505'; END IF;
    IF v_ex.employee_aadhaar_id IS NULL THEN
        INSERT INTO employee_aadhaar (employee_id, aadhaar_number_ciphertext, aadhaar_number_fingerprint, aadhaar_number_last4, aadhaar_number_masked, name_as_per_aadhaar, format_validated, collection_purpose, remarks, created_by_user_id, updated_by_user_id)
        VALUES (p_employee_id, sims_private.pii_encrypt(v), v_fp, right(v, 4), 'XXXX XXXX ' || right(v, 4), btrim(p_name), true, btrim(p_purpose), p_remarks, sims_private.current_user_id(), sims_private.current_user_id())
        RETURNING employee_aadhaar_id INTO v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'CREATE', 'AADHAAR', v_id, p_purpose);
    ELSE
        v_id := v_ex.employee_aadhaar_id;
        UPDATE employee_aadhaar SET aadhaar_number_ciphertext = CASE WHEN v_fp <> v_ex.aadhaar_number_fingerprint THEN sims_private.pii_encrypt(v) ELSE aadhaar_number_ciphertext END, aadhaar_number_fingerprint = v_fp,
               aadhaar_number_last4 = right(v, 4), aadhaar_number_masked = 'XXXX XXXX ' || right(v, 4), name_as_per_aadhaar = btrim(p_name), collection_purpose = btrim(p_purpose), remarks = p_remarks, format_validated = true,
               verification_status = 'PENDING', verified_by_user_id = NULL, verified_at = NULL, verification_remarks = NULL, updated_by_user_id = sims_private.current_user_id()
         WHERE employee_aadhaar_id = v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'UPDATE', 'AADHAAR', v_id, p_purpose);
    END IF;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Bank accounts
-- ---------------------------------------------------------------
CREATE FUNCTION public.emp_bank_save(p_employee_id bigint, p_account_id bigint, p_holder text, p_bank text, p_branch text, p_account_number text, p_account_confirm text, p_ifsc text,
                                     p_type text DEFAULT 'SAVINGS', p_upi text DEFAULT NULL, p_is_primary boolean DEFAULT false, p_is_salary boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acc text := NULLIF(regexp_replace(COALESCE(p_account_number, ''), '\s', '', 'g'), ''); v_ifsc text := upper(btrim(COALESCE(p_ifsc, ''))); v_status text; v_fp text; v_id bigint; v_other bigint;
BEGIN
    IF p_account_id IS NOT NULL THEN
        SELECT account_status INTO v_status FROM employee_bank_account WHERE employee_bank_account_id = p_account_id AND employee_id = p_employee_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Not authorised or unknown bank account' USING ERRCODE = '42501'; END IF;
    END IF;
    PERFORM sims_private.emp_write_allowed(p_employee_id, 'BANK_ACCOUNT', v_status);
    IF p_holder IS NULL OR btrim(p_holder) = '' OR length(p_holder) > 200 OR p_bank IS NULL OR btrim(p_bank) = '' OR length(p_bank) > 200 OR length(COALESCE(p_branch, '')) > 200 THEN RAISE EXCEPTION 'The account holder and the bank name are required' USING ERRCODE = '22023'; END IF;
    IF v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'Enter a valid IFSC code (for example SBIN0001234)' USING ERRCODE = '22023'; END IF;
    IF p_type NOT IN ('SAVINGS','CURRENT','SALARY','NRE','NRO','OTHER') THEN RAISE EXCEPTION 'Unknown account type' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(p_upi, '')) > 150 THEN RAISE EXCEPTION 'The UPI id is too long' USING ERRCODE = '22023'; END IF;
    IF p_account_id IS NULL OR v_acc IS NOT NULL THEN
        IF v_acc IS NULL OR v_acc !~ '^[0-9]{9,18}$' THEN RAISE EXCEPTION 'Enter the account number (9 to 18 digits)' USING ERRCODE = '22023'; END IF;
        IF v_acc IS DISTINCT FROM NULLIF(regexp_replace(COALESCE(p_account_confirm, ''), '\s', '', 'g'), '') THEN RAISE EXCEPTION 'The two account numbers do not match' USING ERRCODE = '22023'; END IF;
        v_fp := sims_private.pii_fingerprint(v_acc);
        SELECT employee_bank_account_id INTO v_other FROM employee_bank_account WHERE account_number_fingerprint = v_fp AND employee_bank_account_id IS DISTINCT FROM p_account_id;
        IF FOUND THEN RAISE EXCEPTION 'That account number is already registered' USING ERRCODE = '23505'; END IF;
    END IF;
    IF p_is_primary THEN UPDATE employee_bank_account SET is_primary = false WHERE employee_id = p_employee_id AND is_primary AND employee_bank_account_id IS DISTINCT FROM p_account_id; END IF;
    IF p_account_id IS NULL THEN
        INSERT INTO employee_bank_account (employee_id, account_holder_name, bank_name, branch_name, account_number_ciphertext, account_number_fingerprint, account_number_last4, account_number_confirmed, account_type, ifsc_code, upi_id,
                                           is_salary_account, is_primary, created_by_user_id, updated_by_user_id)
        VALUES (p_employee_id, btrim(p_holder), btrim(p_bank), NULLIF(btrim(p_branch), ''), sims_private.pii_encrypt(v_acc), v_fp, right(v_acc, 4), true, p_type, v_ifsc, NULLIF(btrim(p_upi), ''), p_is_salary, p_is_primary,
                sims_private.current_user_id(), sims_private.current_user_id())
        RETURNING employee_bank_account_id INTO v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'CREATE', 'BANK_ACCOUNT', v_id, NULL);
    ELSE
        v_id := p_account_id;
        UPDATE employee_bank_account SET account_holder_name = btrim(p_holder), bank_name = btrim(p_bank), branch_name = NULLIF(btrim(p_branch), ''), account_type = p_type, ifsc_code = v_ifsc, upi_id = NULLIF(btrim(p_upi), ''),
               is_salary_account = p_is_salary, is_primary = p_is_primary, updated_by_user_id = sims_private.current_user_id(),
               account_number_ciphertext = CASE WHEN v_acc IS NOT NULL THEN sims_private.pii_encrypt(v_acc) ELSE account_number_ciphertext END,
               account_number_fingerprint = COALESCE(v_fp, account_number_fingerprint), account_number_last4 = COALESCE(right(v_acc, 4), account_number_last4),
               account_status = 'PENDING_VERIFICATION', verification_status = 'PENDING', verified_by_user_id = NULL, verified_at = NULL, verification_remarks = NULL
         WHERE employee_bank_account_id = v_id;
        PERFORM sims_private.emp_sensitive_log(p_employee_id, 'UPDATE', 'BANK_ACCOUNT', v_id, NULL);
    END IF;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------
-- Read (masked), review, reveal, delete
-- ---------------------------------------------------------------
CREATE FUNCTION public.emp_sensitive_list(p_employee_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_own boolean := sims_private.emp_is_owner(p_employee_id); r jsonb;
BEGIN
    IF NOT (v_own OR sims_private.emp_can(p_employee_id, 'PAN', 'READ', false) OR sims_private.emp_can(p_employee_id, 'AADHAAR', 'READ', false) OR sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'READ', false)) THEN
        RAISE EXCEPTION 'Not authorised (EMPLOYEE.PAN.READ) or unknown employee' USING ERRCODE = '42501';
    END IF;
    r := jsonb_build_object(
      'pan', CASE WHEN v_own OR sims_private.emp_can(p_employee_id, 'PAN', 'READ', false) THEN (SELECT to_jsonb(x) FROM (SELECT employee_pan_id AS id, pan_number_masked AS masked, name_as_per_pan AS name, verification_status AS status, verification_remarks AS remarks, pan_issue_date AS issue_date, updated_at FROM employee_pan WHERE employee_id = p_employee_id) x) END,
      'aadhaar', CASE WHEN v_own OR sims_private.emp_can(p_employee_id, 'AADHAAR', 'READ', false) THEN (SELECT to_jsonb(x) FROM (SELECT employee_aadhaar_id AS id, aadhaar_number_masked AS masked, name_as_per_aadhaar AS name, verification_status AS status, verification_remarks AS remarks, collection_purpose AS purpose, updated_at FROM employee_aadhaar WHERE employee_id = p_employee_id) x) END,
      'bank', CASE WHEN v_own OR sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'READ', false) THEN (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.is_primary DESC, x.id), '[]'::jsonb) FROM (SELECT employee_bank_account_id AS id, account_holder_name AS holder, bank_name AS bank, branch_name AS branch, 'XXXXXX' || account_number_last4 AS masked, account_type AS type, ifsc_code AS ifsc, upi_id AS upi, is_primary, is_salary_account AS is_salary, account_status AS account_status, verification_status AS status, verification_remarks AS remarks FROM employee_bank_account WHERE employee_id = p_employee_id AND deleted_at IS NULL) x) ELSE '[]'::jsonb END,
      'can', jsonb_build_object(
        'owner', v_own,
        'edit_pan', sims_private.emp_can(p_employee_id, 'PAN', 'UPDATE', true) OR v_own, 'edit_aadhaar', sims_private.emp_can(p_employee_id, 'AADHAAR', 'UPDATE', true) OR v_own, 'edit_bank', sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'UPDATE', true) OR v_own,
        'verify_pan', sims_private.emp_can(p_employee_id, 'PAN', 'VERIFY', true), 'verify_aadhaar', sims_private.emp_can(p_employee_id, 'AADHAAR', 'VERIFY', true), 'verify_bank', sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'VERIFY', true),
        'reveal_pan', v_own OR sims_private.emp_can(p_employee_id, 'PAN', 'EXPORT', true), 'reveal_aadhaar', v_own OR sims_private.emp_can(p_employee_id, 'AADHAAR', 'EXPORT', true), 'reveal_bank', v_own OR sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'EXPORT', true),
        'delete_pan', sims_private.emp_can(p_employee_id, 'PAN', 'DELETE', true), 'delete_aadhaar', sims_private.emp_can(p_employee_id, 'AADHAAR', 'DELETE', true), 'delete_bank', sims_private.emp_can(p_employee_id, 'BANK_ACCOUNT', 'DELETE', true)));
    RETURN r;
END $$;

-- kind: PAN | AADHAAR | BANK_ACCOUNT. Resolves the record, locking it.
CREATE FUNCTION sims_private.emp_sensitive_row(p_kind text, p_id bigint) RETURNS TABLE (employee_id bigint, status text, last_editor bigint, ciphertext bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_kind = 'PAN' THEN RETURN QUERY SELECT t.employee_id::bigint, t.verification_status::text, t.updated_by_user_id::bigint, t.pan_number_ciphertext FROM employee_pan t WHERE t.employee_pan_id = p_id FOR UPDATE;
    ELSIF p_kind = 'AADHAAR' THEN RETURN QUERY SELECT t.employee_id::bigint, t.verification_status::text, t.updated_by_user_id::bigint, t.aadhaar_number_ciphertext FROM employee_aadhaar t WHERE t.employee_aadhaar_id = p_id FOR UPDATE;
    ELSIF p_kind = 'BANK_ACCOUNT' THEN RETURN QUERY SELECT t.employee_id::bigint, t.verification_status::text, t.updated_by_user_id::bigint, t.account_number_ciphertext FROM employee_bank_account t WHERE t.employee_bank_account_id = p_id AND t.deleted_at IS NULL FOR UPDATE;
    ELSE RAISE EXCEPTION 'Unknown kind' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION sims_private.emp_sensitive_row(text, bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.emp_sensitive_review(p_kind text, p_id bigint, p_decision text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_rem text := NULLIF(btrim(p_remarks), '');
BEGIN
    SELECT * INTO r FROM sims_private.emp_sensitive_row(p_kind, p_id);
    IF r.employee_id IS NULL OR NOT sims_private.emp_can(r.employee_id, p_kind, 'VERIFY', true) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.%.VERIFY) or unknown record', p_kind USING ERRCODE = '42501'; END IF;
    IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be VERIFIED or REJECTED' USING ERRCODE = '22023'; END IF;
    IF p_decision = 'REJECTED' AND v_rem IS NULL THEN RAISE EXCEPTION 'Remarks are required to reject' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    IF r.status NOT IN ('PENDING') THEN RAISE EXCEPTION 'Only a pending record can be reviewed (status %)', r.status USING ERRCODE = '45000'; END IF;
    IF r.last_editor IS NOT DISTINCT FROM sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot verify a record that you entered or changed yourself' USING ERRCODE = '45000'; END IF;
    IF p_kind = 'PAN' THEN UPDATE employee_pan SET verification_status = p_decision, verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_rem WHERE employee_pan_id = p_id;
    ELSIF p_kind = 'AADHAAR' THEN UPDATE employee_aadhaar SET verification_status = p_decision, verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_rem WHERE employee_aadhaar_id = p_id;
    ELSE UPDATE employee_bank_account SET verification_status = p_decision, account_status = CASE WHEN p_decision = 'VERIFIED' THEN 'ACTIVE' ELSE 'REJECTED' END,
                verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_rem WHERE employee_bank_account_id = p_id; END IF;
    PERFORM sims_private.emp_sensitive_log(r.employee_id, 'VERIFY', p_kind, p_id, p_decision);
END $$;

CREATE FUNCTION public.emp_sensitive_reveal(p_kind text, p_id bigint, p_purpose text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_own boolean;
BEGIN
    SELECT * INTO r FROM sims_private.emp_sensitive_row(p_kind, p_id);
    v_own := sims_private.emp_is_owner(r.employee_id);
    IF r.employee_id IS NULL OR NOT (v_own OR sims_private.emp_can(r.employee_id, p_kind, 'EXPORT', true)) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.%.EXPORT) or unknown record', p_kind USING ERRCODE = '42501'; END IF;
    IF NOT v_own AND (p_purpose IS NULL OR length(btrim(p_purpose)) < 5 OR length(p_purpose) > 500) THEN RAISE EXCEPTION 'State the purpose of viewing the full number (5 to 500 characters)' USING ERRCODE = '22023'; END IF;
    PERFORM sims_private.emp_sensitive_log(r.employee_id, 'DECRYPT', p_kind, p_id, COALESCE(p_purpose, 'owner'));
    RETURN sims_private.pii_decrypt(r.ciphertext);
END $$;

CREATE FUNCTION public.emp_sensitive_delete(p_kind text, p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM sims_private.emp_sensitive_row(p_kind, p_id);
    IF r.employee_id IS NULL THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.%.DELETE) or unknown record', p_kind USING ERRCODE = '42501'; END IF;
    IF sims_private.emp_can(r.employee_id, p_kind, 'DELETE', true) THEN NULL;
    ELSIF sims_private.emp_is_owner(r.employee_id) AND r.status IN ('PENDING', 'REJECTED') THEN NULL;
    ELSE RAISE EXCEPTION 'Not authorised (EMPLOYEE.%.DELETE) or unknown record', p_kind USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM employee_document WHERE (p_kind = 'PAN' AND employee_pan_id = p_id) OR (p_kind = 'AADHAAR' AND employee_aadhaar_id = p_id) OR (p_kind = 'BANK_ACCOUNT' AND employee_bank_account_id = p_id)) THEN
        RAISE EXCEPTION 'Documents are attached to this record; remove them first' USING ERRCODE = '45000';
    END IF;
    IF p_kind = 'PAN' THEN DELETE FROM employee_pan WHERE employee_pan_id = p_id;
    ELSIF p_kind = 'AADHAAR' THEN DELETE FROM employee_aadhaar WHERE employee_aadhaar_id = p_id;
    ELSE DELETE FROM employee_bank_account WHERE employee_bank_account_id = p_id; END IF;
    PERFORM sims_private.emp_sensitive_log(r.employee_id, 'DELETE', p_kind, p_id, NULL);
END $$;

-- The sensitive-access audit log must not be writable by clients (the generated policies let anyone holding EMPLOYEE_DOCUMENT permissions insert, edit and delete rows).
DROP POLICY employee_sensitive_access_audit_insert ON employee_sensitive_access_audit;
DROP POLICY employee_sensitive_access_audit_update ON employee_sensitive_access_audit;
DROP POLICY employee_sensitive_access_audit_delete ON employee_sensitive_access_audit;
REVOKE INSERT, UPDATE, DELETE ON employee_sensitive_access_audit FROM authenticated, anon;

-- ---------------------------------------------------------------
-- HR documents (storage prefix employee/<id>/)
-- ---------------------------------------------------------------
-- Categories come from the source seed (QUALIFICATION, EXPERIENCE, BANK, PAN, AADHAAR, GENERAL); the three identity-linked ones require approval, which this workflow honours.
-- sims_private.doc_employee_id (migration 044) parses 'employee/<id>/<file>'. The storage policies of 042 call can_use_student_doc_path and those of 044 call can_use_employee_doc_path
-- (staff evidence); policies are OR-ed, so extending the first one admits HR documents without touching staff evidence.
CREATE OR REPLACE FUNCTION sims_private.can_use_student_doc_path(p_name text, p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(
      CASE WHEN p_name LIKE 'employee/%' THEN
        sims_private.doc_employee_id(p_name) = sims_private.current_employee_id()
        OR sims_private.can_employee(ARRAY[CASE WHEN p_write THEN 'EMPLOYEE.EMPLOYEE_DOCUMENT.CREATE' ELSE 'EMPLOYEE.EMPLOYEE_DOCUMENT.READ' END]::text[], sims_private.doc_employee_id(p_name), p_write)
      ELSE
        sims_private.doc_student_id(p_name) = sims_private.current_student_id()
        OR sims_private.can_student(ARRAY[CASE WHEN p_write THEN 'DOCUMENT.ALL.CREATE' ELSE 'DOCUMENT.ALL.READ' END]::text[], sims_private.doc_student_id(p_name), p_write)
      END, false)
$$;

CREATE FUNCTION public.employee_document_register(p_employee_id bigint, p_category_id integer, p_document_type_id integer, p_title text, p_storage_key text, p_file_name text, p_mime_type text, p_size bigint,
                                                  p_checksum text, p_document_number text DEFAULT NULL, p_issue_date date DEFAULT NULL, p_expiry_date date DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file bigint; v_doc bigint; v_ext text; v_meta jsonb; v_cat record; v_number text := NULLIF(btrim(p_document_number), '');
BEGIN
    IF NOT (sims_private.emp_is_owner(p_employee_id) OR sims_private.emp_can(p_employee_id, 'EMPLOYEE_DOCUMENT', 'CREATE', true)) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.CREATE)' USING ERRCODE = '42501'; END IF;
    IF sims_private.doc_employee_id(p_storage_key) IS DISTINCT FROM p_employee_id THEN RAISE EXCEPTION 'The file is not stored under this employee' USING ERRCODE = '22023'; END IF;
    IF p_title IS NULL OR btrim(p_title) = '' OR length(p_title) > 250 THEN RAISE EXCEPTION 'A title is required (at most 250 characters)' USING ERRCODE = '22023'; END IF;
    IF p_file_name IS NULL OR btrim(p_file_name) = '' OR length(p_file_name) > 255 THEN RAISE EXCEPTION 'The file name is required (at most 255 characters)' USING ERRCODE = '22023'; END IF;
    IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN RAISE EXCEPTION 'Only PDF, JPEG and PNG files are accepted' USING ERRCODE = '22023'; END IF;
    v_ext := lower(substring(p_file_name FROM '\.([A-Za-z0-9]{1,10})$'));
    IF v_ext IS NULL OR NOT ((p_mime_type = 'application/pdf' AND v_ext = 'pdf') OR (p_mime_type = 'image/jpeg' AND v_ext IN ('jpg', 'jpeg')) OR (p_mime_type = 'image/png' AND v_ext = 'png')) THEN RAISE EXCEPTION 'The file name does not match its type' USING ERRCODE = '22023'; END IF;
    IF p_size IS NULL OR p_size <= 0 OR p_size > 10485760 THEN RAISE EXCEPTION 'The file must be between 1 byte and 10 MB' USING ERRCODE = '22023'; END IF;
    IF p_checksum IS NOT NULL AND p_checksum !~ '^[0-9A-Fa-f]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_number, '')) > 100 THEN RAISE EXCEPTION 'The document number is limited to 100 characters' USING ERRCODE = '22023'; END IF;
    IF p_issue_date IS NOT NULL AND p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN RAISE EXCEPTION 'The expiry date cannot be before the issue date' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM employee WHERE employee_id = p_employee_id) THEN RAISE EXCEPTION 'Unknown employee' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_cat FROM employee_document_category WHERE employee_document_category_id = p_category_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active category' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM document_type WHERE document_type_id = p_document_type_id AND is_active) THEN RAISE EXCEPTION 'Choose an active document type' USING ERRCODE = '22023'; END IF;
    SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'sims-documents' AND name = p_storage_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'The file has not been uploaded' USING ERRCODE = '22023'; END IF;
    IF v_meta ? 'size' AND (v_meta ->> 'size')::bigint <> p_size THEN RAISE EXCEPTION 'The uploaded file size does not match' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM file_object WHERE storage_key = p_storage_key) THEN RAISE EXCEPTION 'That file is already registered' USING ERRCODE = '23505'; END IF;
    INSERT INTO file_object (storage_provider, storage_key, original_file_name, mime_type, file_size_bytes, checksum_sha256, stored_file_name, file_extension, confidentiality_level, uploaded_by_user_id)
    VALUES ('supabase-storage', p_storage_key, btrim(p_file_name), p_mime_type, p_size, lower(p_checksum), split_part(p_storage_key, '/', 3), v_ext, 'CONFIDENTIAL', sims_private.current_user_id()) RETURNING file_object_id INTO v_file;
    INSERT INTO employee_document (employee_id, document_scope, employee_document_category_id, document_type_id, file_object_id, document_title, document_number, issue_date, expiry_date,
                                   approval_status, confidentiality_level, created_by_user_id, updated_by_user_id)
    VALUES (p_employee_id, 'EMPLOYEE_GENERAL', p_category_id, p_document_type_id, v_file, btrim(p_title), v_number, p_issue_date, p_expiry_date,
            CASE WHEN v_cat.requires_approval THEN 'PENDING' ELSE 'NOT_REQUIRED' END, v_cat.default_confidentiality, sims_private.current_user_id(), sims_private.current_user_id())
    RETURNING employee_document_id INTO v_doc;
    PERFORM sims_private.emp_sensitive_log(p_employee_id, 'CREATE', 'EMPLOYEE_DOCUMENT', v_doc, NULL, v_doc);
    RETURN v_doc;
END $$;

CREATE FUNCTION public.employee_document_list(p_employee_id bigint)
RETURNS TABLE (employee_document_id bigint, category text, document_title text, original_file_name text, mime_type text, file_size_bytes bigint, document_number text, issue_date date, expiry_date date,
               verification_status text, effective_status text, approval_status text, verification_remarks text, uploaded_at timestamptz, confidentiality_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT d.employee_document_id::bigint, c.category_name::text, d.document_title::text, f.original_file_name::text, f.mime_type::text, f.file_size_bytes::bigint, d.document_number::text, d.issue_date, d.expiry_date,
           d.verification_status::text, CASE WHEN d.verification_status = 'VERIFIED' AND d.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE d.verification_status END::text, d.approval_status::text,
           d.verification_remarks::text, f.uploaded_at, d.confidentiality_level::text
    FROM employee_document d JOIN employee_document_category c ON c.employee_document_category_id = d.employee_document_category_id JOIN file_object f ON f.file_object_id = d.file_object_id
    WHERE d.employee_id = p_employee_id AND d.deleted_at IS NULL AND f.deleted_at IS NULL
      AND (sims_private.emp_is_owner(p_employee_id) OR sims_private.emp_can(p_employee_id, 'EMPLOYEE_DOCUMENT', 'READ', false))
    ORDER BY f.uploaded_at DESC, d.employee_document_id DESC
$$;

CREATE FUNCTION public.employee_document_download_info(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT d0.employee_document_id, d0.employee_id, f.storage_key, f.original_file_name, f.mime_type INTO d
    FROM employee_document d0 JOIN file_object f ON f.file_object_id = d0.file_object_id WHERE d0.employee_document_id = p_id AND d0.deleted_at IS NULL AND f.deleted_at IS NULL;
    IF d.employee_document_id IS NULL OR NOT (sims_private.emp_is_owner(d.employee_id) OR sims_private.emp_can(d.employee_id, 'EMPLOYEE_DOCUMENT', 'READ', false)) THEN
        RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.READ) or unknown document' USING ERRCODE = '42501';
    END IF;
    PERFORM sims_private.emp_sensitive_log(d.employee_id, 'DOWNLOAD', 'EMPLOYEE_DOCUMENT', p_id, NULL, p_id);
    RETURN jsonb_build_object('storage_key', d.storage_key, 'file_name', d.original_file_name, 'mime_type', d.mime_type);
END $$;

CREATE FUNCTION public.employee_document_review(p_id bigint, p_decision text, p_remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; v_rem text := NULLIF(btrim(p_remarks), ''); v_needs_approval boolean;
BEGIN
    SELECT d0.employee_document_id, d0.employee_id, d0.verification_status, d0.created_by_user_id, c.requires_approval INTO d
    FROM employee_document d0 JOIN employee_document_category c ON c.employee_document_category_id = d0.employee_document_category_id WHERE d0.employee_document_id = p_id AND d0.deleted_at IS NULL FOR UPDATE OF d0;
    IF d.employee_document_id IS NULL OR NOT sims_private.emp_can(d.employee_id, 'EMPLOYEE_DOCUMENT', 'VERIFY', true) THEN RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.VERIFY) or unknown document' USING ERRCODE = '42501'; END IF;
    IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'The decision must be VERIFIED or REJECTED' USING ERRCODE = '22023'; END IF;
    IF p_decision = 'REJECTED' AND v_rem IS NULL THEN RAISE EXCEPTION 'Remarks are required to reject a document' USING ERRCODE = '22023'; END IF;
    IF length(COALESCE(v_rem, '')) > 1000 THEN RAISE EXCEPTION 'Remarks are too long' USING ERRCODE = '22023'; END IF;
    IF d.verification_status <> 'PENDING' THEN RAISE EXCEPTION 'Only a pending document can be reviewed' USING ERRCODE = '45000'; END IF;
    IF d.created_by_user_id IS NOT DISTINCT FROM sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot review a document that you uploaded yourself' USING ERRCODE = '45000'; END IF;
    v_needs_approval := d.requires_approval;
    IF v_needs_approval AND p_decision = 'VERIFIED' AND NOT sims_private.emp_can(d.employee_id, 'EMPLOYEE_DOCUMENT', 'APPROVE', true) THEN
        RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.APPROVE): this category needs approval' USING ERRCODE = '42501';
    END IF;
    UPDATE employee_document SET verification_status = p_decision, verified_by_user_id = sims_private.current_user_id(), verified_at = now(), verification_remarks = v_rem, updated_by_user_id = sims_private.current_user_id(),
           approval_status = CASE WHEN v_needs_approval THEN CASE WHEN p_decision = 'VERIFIED' THEN 'APPROVED' ELSE 'REJECTED' END ELSE approval_status END,
           approved_by_user_id = CASE WHEN v_needs_approval THEN sims_private.current_user_id() ELSE approved_by_user_id END, approved_at = CASE WHEN v_needs_approval THEN now() ELSE approved_at END
     WHERE employee_document_id = p_id;
    PERFORM sims_private.emp_sensitive_log(d.employee_id, 'VERIFY', 'EMPLOYEE_DOCUMENT', p_id, p_decision, p_id);
END $$;

CREATE FUNCTION public.employee_document_delete(p_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record;
BEGIN
    SELECT d0.employee_document_id, d0.employee_id, d0.verification_status, d0.file_object_id, f.storage_key INTO d
    FROM employee_document d0 JOIN file_object f ON f.file_object_id = d0.file_object_id WHERE d0.employee_document_id = p_id FOR UPDATE OF d0;
    IF d.employee_document_id IS NULL OR NOT (sims_private.emp_is_owner(d.employee_id) OR sims_private.emp_can(d.employee_id, 'EMPLOYEE_DOCUMENT', 'DELETE', true)) THEN
        RAISE EXCEPTION 'Not authorised (EMPLOYEE.EMPLOYEE_DOCUMENT.DELETE) or unknown document' USING ERRCODE = '42501';
    END IF;
    IF d.verification_status = 'VERIFIED' THEN RAISE EXCEPTION 'A verified document cannot be deleted' USING ERRCODE = '45000'; END IF;
    PERFORM sims_private.emp_sensitive_log(d.employee_id, 'DELETE', 'EMPLOYEE_DOCUMENT', p_id, NULL, NULL);
    DELETE FROM employee_document_access_rule WHERE employee_document_id = p_id;
    UPDATE employee_sensitive_access_audit SET employee_document_id = NULL WHERE employee_document_id = p_id; -- keep the history (entity_id still names the document); only the FK link goes
    DELETE FROM employee_document WHERE employee_document_id = p_id;
    DELETE FROM file_object WHERE file_object_id = d.file_object_id;
    RETURN d.storage_key;
END $$;

REVOKE ALL ON FUNCTION public.emp_pan_save(bigint, text, text, date, text), public.emp_aadhaar_save(bigint, text, text, text, text),
    public.emp_bank_save(bigint, bigint, text, text, text, text, text, text, text, text, boolean, boolean), public.emp_sensitive_list(bigint), public.emp_sensitive_review(text, bigint, text, text),
    public.emp_sensitive_reveal(text, bigint, text), public.emp_sensitive_delete(text, bigint),
    public.employee_document_register(bigint, integer, integer, text, text, text, text, bigint, text, text, date, date), public.employee_document_list(bigint), public.employee_document_download_info(bigint),
    public.employee_document_review(bigint, text, text), public.employee_document_delete(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emp_pan_save(bigint, text, text, date, text), public.emp_aadhaar_save(bigint, text, text, text, text),
    public.emp_bank_save(bigint, bigint, text, text, text, text, text, text, text, text, boolean, boolean), public.emp_sensitive_list(bigint), public.emp_sensitive_review(text, bigint, text, text),
    public.emp_sensitive_reveal(text, bigint, text), public.emp_sensitive_delete(text, bigint),
    public.employee_document_register(bigint, integer, integer, text, text, text, text, bigint, text, text, date, date), public.employee_document_list(bigint), public.employee_document_download_info(bigint),
    public.employee_document_review(bigint, text, text), public.employee_document_delete(bigint) TO authenticated;
