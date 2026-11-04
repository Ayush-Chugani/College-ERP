"""Apply pending migrations from supabase/migrations/ to the Supabase project, in order, one transaction each.

Usage:
    python tools/apply_migrations.py            # list what is pending (changes nothing)
    python tools/apply_migrations.py --apply    # apply the pending migrations
    python tools/apply_migrations.py --apply --up-to 051   # apply only the pending migrations numbered 051 or lower

Reads SUPABASE_DB_PASSWORD from .env.local. The direct host db.<ref>.supabase.co is IPv6-only, so the session pooler is used by default;
override with SUPABASE_DB_HOST / SUPABASE_DB_USER. Each migration runs in a transaction and is then recorded in supabase_migrations.schema_migrations;
if one fails it is rolled back and the script stops. Migrations are additive and are never re-run.
"""
import os
import re
import sys

import psycopg2

REF = 'khqqfgqvwdxlqkncwtmh'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.environ.get('SUPABASE_DB_HOST', 'aws-0-ap-southeast-1.pooler.supabase.com')
USER = os.environ.get('SUPABASE_DB_USER', f'postgres.{REF}')


def main():
    apply = '--apply' in sys.argv
    up_to = None
    if '--up-to' in sys.argv:
        up_to = sys.argv[sys.argv.index('--up-to') + 1]
    pw = re.search(r'SUPABASE_DB_PASSWORD=(.*)', open(os.path.join(ROOT, '.env.local'), encoding='utf-8').read()).group(1).strip()
    conn = psycopg2.connect(host=HOST, port=5432, dbname='postgres', user=USER, password=pw, sslmode='require', connect_timeout=20)
    cur = conn.cursor()
    cur.execute('select version from supabase_migrations.schema_migrations')
    have = {r[0] for r in cur.fetchall()}
    folder = os.path.join(ROOT, 'supabase', 'migrations')
    pending = []
    for f in sorted(os.listdir(folder)):
        m = re.match(r'^(\d+)_(.+)\.sql$', f)
        if m and m.group(1) not in have and (up_to is None or int(m.group(1)) <= int(up_to)):
            pending.append((m.group(1), m.group(2), os.path.join(folder, f)))
    if not pending:
        print('Nothing pending: every migration is applied.')
        return
    print('Pending:', ', '.join(f'{v}_{n}' for v, n, _ in pending))
    if not apply:
        print('Run again with --apply to apply them.')
        return
    for v, name, path in pending:
        sql = open(path, encoding='utf-8').read()
        try:
            cur.execute(sql)
            cur.execute('insert into supabase_migrations.schema_migrations(version, name, statements) values (%s, %s, %s)', (v, name, [sql]))
            conn.commit()
            print(f'{v} applied')
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f'{v} FAILED and was rolled back: {str(e).strip()[:400]}')
            sys.exit(1)


if __name__ == '__main__':
    main()
