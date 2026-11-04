-- Permission overrides administration (KI-52). Hand-written (not from the MySQL source).
--
-- A per-user override ALLOWs or DENYs one permission at a scope on top of the person's roles (DENY wins, see AUTHENTICATION_AND_RBAC.md). Until now overrides could only be written by SQL.
--
-- RULES (decisions; "use your defaults"):
--  * Needs IAM.ALL.UPDATE at global scope, like role assignment. Nobody can change their own overrides.
--  * Granting (ALLOW) a sensitive permission (permission.is_sensitive: approve, delete, configure, export) or any IAM / AUDIT permission is reserved for super administrators; a DENY is open to anyone with IAM.ALL.UPDATE.
--  * A justification is required. An override is ended, not deleted (valid_to = now()), so the history stays; the row audit trigger (M006) records every change.
--  * The scope must be valid for the permission model: GLOBAL/SELF carry no entity, the others name an existing institution, campus, department or programme.

CREATE FUNCTION public.iam_permission_options(p_search text DEFAULT NULL) RETURNS TABLE (permission_code text, permission_name text, is_sensitive boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    IF length(COALESCE(p_search, '')) > 60 THEN RAISE EXCEPTION 'The search text is too long' USING ERRCODE = '22023'; END IF;
    RETURN QUERY SELECT p.permission_code::text, p.permission_name::text, p.is_sensitive FROM permission p
                  WHERE p_search IS NULL OR p_search = '' OR p.permission_code ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                  ORDER BY p.permission_code LIMIT 40;
END $$;

CREATE FUNCTION public.iam_override_list(p_user_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.READ']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.READ)' USING ERRCODE = '42501'; END IF;
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.user_permission_override_id, 'permission', p.permission_code, 'effect', o.permission_effect, 'scope_type', o.scope_type,
              'scope', CASE o.scope_type WHEN 'INSTITUTION' THEN (SELECT institution_name FROM institution WHERE institution_id = o.scope_entity_id)
                                         WHEN 'CAMPUS' THEN (SELECT campus_name FROM campus WHERE campus_id = o.scope_entity_id)
                                         WHEN 'DEPARTMENT' THEN (SELECT department_name FROM department WHERE department_id = o.scope_entity_id)
                                         WHEN 'PROGRAMME' THEN (SELECT programme_name FROM programme WHERE programme_id = o.scope_entity_id) END,
              'valid_from', o.valid_from, 'valid_to', o.valid_to, 'active', o.valid_to IS NULL OR o.valid_to > now(), 'justification', o.justification,
              'granted_by', (SELECT username FROM user_account WHERE user_id = o.granted_by_user_id)) ORDER BY o.user_permission_override_id DESC)
              FROM user_permission_override o JOIN permission p ON p.permission_id = o.permission_id WHERE o.user_id = p_user_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.iam_override_set(p_user_id bigint, p_permission_code text, p_effect text, p_scope_type text, p_scope_entity_id integer, p_justification text, p_valid_to timestamptz DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_perm record; v_id bigint; v_just text := NULLIF(btrim(p_justification), '');
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM user_account WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'Unknown user' USING ERRCODE = '22023'; END IF;
    IF p_user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own permissions' USING ERRCODE = '45000'; END IF;
    SELECT permission_id, permission_code, is_sensitive INTO v_perm FROM permission WHERE permission_code = p_permission_code;
    IF v_perm.permission_id IS NULL THEN RAISE EXCEPTION 'Unknown permission' USING ERRCODE = '22023'; END IF;
    IF p_effect NOT IN ('ALLOW', 'DENY') THEN RAISE EXCEPTION 'The effect must be ALLOW or DENY' USING ERRCODE = '22023'; END IF;
    IF p_scope_type NOT IN ('GLOBAL', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT', 'PROGRAMME', 'SELF') THEN RAISE EXCEPTION 'Unknown scope' USING ERRCODE = '22023'; END IF;
    IF v_just IS NULL OR length(v_just) > 500 THEN RAISE EXCEPTION 'A justification is required (at most 500 characters)' USING ERRCODE = '22023'; END IF;
    IF p_valid_to IS NOT NULL AND p_valid_to <= now() THEN RAISE EXCEPTION 'The end of the override must be in the future' USING ERRCODE = '22023'; END IF;
    IF (p_scope_type IN ('GLOBAL', 'SELF')) <> (p_scope_entity_id IS NULL) THEN RAISE EXCEPTION 'The scope entity is required for % scope and not allowed otherwise', p_scope_type USING ERRCODE = '22023'; END IF;
    IF p_scope_type = 'INSTITUTION' AND NOT EXISTS (SELECT 1 FROM institution WHERE institution_id = p_scope_entity_id)
       OR p_scope_type = 'CAMPUS' AND NOT EXISTS (SELECT 1 FROM campus WHERE campus_id = p_scope_entity_id)
       OR p_scope_type = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department WHERE department_id = p_scope_entity_id)
       OR p_scope_type = 'PROGRAMME' AND NOT EXISTS (SELECT 1 FROM programme WHERE programme_id = p_scope_entity_id) THEN RAISE EXCEPTION 'Unknown scope entity' USING ERRCODE = '22023'; END IF;
    IF p_effect = 'ALLOW' AND (v_perm.is_sensitive OR v_perm.permission_code LIKE 'IAM.%' OR v_perm.permission_code LIKE 'AUDIT.%') AND NOT sims_private.caller_has_role('SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Only a super administrator can grant a sensitive, IAM or AUDIT permission' USING ERRCODE = '42501';
    END IF;
    SELECT user_permission_override_id INTO v_id FROM user_permission_override
     WHERE user_id = p_user_id AND permission_id = v_perm.permission_id AND scope_type = p_scope_type AND normalized_scope_entity_id = COALESCE(p_scope_entity_id, 0) AND permission_effect = p_effect
       AND (valid_to IS NULL OR valid_to > now()) LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF; -- idempotent: the same active override exists
    INSERT INTO user_permission_override (user_id, permission_id, permission_effect, scope_type, scope_entity_id, valid_to, granted_by_user_id, justification)
    VALUES (p_user_id, v_perm.permission_id, p_effect, p_scope_type, p_scope_entity_id, p_valid_to, sims_private.current_user_id(), v_just) RETURNING user_permission_override_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION public.iam_override_end(p_override_id bigint, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o record; v_perm record;
BEGIN
    IF NOT sims_private.can_global(ARRAY['IAM.ALL.UPDATE']::text[]) THEN RAISE EXCEPTION 'Not authorised (IAM.ALL.UPDATE)' USING ERRCODE = '42501'; END IF;
    SELECT * INTO o FROM user_permission_override WHERE user_permission_override_id = p_override_id FOR UPDATE;
    IF o.user_permission_override_id IS NULL THEN RAISE EXCEPTION 'Unknown override' USING ERRCODE = '22023'; END IF;
    IF o.user_id = sims_private.current_user_id() THEN RAISE EXCEPTION 'You cannot change your own permissions' USING ERRCODE = '45000'; END IF;
    IF o.valid_to IS NOT NULL AND o.valid_to <= now() THEN RETURN; END IF; -- already ended
    SELECT permission_code, is_sensitive INTO v_perm FROM permission WHERE permission_id = o.permission_id;
    IF o.permission_effect = 'ALLOW' AND (v_perm.is_sensitive OR v_perm.permission_code LIKE 'IAM.%' OR v_perm.permission_code LIKE 'AUDIT.%') AND NOT sims_private.caller_has_role('SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Only a super administrator can change a sensitive, IAM or AUDIT grant' USING ERRCODE = '42501';
    END IF;
    UPDATE user_permission_override SET valid_to = CASE WHEN now() > valid_from THEN now() ELSE valid_from + interval '1 microsecond' END, justification = left(justification || ' [ended: ' || COALESCE(NULLIF(btrim(p_reason), ''), 'no reason given') || ']', 500) WHERE user_permission_override_id = p_override_id;
END $$;

REVOKE ALL ON FUNCTION public.iam_permission_options(text), public.iam_override_list(bigint), public.iam_override_set(bigint, text, text, text, integer, text, timestamptz), public.iam_override_end(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iam_permission_options(text), public.iam_override_list(bigint), public.iam_override_set(bigint, text, text, text, integer, text, timestamptz), public.iam_override_end(bigint, text) TO authenticated;
