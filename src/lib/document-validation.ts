import { z } from 'zod';

export const BUCKET = 'sims-documents';
export const MAX_BYTES = 10 * 1024 * 1024;
/** Mirrors the bucket settings and student_document_register (migration 042); drift-tested. */
export const ALLOWED: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};
export const REMARKS_MAX = 500;

export function extensionOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1]!.toLowerCase() : null;
}

/** Returns an error message, or null when the file may be uploaded. */
export function checkFile(f: { name: string; type: string; size: number }): string | null {
  if (!f.name || f.name.length > 255) return 'The file name is missing or too long';
  const exts = ALLOWED[f.type];
  if (!exts) return 'Only PDF, JPEG and PNG files are accepted';
  const ext = extensionOf(f.name);
  if (!ext || !exts.includes(ext)) return 'The file name does not match its type';
  if (f.size <= 0) return 'The file is empty';
  if (f.size > MAX_BYTES) return 'The file is larger than 10 MB';
  return null;
}

/** <student|employee>/<id>/<random>-<safe name>; the random part keeps names unique and unguessable. */
export function ownerStorageKey(kind: 'student' | 'employee' | 'announcement', ownerId: number, fileName: string, random: string): string {
  const safe = fileName.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file';
  return `${kind}/${ownerId}/${random}-${safe}`;
}
export const storageKey = (studentId: number, fileName: string, random: string): string => ownerStorageKey('student', studentId, fileName, random);

const optDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date');
export const uploadSchema = z
  .object({
    document_type_id: z.string().min(1, 'Select a document type').regex(/^\d{1,9}$/, 'Select a document type').transform(Number),
    document_number: z.string().trim().max(100, 'At most 100 characters').optional().transform((v) => (v ? v : undefined)),
    issue_date: optDate,
    expiry_date: optDate,
  })
  .superRefine((v, ctx) => {
    if (v.issue_date && v.expiry_date && v.expiry_date < v.issue_date) ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: 'The expiry date cannot be before the issue date' });
  });
export type UploadInput = z.input<typeof uploadSchema>;
export type UploadValues = z.output<typeof uploadSchema>;

export const reviewSchema = z
  .object({ decision: z.enum(['VERIFIED', 'REJECTED'], { message: 'Select a decision' }), remarks: z.string().trim().max(REMARKS_MAX, `At most ${REMARKS_MAX} characters`).optional().transform((v) => (v ? v : undefined)) })
  .superRefine((v, ctx) => {
    if (v.decision === 'REJECTED' && !v.remarks) ctx.addIssue({ code: 'custom', path: ['remarks'], message: 'Remarks are required to reject a document' });
  });
export type ReviewInput = z.input<typeof reviewSchema>;
export type ReviewValues = z.output<typeof reviewSchema>;

export const label = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
