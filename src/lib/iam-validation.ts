import { z } from 'zod';

export const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED', 'LOCKED'] as const;
export const SCOPE_TYPES = ['GLOBAL', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT', 'PROGRAMME', 'SELF'] as const;
export const REASON_MAX = 500;

export const statusSchema = z
  .object({ account_status: z.enum(ACCOUNT_STATUSES, { message: 'Select a status' }), reason: z.string().trim().max(REASON_MAX, `At most ${REASON_MAX} characters`).optional().transform((v) => (v ? v : undefined)) })
  .superRefine((v, ctx) => {
    if (v.account_status !== 'ACTIVE' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required to disable or lock an account' });
  });
export type StatusInput = z.input<typeof statusSchema>;
export type StatusValues = z.output<typeof statusSchema>;

export const assignSchema = z.object({
  role_id: z.string().min(1, 'Select a role').regex(/^\d{1,9}$/, 'Select a role').transform(Number),
  scope_entity_id: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,9}$/.test(v), 'Select a valid scope').transform((v) => (v === undefined ? undefined : Number(v))),
  reason: z.string().trim().max(REASON_MAX, `At most ${REASON_MAX} characters`).optional().transform((v) => (v ? v : undefined)),
});
export type AssignInput = z.input<typeof assignSchema>;
export type AssignValues = z.output<typeof assignSchema>;

export const userListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(['PENDING', 'ACTIVE', 'LOCKED', 'DISABLED', 'EXPIRED']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type UserListParams = z.infer<typeof userListParams>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())).optional().catch(undefined);
export const auditParams = z.object({
  module: z.string().trim().max(50).optional().catch(undefined),
  action: z.string().trim().max(30).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: isoDay,
  to: isoDay,
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type AuditParams = z.infer<typeof auditParams>;
/** Exclusive upper bound for a `to` day (the whole day is included). */
export function endOfDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
