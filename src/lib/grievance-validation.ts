import { z } from 'zod';

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const STATUSES = ['SUBMITTED', 'ASSIGNED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'] as const;
/** Mirrors the database transition rules (migration 039); drift-tested. */
export const TRANSITIONS: Record<string, readonly string[]> = {
  SUBMITTED: ['ASSIGNED', 'REJECTED'],
  ASSIGNED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['RESOLVED', 'REJECTED'],
  RESOLVED: ['CLOSED', 'UNDER_REVIEW'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};
export const NEEDS_RESOLUTION = ['RESOLVED', 'REJECTED'] as const;
export const SUBJECT_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const NOTE_MAX = 2000;

const optId = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,15}$/.test(v), 'Select a valid option').transform((v) => (v === undefined ? undefined : Number(v)));

export const submitSchema = z.object({
  grievance_category_id: z.string().min(1, 'Select a category').regex(/^\d{1,15}$/, 'Select a category').transform(Number),
  department_id: optId,
  subject: z.string().trim().min(1, 'The subject is required').max(SUBJECT_MAX, `At most ${SUBJECT_MAX} characters`),
  description: z.string().trim().min(1, 'Describe the problem').max(DESCRIPTION_MAX, `At most ${DESCRIPTION_MAX} characters`),
  priority: z.enum(PRIORITIES, { message: 'Select a priority' }),
});
export type SubmitInput = z.input<typeof submitSchema>;
export type SubmitValues = z.output<typeof submitSchema>;

export const actionSchema = z
  .object({
    action_type: z.enum(['COMMENT', 'INTERNAL_NOTE', 'STATUS_CHANGE'], { message: 'Select an action' }),
    notes: z.string().trim().max(NOTE_MAX, `At most ${NOTE_MAX} characters`).optional().transform((v) => (v ? v : undefined)),
    new_status: z.string().optional().transform((v) => (v ? v : undefined)),
    resolution: z.string().trim().max(DESCRIPTION_MAX, `At most ${DESCRIPTION_MAX} characters`).optional().transform((v) => (v ? v : undefined)),
  })
  .superRefine((v, ctx) => {
    if (v.action_type !== 'STATUS_CHANGE' && !v.notes) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'A note is required' });
    if (v.action_type === 'STATUS_CHANGE') {
      if (!v.new_status || !(STATUSES as readonly string[]).includes(v.new_status)) ctx.addIssue({ code: 'custom', path: ['new_status'], message: 'Select the new status' });
      else if ((NEEDS_RESOLUTION as readonly string[]).includes(v.new_status) && !v.resolution) ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'A resolution text is required' });
    }
  });
export type ActionInput = z.input<typeof actionSchema>;
export type ActionValues = z.output<typeof actionSchema>;

export const categorySchema = z.object({ category_code: z.string().trim().min(1, 'Code is required').max(30, 'At most 30 characters'), category_name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters') });
export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryValues = z.output<typeof categorySchema>;

export const listParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;

export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
