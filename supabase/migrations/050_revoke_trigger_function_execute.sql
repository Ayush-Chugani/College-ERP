-- Hardening found by checking the live project after applying 044-049: the 31 trigger functions in the public schema (sims_guard_*, sims_*_guard, ...)
-- carried EXECUTE for anon, because the project's default function privileges grant it to new functions. PostgreSQL refuses to call a trigger function
-- directly, so this was not exploitable, but those functions were listed by the API and the intent of migration 017 (no client can call internal helpers)
-- was not met. Triggers keep firing: a trigger function needs no EXECUTE privilege at run time, only when the trigger is created.
-- Intentionally NOT touched: public RPCs that are meant to be callable (auth_failure_record is callable by anon by design, see migration 045).

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.prorettype = 'pg_catalog.trigger'::regtype LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    END LOOP;
END $$;
