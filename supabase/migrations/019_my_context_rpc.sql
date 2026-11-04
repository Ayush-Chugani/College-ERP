-- Caller context for the application shell. Hand-written.
-- Returns NULL when the JWT has no ACTIVE, identity-mapped SIMS account. Never accepts parameters: it can only describe the caller.
-- Navigation built from this is a UX convenience only; RLS remains the enforcement layer.
CREATE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH me AS (SELECT sims_private.current_user_id() AS uid)
    SELECT CASE WHEN me.uid IS NULL THEN NULL ELSE jsonb_build_object(
        'user_id', me.uid,
        'username', (SELECT u.username FROM public.user_account u WHERE u.user_id = me.uid),
        'email', (SELECT u.email FROM public.user_account u WHERE u.user_id = me.uid),
        'student_id', sims_private.current_student_id(),
        'employee_id', sims_private.current_employee_id(),
        'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'role_code', r.role_code, 'role_name', r.role_name, 'scope_type', r.scope_type,
                    'institution_id', r.institution_id, 'campus_id', r.campus_id,
                    'department_id', r.department_id, 'programme_id', r.programme_id))
                 FROM public.v_active_user_role r WHERE r.user_id = me.uid), '[]'::jsonb),
        'readable_modules', COALESCE((SELECT jsonb_agg(DISTINCT split_part(v.permission_code, '.', 1))
                 FROM public.v_effective_user_permission v
                 WHERE v.user_id = me.uid AND v.permission_effect = 'ALLOW' AND v.permission_code LIKE '%.READ'), '[]'::jsonb)
    ) END
    FROM me
$$;

REVOKE ALL ON FUNCTION public.my_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_context() TO authenticated;
