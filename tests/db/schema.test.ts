import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabase-stub';

const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');
let db: PGlite;

/** Insert fixture rows with FK triggers off, then restore normal trigger behaviour for the code under test. */
async function fx(sql: string) {
  await db.exec('SET session_replication_role = replica');
  try {
    await db.exec(sql);
  } finally {
    await db.exec('SET session_replication_role = origin');
  }
}
/** Disable only the FK-check triggers (user triggers and unique/check constraints stay live). */
async function fkSwitch(enable: boolean) {
  const { rows } = await db.query<{ t: string; n: string }>(
    "select c.relname t, g.tgname n from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and g.tgisinternal and g.tgconstraint<>0 and g.tgname like 'RI_ConstraintTrigger%'",
  );
  for (const r of rows) await db.exec(`ALTER TABLE public.${r.t} ${enable ? 'ENABLE' : 'DISABLE'} TRIGGER "${r.n}"`);
}
const one = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows[0] as T;
const fails = async (sql: string, message: RegExp | string) => {
  await expect(db.exec(sql)).rejects.toThrow(message);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  }
}, 120_000);

describe('schema creation', () => {
  it('creates all 213 source tables and 10 views; 16 ported + 37 updated_at + 20 workflow-guard + 38 audit + 1 immutability triggers', async () => {
    expect((await one<{ n: number }>("select count(*)::int n from pg_tables where schemaname='public'")).n).toBe(213);
    expect((await one<{ n: number }>("select count(*)::int n from pg_views where schemaname='public'")).n).toBe(10);
    const t = await one<{ guard: number; touch: number; audit: number; ported: number }>(
      "select count(*) filter (where tgname like 'trg\_%\_workflow\_guard')::int guard, count(*) filter (where tgname like 'trg\_%\_touch\_updated\_at')::int touch, count(*) filter (where tgname like 'trg\_%\_audit')::int audit, count(*) filter (where tgname not like '%\_audit' and tgname not like '%workflow\_guard' and tgname not like '%touch\_updated\_at')::int ported from pg_trigger where not tgisinternal",
    );
    // "ported" bucket = the 16 MySQL triggers + trg_employee_institution_immutable + 2 registration integrity guards + 1 class-session guard + 4 assessment/result guards
    expect(t).toEqual({ guard: 20, touch: 37, audit: 46, ported: 28 });
  });

  it('has RLS enabled on every public table (deny by default)', async () => {
    const r = await one<{ n: number }>(
      "select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    );
    expect(r.n).toBe(0);
  });

  it('creates every view as security_invoker', async () => {
    const r = await one<{ n: number }>(
      "select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='v' and not coalesce(c.reloptions @> array['security_invoker=true'], false)",
    );
    expect(r.n).toBe(0);
  });

  it('seeds reference and RBAC data', async () => {
    expect((await one<{ n: number }>('select count(*)::int n from role')).n).toBeGreaterThan(0);
    expect((await one<{ n: number }>('select count(*)::int n from permission')).n).toBeGreaterThan(0);
  });

  it('rejects values outside MySQL UNSIGNED / ENUM ranges', async () => {
    await fails("insert into state (country_id, state_code, state_name) values (-1, 'X', 'Nowhere')", /u16|check|violates/i);
    await fails("insert into role (role_code, role_name, role_category, role_level) values ('t','t','NOPE','GLOBAL')", /enum_role_category|check/i);
  });

  it('allows sequences to continue after seed rows', async () => {
    await db.exec("insert into country (iso_code, country_name) values ('ZZ','Zedland')");
    expect((await one<{ n: number }>("select count(*)::int n from country where iso_code='ZZ'")).n).toBe(1);
  });
});

describe('updated_at trigger (ON UPDATE CURRENT_TIMESTAMP)', () => {
  it('bumps updated_at only when the row changes', async () => {
    await db.exec(
      "insert into user_account (username, password_hash, updated_at) values ('touch_u','x','2000-01-01T00:00:00Z')",
    );
    await db.exec("update user_account set username='touch_u' where username='touch_u'");
    expect((await one<{ y: number }>("select extract(year from updated_at)::int y from user_account where username='touch_u'")).y).toBe(2000);
    await db.exec("update user_account set email='a@b.c' where username='touch_u'");
    expect((await one<{ y: number }>("select extract(year from updated_at)::int y from user_account where username='touch_u'")).y).toBeGreaterThan(2000);
  });
});

describe('RBAC scope triggers', () => {
  it('requires role level to match assignment scope_type', async () => {
    await fx(`
      insert into role (role_id, role_code, role_name, role_category, role_level) values (9001,'R_CAMPUS','Campus role','ADMINISTRATIVE','CAMPUS');
      insert into user_account (user_id, username, password_hash) values (9001,'rbac_u','x');`);
    await fails(
      "insert into user_role_assignment (user_id, role_id, scope_type, institution_id) values (9001, 9001, 'INSTITUTION', 1)",
      'Role level must match assignment scope_type',
    );
  });
});

describe('current-primary uniqueness (generated columns)', () => {
  it('allows one current primary employee assignment, rejects a second, allows after end_date', async () => {
    await fkSwitch(false);
    await db.exec("insert into employee_assignment (employee_id, campus_id, designation_id, start_date, is_primary) values (1,1,1,'2024-01-01',true)");
    await fails(
      "insert into employee_assignment (employee_id, campus_id, designation_id, start_date, is_primary) values (1,1,2,'2025-01-01',true)",
      /uq_employee_current_primary|duplicate key/i,
    );
    await db.exec("update employee_assignment set end_date='2024-12-31' where employee_id=1");
    await db.exec("insert into employee_assignment (employee_id, campus_id, designation_id, start_date, is_primary) values (1,1,2,'2025-01-01',true)");
    await fkSwitch(true);
  });

  it('enforces foreign keys when enabled', async () => {
    await fails("insert into student_address (student_id, address_type, address_line_1, city, country_id) values (424242,'PERMANENT','x','y',1)", /foreign key|violates/i);
  });
});

describe('finance integrity triggers', () => {
  afterAll(async () => {
    await fkSwitch(true);
  });

  beforeAll(async () => {
    await fkSwitch(false);
    await db.exec(`
      insert into payment_transaction (payment_transaction_id, transaction_number, student_account_id, transaction_date, payment_mode_id, amount, payment_status)
        values (1,'TX1',100,now(),1,1000.00,'SUCCESS'),
               (2,'TX2',100,now(),1,500.00,'PENDING'),
               (3,'TX3',999,now(),1,500.00,'SUCCESS');
      insert into student_fee_assessment (fee_assessment_id, assessment_number, student_account_id, academic_year_id, assessment_type, assessment_date)
        values (1,'FA1',100,1,'ACADEMIC','2025-01-01');`);
    // item insert fires trg_fee_item_ai (header totals)
    await db.exec(`
      insert into student_fee_assessment_item (assessment_item_id, fee_assessment_id, fee_type_id, original_amount, net_amount, balance_amount)
        values (1,1,1,800.00,800.00,800.00),(2,1,1,700.00,700.00,700.00);`);
  });

  it('keeps assessment header totals in sync with items (trg_fee_item_*)', async () => {
    const h = await one<{ g: string; n: string; b: string }>(
      'select gross_amount g, net_payable_amount n, balance_amount b from student_fee_assessment where fee_assessment_id=1',
    );
    expect([h.g, h.n, h.b]).toEqual(['1500.00', '1500.00', '1500.00']);
  });

  it('rejects allocation from a non-SUCCESS payment', async () => {
    await fails('insert into payment_allocation (payment_transaction_id, assessment_item_id, allocated_amount) values (2,1,100)', 'Only SUCCESS payments can be allocated');
  });

  it('rejects allocation when payment and assessment contexts differ', async () => {
    await fails('insert into payment_allocation (payment_transaction_id, assessment_item_id, allocated_amount) values (3,1,100)', 'Payment and assessment contexts do not match');
  });

  it('allocates, updates item paid/balance and header, and blocks over-allocation', async () => {
    await db.exec('insert into payment_allocation (payment_transaction_id, assessment_item_id, allocated_amount) values (1,1,600)');
    const i = await one<{ p: string; b: string }>('select amount_paid p, balance_amount b from student_fee_assessment_item where assessment_item_id=1');
    expect([i.p, i.b]).toEqual(['600.00', '200.00']);
    const h = await one<{ p: string; b: string }>('select amount_paid p, balance_amount b from student_fee_assessment where fee_assessment_id=1');
    expect([h.p, h.b]).toEqual(['600.00', '900.00']);
    // payment TX1 has 400 left: 500 on item 2 exceeds the payment
    await fails('insert into payment_allocation (payment_transaction_id, assessment_item_id, allocated_amount) values (1,2,500)', 'Allocation exceeds payment amount');
    // item 1 has 200 left: 300 exceeds the item (payment still has 400)
    await fails('update payment_allocation set allocated_amount=900 where payment_transaction_id=1 and assessment_item_id=1', /exceeds/);
  });

  it('reverts item totals when an allocation is deleted', async () => {
    await db.exec('delete from payment_allocation where payment_transaction_id=1 and assessment_item_id=1');
    const i = await one<{ p: string; b: string }>('select amount_paid p, balance_amount b from student_fee_assessment_item where assessment_item_id=1');
    expect([i.p, i.b]).toEqual(['0.00', '800.00']);
  });

  it('blocks benefits above the original item amount', async () => {
    await db.exec(`insert into fee_assessment_benefit (assessment_item_id, benefit_type, student_concession_id, benefit_amount, applied_date) values (1,'CONCESSION',1,500,'2025-01-02');`);
    await fails("insert into fee_assessment_benefit (assessment_item_id, benefit_type, student_concession_id, benefit_amount, applied_date) values (1,'CONCESSION',2,400,'2025-01-02')", 'Benefits exceed original assessment item amount');
  });

  it('enforces refund approval and cumulative limits', async () => {
    await db.exec(`
      insert into refund_request (refund_request_id, refund_request_number, student_account_id, payment_transaction_id, request_date, refund_reason, requested_amount, approved_amount, request_status)
        values (1,'RR1',100,1,'2025-02-01','x',300,300,'APPROVED'),
               (2,'RR2',100,1,'2025-02-01','x',300,NULL,'SUBMITTED');`);
    await fails("insert into fee_refund (refund_request_id, refund_transaction_number, refund_date, refund_amount, refund_mode_id, refund_status) values (2,'RF0',now(),50,1,'SUCCESS')", 'Refund request must be approved');
    await db.exec("insert into fee_refund (refund_request_id, refund_transaction_number, refund_date, refund_amount, refund_mode_id, refund_status) values (1,'RF1',now(),200,1,'SUCCESS')");
    await fails("insert into fee_refund (refund_request_id, refund_transaction_number, refund_date, refund_amount, refund_mode_id, refund_status) values (1,'RF2',now(),150,1,'SUCCESS')", 'Refund exceeds approved amount');
  });
});
