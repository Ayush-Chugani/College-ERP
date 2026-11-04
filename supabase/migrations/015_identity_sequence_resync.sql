-- Advance identity sequences past any explicitly inserted seed ids
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT c.table_name, c.column_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.is_identity = 'YES'
    LOOP
        EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE(MAX(%I), 1), MAX(%I) IS NOT NULL) FROM public.%I',
            'public.' || r.table_name, r.column_name, r.column_name, r.column_name, r.table_name);
    END LOOP;
END $$;
