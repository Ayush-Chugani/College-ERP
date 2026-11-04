import { z } from 'zod';

export const AUDIENCES = ['ALL', 'STUDENTS', 'STAFF', 'DEPARTMENT', 'PROGRAMME', 'CUSTOM'] as const;
export const STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
/** Mirrors the database transition rules (migration 040); drift-tested. */
export const TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PENDING'],
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['ARCHIVED'],
  REJECTED: ['DRAFT'],
  ARCHIVED: [],
};
/** Statuses whose transition needs COMMUNICATION.ALL.APPROVE (the others need UPDATE). */
export const APPROVER_TARGETS = ['APPROVED', 'REJECTED'] as const;
export const EDITABLE = ['DRAFT', 'REJECTED'] as const;
export const TITLE_MAX = 250;
export const DESCRIPTION_MAX = 10000;

const optId = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,15}$/.test(v), 'Select a valid option').transform((v) => (v === undefined ? undefined : Number(v)));
const dateTime = (msg: string) => z.string().min(1, msg).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date and time');

export const announcementSchema = z
  .object({
    announcement_type_id: z.string().min(1, 'Select a type').regex(/^\d{1,15}$/, 'Select a type').transform(Number),
    department_id: optId,
    title: z.string().trim().min(1, 'The title is required').max(TITLE_MAX, `At most ${TITLE_MAX} characters`),
    description: z.string().trim().min(1, 'The description is required').max(DESCRIPTION_MAX, `At most ${DESCRIPTION_MAX} characters`),
    audience_type: z.enum(AUDIENCES, { message: 'Select an audience' }),
    publish_from: dateTime('The publish-from date is required'),
    publish_to: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), 'Enter a valid date and time'),
  })
  .superRefine((v, ctx) => {
    if ((v.audience_type === 'DEPARTMENT' || v.audience_type === 'PROGRAMME') && v.department_id === undefined) ctx.addIssue({ code: 'custom', path: ['department_id'], message: 'Select the department for this audience' });
    if (v.publish_to && new Date(v.publish_to) <= new Date(v.publish_from)) ctx.addIssue({ code: 'custom', path: ['publish_to'], message: 'Must be later than the publish-from date' });
  });
export type AnnouncementInput = z.input<typeof announcementSchema>;
export type AnnouncementValues = z.output<typeof announcementSchema>;

export const listParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;

export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** <input type="datetime-local"> value (local time) from an ISO timestamp. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
