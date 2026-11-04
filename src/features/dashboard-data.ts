import type { SupabaseClient } from '@supabase/supabase-js';
import {
  employeeSlices, feeSeries, humanise, resultSlices, stackEnrolments, toSlices,
  type EmployeeRow, type EnrolmentRow, type FeeMonth, type Slice, type TermResultRow,
} from '@/lib/dashboard-model';

/** Each loader returns null when its query failed, so a broken metric shows "unavailable" instead of a false zero. */
async function rpc<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T[] | null> {
  const { data, error } = await supabase.rpc(fn, args);
  return error ? null : ((data ?? []) as T[]);
}

export type DashboardData = {
  enrolments: ReturnType<typeof stackEnrolments> | null;
  applications: Slice[] | null;
  registrations: Slice[] | null;
  employees: ReturnType<typeof employeeSlices> | null;
  sessions: Slice[] | null;
  results: ReturnType<typeof resultSlices> | null;
  fees: { series: ReturnType<typeof feeSeries>; outstanding: { payable: number; paid: number; balance: number; overdue: number } } | null;
};

export const SESSION_WINDOW_DAYS = 30;
export const FEE_WINDOW_MONTHS = 6;

/** Loads only the metrics for modules the caller can read; row-level security scopes every number. */
export async function loadDashboard(supabase: SupabaseClient, modules: string[]): Promise<DashboardData> {
  const has = (m: string) => modules.includes(m);
  const [enrol, apps, regs, emps, sess, res, fee, out] = await Promise.all([
    has('STUDENT') || has('ADMISSION') ? rpc<EnrolmentRow>(supabase, 'dash_enrolments') : Promise.resolve(undefined),
    has('ADMISSION') ? rpc<{ application_status: string; n: number }>(supabase, 'dash_applications') : Promise.resolve(undefined),
    has('REGISTRATION') ? rpc<{ registration_status: string; n: number }>(supabase, 'dash_registrations') : Promise.resolve(undefined),
    has('EMPLOYEE') ? rpc<EmployeeRow>(supabase, 'dash_employees') : Promise.resolve(undefined),
    has('ATTENDANCE') ? rpc<{ session_status: string; n: number }>(supabase, 'dash_sessions', { p_days: SESSION_WINDOW_DAYS }) : Promise.resolve(undefined),
    has('RESULT') ? rpc<TermResultRow>(supabase, 'dash_term_results') : Promise.resolve(undefined),
    has('FEES') ? rpc<FeeMonth>(supabase, 'dash_fee_collection', { p_months: FEE_WINDOW_MONTHS }) : Promise.resolve(undefined),
    has('FEES') ? rpc<{ payable: number; paid: number; balance: number; overdue_assessments: number }>(supabase, 'dash_fee_outstanding') : Promise.resolve(undefined),
  ]);
  const ap = apps ? toSlices(apps.map((r) => ({ label: humanise(r.application_status), n: r.n }))) : null;
  const rg = regs ? toSlices(regs.map((r) => ({ label: humanise(r.registration_status), n: r.n }))) : null;
  const ss = sess ? toSlices(sess.map((r) => ({ label: humanise(r.session_status), n: r.n }))) : null;
  const o = out?.[0];
  return {
    enrolments: enrol ? stackEnrolments(enrol) : null,
    applications: ap,
    registrations: rg,
    employees: emps ? employeeSlices(emps) : null,
    sessions: ss,
    results: res ? resultSlices(res) : null,
    fees: fee && o ? { series: feeSeries(fee), outstanding: { payable: Number(o.payable), paid: Number(o.paid), balance: Number(o.balance), overdue: Number(o.overdue_assessments) } } : null,
  };
}
