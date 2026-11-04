import { z } from 'zod';

export const AUDIENCES = ['ALL', 'STUDENTS', 'STAFF', 'DEPARTMENT'] as const;
export const STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export const TITLE_MAX = 250;
export const TEXT_MAX = 20000;

export const audienceLabel: Record<string, string> = { ALL: 'Students and staff', STUDENTS: 'Students', STAFF: 'Staff', DEPARTMENT: 'Everyone in the department' };

const dateTime = (what: string) => z.string().min(1, `${what} is required`).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use a valid date and time');
const optDateTime = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v), 'Use a valid date and time');

export const announcementSchema = z
  .object({
    announcement_type_id: z.string().min(1, 'Select a type').regex(/^\d{1,15}$/, 'Select a type').transform(Number),
    /** '' = institution-wide */
    department_id: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,15}$/.test(v), 'Select a valid department').transform((v) => (v === undefined ? undefined : Number(v))),
    title: z.string().trim().min(1, 'The title is required').max(TITLE_MAX, `At most ${TITLE_MAX} characters`),
    description: z.string().trim().min(1, 'The text is required').max(TEXT_MAX, `At most ${TEXT_MAX} characters`),
    publish_from: dateTime('Publication start'),
    publish_to: optDateTime,
    audience_type: z.enum(AUDIENCES, { message: 'Select an audience' }),
  })
  .refine((v) => !v.publish_to || v.publish_to > v.publish_from, { path: ['publish_to'], message: 'The end must be after the start' })
  .refine((v) => v.audience_type !== 'DEPARTMENT' || v.department_id !== undefined, { path: ['department_id'], message: 'A department audience needs a department' });
export type AnnouncementInput = z.input<typeof announcementSchema>;
export type AnnouncementValues = z.output<typeof announcementSchema>;

export const listParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;

export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** datetime-local value for an ISO timestamp, in the browser's local zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
