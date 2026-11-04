import { describe, expect, it } from 'vitest';
import { authCreateMessage, passwordProblem, provisionSchema } from '@/lib/user-provisioning';

describe('passwordProblem', () => {
  it('accepts a strong password', () => {
    expect(passwordProblem('Correct-Horse-42', 'user@example.org')).toBeNull();
  });
  it('rejects short, one-kind, common and email-derived passwords', () => {
    expect(passwordProblem('Ab1', 'u@example.org')).toMatch(/at least 10/);
    expect(passwordProblem('abcdefghijkl', 'u@example.org')).toMatch(/letters and at least one number/);
    expect(passwordProblem('1234567890123', 'u@example.org')).toMatch(/letters and at least one number/);
    expect(passwordProblem('Password123', 'u@example.org')).toMatch(/too common/);
    expect(passwordProblem('x'.repeat(73) + '1', 'u@example.org')).toMatch(/at most 72/);
    expect(passwordProblem('Xx-maria.silva-99', 'maria.silva@example.org')).toMatch(/email name/);
  });
  it('the weak demo password admin@123 is refused', () => {
    expect(passwordProblem('admin@123', 'admin@example.org')).not.toBeNull();
  });
});

describe('provisionSchema', () => {
  const ok = { email: ' New.User@Example.ORG ', password: 'Correct-Horse-42', confirm: 'Correct-Horse-42', student_number: '', employee_number: '' };
  it('normalises the email and treats blank links as absent', () => {
    expect(provisionSchema.parse(ok)).toEqual({ email: 'new.user@example.org', password: 'Correct-Horse-42', confirm: 'Correct-Horse-42', student_number: undefined, employee_number: undefined });
  });
  it('rejects mismatched passwords, bad emails and links to both a student and an employee', () => {
    expect(provisionSchema.safeParse({ ...ok, confirm: 'Different-Horse-42' }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, email: '' }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, password: 'short1', confirm: 'short1' }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, student_number: 'S1', employee_number: 'E1' }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, student_number: 'S'.repeat(41) }).success).toBe(false);
    expect(provisionSchema.safeParse({ ...ok, student_number: ' S1 ' }).success).toBe(true);
  });
});

describe('authCreateMessage', () => {
  it('maps Auth admin errors to safe messages and never echoes raw text', () => {
    expect(authCreateMessage('A user with this email address has already been registered', 422)).toMatch(/already exists/);
    expect(authCreateMessage('Password should be at least 6 characters', 422)).toMatch(/already exists|password/i);
    expect(authCreateMessage('Password is too weak', 400)).toMatch(/password/i);
    expect(authCreateMessage('Unable to validate email address: invalid format', 400)).toMatch(/email/i);
    expect(authCreateMessage('database exploded: secret details', 500)).toBe('The Auth user could not be created.');
    expect(authCreateMessage(undefined, undefined)).toBe('The Auth user could not be created.');
  });
});
