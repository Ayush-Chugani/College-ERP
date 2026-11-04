import { describe, expect, it } from 'vitest';
import { parseId } from '@/features/iam-data';
import { assignSchema, auditParams, endOfDay, statusSchema, userListParams } from '@/lib/iam-validation';

describe('status schema', () => {
  it('needs a reason to disable or lock, not to activate', () => {
    expect(statusSchema.safeParse({ account_status: 'DISABLED' }).success).toBe(false);
    expect(statusSchema.safeParse({ account_status: 'LOCKED', reason: '  ' }).success).toBe(false);
    expect(statusSchema.parse({ account_status: 'DISABLED', reason: ' left ' }).reason).toBe('left');
    expect(statusSchema.safeParse({ account_status: 'ACTIVE' }).success).toBe(true);
    expect(statusSchema.safeParse({ account_status: 'EXPIRED' }).success).toBe(false);
    expect(statusSchema.safeParse({ account_status: 'ACTIVE', reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
describe('assign schema', () => {
  it('parses ids and treats scope and reason as optional', () => {
    expect(assignSchema.parse({ role_id: '4', scope_entity_id: '', reason: '' })).toEqual({ role_id: 4, scope_entity_id: undefined, reason: undefined });
    expect(assignSchema.parse({ role_id: '4', scope_entity_id: '7' }).scope_entity_id).toBe(7);
    expect(assignSchema.safeParse({ role_id: '' }).success).toBe(false);
    expect(assignSchema.safeParse({ role_id: '4', scope_entity_id: 'x' }).success).toBe(false);
  });
});
describe('list params', () => {
  it('falls back on bad input', () => {
    expect(userListParams.parse({ status: 'BAD', page: '-1' })).toEqual({ q: undefined, status: undefined, page: 1 });
    expect(auditParams.parse({ from: '2026-02-30x', to: '2026-03-01', module: ' IAM ', page: '2' })).toMatchObject({ from: undefined, to: '2026-03-01', module: 'IAM', page: 2 });
  });
  it('end of day is the next midnight (UTC)', () => {
    expect(endOfDay('2026-02-28')).toBe('2026-03-01T00:00:00.000Z');
    expect(endOfDay('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
  });
  it('parses ids strictly', () => {
    expect(parseId('15')).toBe(15);
    expect(parseId('0')).toBeNull();
    expect(parseId('-3')).toBeNull();
    expect(parseId('1.5')).toBeNull();
  });
});
