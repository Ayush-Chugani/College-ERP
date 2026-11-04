import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loginAuditParams, mfaCodeSchema, NOTIFICATION_KINDS, PHONE_PATTERN, profilePayload, profileSchema, safeInternalHref, SEARCH_LABELS, SEARCH_ROUTES, searchParams } from '@/lib/account-validation';

describe('profile schema', () => {
  it('trims, blanks and normalises to the payload the RPC expects', () => {
    expect(profilePayload(profileSchema.parse({ primary_email: ' a@b.co ', primary_phone: ' ' }))).toEqual({ primary_email: 'a@b.co', primary_phone: '' });
    expect(profilePayload(profileSchema.parse({}))).toEqual({ primary_email: '', primary_phone: '' });
  });
  it('rejects bad emails and phones', () => {
    for (const bad of [{ primary_email: 'nope' }, { primary_email: 'a b@c.d' }, { primary_phone: 'call me' }, { primary_phone: '12' }, { primary_phone: '1'.repeat(26) }]) {
      expect(profileSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(profileSchema.safeParse({ primary_phone: '+91 (80) 1234-567' }).success).toBe(true);
  });
  it('uses the same phone rule as the database function (drift test)', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/045_account_features.sql'), 'utf8');
    expect(sql).toContain(PHONE_PATTERN.source.replace('^', '^').replace(/\\/g, '\\'));
  });
});

describe('MFA code', () => {
  it('accepts six digits, ignoring spaces', () => {
    expect(mfaCodeSchema.parse({ code: '123 456' }).code).toBe('123456');
    for (const bad of ['', '12345', '1234567', 'abcdef', '12-456']) expect(mfaCodeSchema.safeParse({ code: bad }).success, bad).toBe(false);
  });
});

describe('links and search', () => {
  it('only follows same-site notification links', () => {
    expect(safeInternalHref('/activities/5')).toBe('/activities/5');
    expect(safeInternalHref('/grievances?status=SUBMITTED')).toBe('/grievances?status=SUBMITTED');
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil', '', null, undefined, '/a\nb']) expect(safeInternalHref(bad as string | null | undefined), String(bad)).toBe('/dashboard');
  });
  it('every notification kind of the migration has a label', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/045_account_features.sql'), 'utf8');
    const kinds = [...sql.matchAll(/'(ANNOUNCEMENT|DOCUMENT|ACTIVITY|STAFF_RECORD|GRIEVANCE|TASK)'/g)].map((m) => m[1]);
    expect(new Set(kinds)).toEqual(new Set(Object.keys(NOTIFICATION_KINDS)));
  });
  it('search kinds all have a label and a route', () => {
    for (const k of Object.keys(SEARCH_LABELS)) expect(SEARCH_ROUTES[k]?.(7)).toMatch(/^\//);
    expect(SEARCH_ROUTES.student?.(7)).toBe('/students/7');
    expect(searchParams.parse({ q: '  ab ' }).q).toBe('ab');
    expect(searchParams.parse({}).q).toBeUndefined();
  });
  it('parses the sign-in log filters', () => {
    expect(loginAuditParams.parse({ result: 'failed', from: '2026-01-02', to: 'x', page: '3' })).toEqual({ q: undefined, result: 'failed', from: '2026-01-02', to: undefined, page: 3 });
    expect(loginAuditParams.parse({ result: 'maybe' }).result).toBeUndefined();
  });
});
