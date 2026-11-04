import { z } from 'zod';

/** Mirrors migration 043; drift-tested. */
export const ACHIEVEMENTS = ['PARTICIPATION', 'WINNER', 'RUNNER_UP', 'FIRST_PLACE', 'SECOND_PLACE', 'THIRD_PLACE', 'MERIT', 'SPECIAL_MENTION', 'QUALIFIED', 'FINALIST', 'MEDAL_GOLD', 'MEDAL_SILVER', 'MEDAL_BRONZE', 'RECOGNITION', 'OTHER'] as const;
export const APPROVAL_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export const VERIFY_DECISIONS = ['VERIFIED', 'NEEDS_CORRECTION', 'REJECTED'] as const;
export const APPROVE_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export const TITLE_MAX = 500;
export const TEXT_MAX = 5000;

const optId = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,9}$/.test(v), 'Select a valid option').transform((v) => (v === undefined ? undefined : Number(v)));
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().transform((v) => (v ? v : undefined));
const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date');

export const activitySchema = z
  .object({
    student_activity_type_id: z.string().min(1, 'Select a type').regex(/^\d{1,9}$/, 'Select a type').transform(Number),
    activity_title: z.string().trim().min(1, 'The title is required').max(TITLE_MAX, `At most ${TITLE_MAX} characters`),
    event_name: optText(500),
    organizer_name: optText(300),
    team_name: optText(250),
    participation_role: optText(150),
    start_date: optDate,
    end_date: optDate,
    venue_name: optText(250),
    city: optText(120),
    achievement_type: z.enum(ACHIEVEMENTS, { message: 'Select an achievement' }),
    position_rank: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^[1-9]\d{0,4}$/.test(v), 'Enter a positive whole number').transform((v) => (v === undefined ? undefined : Number(v))),
    award_name: optText(500),
    activity_url: z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^https?:\/\/\S+$/i.test(v), 'Must start with http:// or https://'),
    description: optText(TEXT_MAX),
    outcomes: optText(TEXT_MAX),
    academic_year_id: optId,
    participation_level_id: optId,
    event_mode_id: optId,
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'The end date cannot be before the start date' });
  });
export type ActivityInput = z.input<typeof activitySchema>;
export type ActivityValues = z.output<typeof activitySchema>;

/** The jsonb payload for student_activity_save (undefined becomes null so every column is overwritten on edit). */
export function activityPayload(v: ActivityValues): Record<string, unknown> {
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? null]));
}

export const reviewSchema = z
  .object({ step: z.enum(['VERIFY', 'APPROVE']), decision: z.string().min(1, 'Select a decision'), remarks: optText(1000) })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.step === 'VERIFY' ? VERIFY_DECISIONS : APPROVE_DECISIONS;
    if (!allowed.includes(v.decision)) ctx.addIssue({ code: 'custom', path: ['decision'], message: 'Select a decision' });
    else if (v.decision !== 'VERIFIED' && v.decision !== 'APPROVED' && !v.remarks) ctx.addIssue({ code: 'custom', path: ['remarks'], message: 'Remarks are required for this decision' });
  });
export type ReviewInput = z.input<typeof reviewSchema>;
export type ReviewValues = z.output<typeof reviewSchema>;

export const teamSchema = z
  .object({ kind: z.enum(['STUDENT', 'EXTERNAL']), student_number: optText(50), external_name: optText(250), external_email: optText(254), role: optText(150), is_lead: z.boolean().optional() })
  .superRefine((v, ctx) => {
    if (v.kind === 'STUDENT' && !v.student_number) ctx.addIssue({ code: 'custom', path: ['student_number'], message: 'Enter the student number' });
    if (v.kind === 'EXTERNAL' && !v.external_name) ctx.addIssue({ code: 'custom', path: ['external_name'], message: 'Enter the member name' });
    if (v.external_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.external_email)) ctx.addIssue({ code: 'custom', path: ['external_email'], message: 'Enter a valid email' });
  });
export type TeamInput = z.input<typeof teamSchema>;
export type TeamValues = z.output<typeof teamSchema>;

export const evidenceSchema = z.object({
  document_type_id: z.string().min(1, 'Select a document type').regex(/^\d{1,9}$/, 'Select a document type').transform(Number),
  evidence_type_id: optId,
  title: z.string().trim().min(1, 'The title is required').max(500, 'At most 500 characters'),
  issue_date: optDate,
  issuing_authority: optText(300),
  certificate_number: optText(150),
});
export type EvidenceInput = z.input<typeof evidenceSchema>;
export type EvidenceValues = z.output<typeof evidenceSchema>;

export const listParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(APPROVAL_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;

export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
