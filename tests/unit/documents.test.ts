import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED, checkFile, extensionOf, formatSize, MAX_BYTES, reviewSchema, storageKey, uploadSchema } from '@/lib/document-validation';

describe('checkFile', () => {
  const ok = { name: 'Marks Card.PDF', type: 'application/pdf', size: 2048 };
  it('accepts PDF, JPEG and PNG up to 10 MB', () => {
    expect(checkFile(ok)).toBeNull();
    expect(checkFile({ name: 'a.jpeg', type: 'image/jpeg', size: 1 })).toBeNull();
    expect(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: MAX_BYTES })).toBeNull();
    expect(checkFile({ name: 'a.png', type: 'image/png', size: 5 })).toBeNull();
  });
  it('rejects other types, mismatched or missing extensions, empty and oversize files', () => {
    expect(checkFile({ ...ok, type: 'text/html' })).toMatch(/Only PDF/);
    expect(checkFile({ name: 'a.exe', type: 'application/pdf', size: 5 })).toMatch(/does not match/);
    expect(checkFile({ name: 'noext', type: 'application/pdf', size: 5 })).toMatch(/does not match/);
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_BYTES + 1 })).toMatch(/10 MB/);
    expect(checkFile({ name: 'x'.repeat(256) + '.pdf', type: 'application/pdf', size: 5 })).toMatch(/too long/);
  });
  it('mirrors the database function and bucket (drift test)', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/042_student_documents.sql'), 'utf8');
    for (const mime of Object.keys(ALLOWED)) expect(sql).toContain(`'${mime}'`);
    expect(sql).toContain(String(MAX_BYTES));
    for (const exts of Object.values(ALLOWED)) for (const e of exts) expect(sql).toContain(`'${e}'`);
  });
});

describe('storageKey', () => {
  it('builds student/<id>/<random>-<safe name> without path separators', () => {
    expect(storageKey(7, 'My Marks (final).pdf', 'abc')).toBe('student/7/abc-My_Marks_final_.pdf');
    expect(storageKey(7, '../../etc/passwd', 'abc')).toBe('student/7/abc-etc_passwd');
    expect(storageKey(7, '...', 'abc')).toBe('student/7/abc-file');
    expect(storageKey(7, 'x'.repeat(300) + '.pdf', 'abc').split('/')).toHaveLength(3);
    expect(extensionOf('a.b.PNG')).toBe('png');
    expect(extensionOf('none')).toBeNull();
  });
});

describe('schemas', () => {
  it('upload: type required, dates ordered, optional fields trimmed away', () => {
    expect(uploadSchema.parse({ document_type_id: '3', document_number: ' ', issue_date: '', expiry_date: '' })).toEqual({ document_type_id: 3, document_number: undefined, issue_date: undefined, expiry_date: undefined });
    expect(uploadSchema.safeParse({ document_type_id: '' }).success).toBe(false);
    expect(uploadSchema.safeParse({ document_type_id: '3', issue_date: '2024-02-01', expiry_date: '2024-01-01' }).success).toBe(false);
    expect(uploadSchema.safeParse({ document_type_id: '3', issue_date: '01/02/2024' }).success).toBe(false);
  });
  it('review: rejecting needs remarks', () => {
    expect(reviewSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: 'REJECTED', remarks: 'blurry' }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: 'VERIFIED' }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: 'PENDING' }).success).toBe(false);
  });
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
