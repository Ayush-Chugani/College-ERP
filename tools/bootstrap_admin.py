"""Bootstrap the first SUPER_ADMIN.

Prerequisite (done by a human, in the Supabase dashboard): Authentication -> Users -> Add user -> Create new user
(set the password there, tick "Auto Confirm User"). No password ever passes through this script.

Usage:  python tools/bootstrap_admin.py admin@example.org [--allow-additional]

What it does, in ONE transaction:
  1. finds the confirmed auth.users row for the email (refuses if missing/unconfirmed)
  2. refuses if a SUPER_ADMIN GLOBAL assignment already exists (unless --allow-additional)
  3. creates user_account (password_hash is a non-usable placeholder; Supabase Auth owns credentials)
  4. assigns SUPER_ADMIN with GLOBAL scope
  5. links auth user -> user_account through sims_private.link_auth_user()
  6. verifies, inside the same transaction under role `authenticated` with that JWT subject, that the identity resolves
     and the admin can read user_account but `anon` still cannot; commits only if verification passes.
Connection: SUPABASE_DB_PASSWORD from .env.local (host/ref below).
"""
import os, re, sys
import psycopg2

REF = 'khqqfgqvwdxlqkncwtmh'
# The direct host db.<ref>.supabase.co is IPv6-only; the session pooler works over IPv4. Override with SUPABASE_DB_HOST / SUPABASE_DB_USER.
POOLER_HOST = 'aws-0-ap-southeast-1.pooler.supabase.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    allow_more = '--allow-additional' in sys.argv
    if len(args) != 1 or '@' not in args[0]:
        sys.exit(__doc__)
    email = args[0].strip().lower()
    pw = re.search(r'SUPABASE_DB_PASSWORD=(.*)', open(os.path.join(ROOT, '.env.local')).read()).group(1).strip()
    host = os.environ.get('SUPABASE_DB_HOST', POOLER_HOST)
    user = os.environ.get('SUPABASE_DB_USER', f'postgres.{REF}')
    c = psycopg2.connect(host=host, user=user, password=pw, dbname='postgres', port=5432, sslmode='require')
    cur = c.cursor()
    try:
        cur.execute("select id, email_confirmed_at is not null from auth.users where lower(email)=%s", (email,))
        row = cur.fetchone()
        if not row:
            sys.exit(f'No auth user with email {email}. Create it in the Supabase dashboard first.')
        auth_id, confirmed = row
        if not confirmed:
            sys.exit('Auth user is not confirmed. Tick "Auto Confirm User" or confirm the email first.')
        cur.execute("select 1 from sims_private.auth_identity_map where auth_user_id=%s", (auth_id,))
        if cur.fetchone():
            sys.exit('This auth user is already linked. Nothing to do.')
        cur.execute("""select 1 from user_role_assignment a join role r using(role_id)
                       where r.role_code='SUPER_ADMIN' and a.scope_type='GLOBAL' and a.assignment_status='ACTIVE'""")
        if cur.fetchone() and not allow_more:
            sys.exit('A SUPER_ADMIN already exists. Use --allow-additional to add another.')
        cur.execute("""insert into user_account (username, password_hash, email, account_status, must_change_password)
                       values (%s, '!supabase-auth', %s, 'ACTIVE', false) returning user_id""", (email, email))
        user_id = cur.fetchone()[0]
        cur.execute("""insert into user_role_assignment (user_id, role_id, scope_type, assignment_reason)
                       select %s, role_id, 'GLOBAL', 'bootstrap_admin.py' from role where role_code='SUPER_ADMIN'""", (user_id,))
        cur.execute("select sims_private.link_auth_user(%s, %s, 'bootstrap_admin.py')", (str(auth_id), user_id))

        # verification under the real runtime role, inside the still-open transaction
        cur.execute("savepoint v")
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(auth_id),))
        cur.execute("select sims_private.current_user_id()")
        resolved = cur.fetchone()[0]
        cur.execute("select count(*) from user_account where user_id=%s", (user_id,))
        sees_self = cur.fetchone()[0]
        cur.execute("select sims_private.can_global(ARRAY['IAM.ALL.READ']::text[])")
        is_admin = cur.fetchone()[0]
        cur.execute("rollback to savepoint v")  # leaves role/claims reset
        if resolved != user_id or sees_self != 1 or not is_admin:
            raise RuntimeError(f'verification failed: resolved={resolved} sees_self={sees_self} is_admin={is_admin}')
        c.commit()
        print(f'OK: {email} -> user_account {user_id}, SUPER_ADMIN (GLOBAL), identity linked and verified.')
    except SystemExit:
        c.rollback()
        raise
    except Exception:
        c.rollback()
        raise


if __name__ == '__main__':
    main()
