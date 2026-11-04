// Creates the FIRST administrator without the Supabase dashboard: an Auth user (email + password) plus its SIMS account with the global SUPER_ADMIN role.
//
// Usage:  node tools/create_admin.mjs admin@example.org [--allow-additional]
//
// Needs in .env.local (never committed): NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard > Project Settings > API > service_role).
// Migration 049 must be applied. The password is typed here, hidden, and goes only to the Supabase Auth API: it is never printed, logged or stored by SIMS.
// If a SUPER_ADMIN already exists the script stops unless --allow-additional is given. If anything fails after the Auth user is created, the Auth user is deleted again.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import readline from 'node:readline';

const env = {};
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv.slice(2).find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const allowMore = process.argv.includes('--allow-additional');

const die = (msg) => { console.error(msg); process.exit(1); };
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die('Usage: node tools/create_admin.mjs <email> [--allow-additional]');
if (!url || !key) die('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');

function problem(pw) {
  if (pw.length < 10) return 'Use at least 10 characters';
  if (pw.length > 72) return 'Use at most 72 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number';
  const local = email.split('@')[0];
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'The password must not contain the email name';
  if (['password123', 'admin123', 'admin@123', 'qwerty123', 'welcome123'].includes(pw.toLowerCase())) return 'That password is too common';
  return null;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: exErr } = await admin.from('user_role_assignment').select('user_role_assignment_id, role!inner(role_code)').eq('scope_type', 'GLOBAL').eq('assignment_status', 'ACTIVE').eq('role.role_code', 'SUPER_ADMIN').limit(1);
if (exErr) die(`Could not check for an existing super administrator (${exErr.code ?? 'error'}). Is migration 049 applied and the key a service_role key?`);
if (existing?.length && !allowMore) die('A SUPER_ADMIN already exists. Use --allow-additional to add another.');

const password = await askHidden('Password for the new administrator: ');
const bad = problem(password);
if (bad) die(bad);
if ((await askHidden('Repeat the password: ')) !== password) die('The passwords do not match.');

const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) die(`The Auth user could not be created: ${created.error?.message ?? 'unknown error'}`);
const authId = created.data.user.id;

async function rollback(msg) {
  await admin.auth.admin.deleteUser(authId);
  die(`${msg} The Auth user was removed again.`);
}

const prov = await admin.rpc('iam_provision_user', { p_auth_user: authId, p_email: email, p_student_number: null, p_employee_number: null, p_actor_user_id: null });
if (prov.error || typeof prov.data !== 'number') await rollback(`Provisioning failed (${prov.error?.message ?? 'no id returned'}).`);
const userId = prov.data;

const role = await admin.from('role').select('role_id').eq('role_code', 'SUPER_ADMIN').maybeSingle();
if (role.error || !role.data) await rollback('The SUPER_ADMIN role was not found.');
const assign = await admin.from('user_role_assignment').insert({ user_id: userId, role_id: role.data.role_id, scope_type: 'GLOBAL', assignment_reason: 'create_admin.mjs' });
if (assign.error) await rollback(`Assigning the role failed (${assign.error.message}).`);

console.log(`OK: ${email} created as user ${userId} with the global SUPER_ADMIN role. Sign in at /login.`);
