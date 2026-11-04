import { describe, expect, it } from 'vitest';
import { parseRowId } from '@/features/structure-data';
import { buildSchema, CONFIG, defaultValues, KINDS, parseKind, toPayload } from '@/lib/structure-config';

describe('kinds', () => {
  it('only known slugs are accepted', () => {
    for (const k of KINDS) expect(parseKind(k)).toBe(k);
    for (const bad of ['institution', 'users', '', '../x', 'campuses/1']) expect(parseKind(bad)).toBeNull();
  });
  it('every parent/child link is consistent with the hierarchy', () => {
    for (const k of KINDS) {
      const c = CONFIG[k];
      if (c.child) expect(CONFIG[c.child.kind].parent?.kind).toBe(k);
      if (c.parent) expect(CONFIG[c.parent.kind].child?.kind).toBe(k);
    }
    expect(CONFIG.institutions.viaRpc).toBe(true);
    expect(CONFIG.institutions.perms.delete).toBeUndefined(); // institutions are never deleted through the UI
  });
  it('route ids are positive integers only', () => {
    expect(parseRowId('5')).toBe(5);
    for (const bad of ['0', '-2', 'x', '1.5', '', '9'.repeat(20)]) expect(parseRowId(bad)).toBeNull();
  });
});

describe('campus schema', () => {
  const ok = { campus_code: 'MAIN', campus_name: 'Main Campus', is_active: true, institution_id: '1' };
  it('requires code, name and a parent on create, but not on edit', () => {
    expect(buildSchema('campuses', 'create').safeParse(ok).success).toBe(true);
    const { institution_id, ...noParent } = ok;
    void institution_id;
    expect(buildSchema('campuses', 'create').safeParse(noParent).success).toBe(false);
    expect(buildSchema('campuses', 'edit').safeParse(noParent).success).toBe(true);
    expect(buildSchema('campuses', 'create').safeParse({ ...ok, institution_id: '0' }).success).toBe(false);
    expect(buildSchema('campuses', 'create').safeParse({ ...ok, campus_code: ' ' }).success).toBe(false);
    expect(buildSchema('campuses', 'create').safeParse({ ...ok, campus_code: 'x'.repeat(21) }).success).toBe(false);
  });
  it('validates optional contact fields only when filled', () => {
    const s = buildSchema('campuses', 'edit');
    const base = { campus_code: 'A', campus_name: 'B', is_active: true };
    expect(s.safeParse({ ...base, email: '', phone: '' }).success).toBe(true);
    expect(s.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(s.safeParse({ ...base, phone: 'abc' }).success).toBe(false);
    expect(s.safeParse({ ...base, postal_code: 'x'.repeat(13) }).success).toBe(false);
  });
});

describe('institution / university schemas', () => {
  it('institution website must be http(s)', () => {
    const s = buildSchema('institutions', 'edit');
    const base = { institution_code: 'I1', institution_name: 'Inst', is_active: true };
    expect(s.safeParse({ ...base, website_url: 'https://x.org' }).success).toBe(true);
    expect(s.safeParse({ ...base, website_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(s.safeParse({ ...base, website_url: 'ftp://x.org' }).success).toBe(false);
  });
  it('university type must be one of the enum values', () => {
    const s = buildSchema('universities', 'edit');
    const base = { university_code: 'U', university_name: 'Uni', is_active: true };
    expect(s.safeParse({ ...base, university_type: 'STATE' }).success).toBe(true);
    expect(s.safeParse({ ...base, university_type: 'GALACTIC' }).success).toBe(false);
    expect(s.safeParse({ ...base, university_type: '' }).success).toBe(false);
  });
});

describe('programme schema', () => {
  const ok = { programme_code: 'BE-CS', programme_name: 'BE CS', programme_level: 'UG', duration_semesters: '8', is_active: true, department_id: '2' };
  it('duration is a whole number 1..255 and the maximum cannot be below it', () => {
    const s = buildSchema('programmes', 'create');
    expect(s.safeParse(ok).success).toBe(true);
    expect(s.safeParse({ ...ok, duration_semesters: '0' }).success).toBe(false);
    expect(s.safeParse({ ...ok, duration_semesters: '256' }).success).toBe(false);
    expect(s.safeParse({ ...ok, duration_semesters: '8.5' }).success).toBe(false);
    expect(s.safeParse({ ...ok, duration_semesters: '' }).success).toBe(false);
    expect(s.safeParse({ ...ok, maximum_duration_semesters: '6' }).success).toBe(false);
    expect(s.safeParse({ ...ok, maximum_duration_semesters: '12' }).success).toBe(true);
    expect(s.safeParse({ ...ok, programme_level: 'MASTERS' }).success).toBe(false);
  });
});

describe('payloads and defaults', () => {
  it('blanks become null, numbers become numbers, parent is included on create only', () => {
    const v = { programme_code: ' BE ', programme_name: 'BE', award_name: '', programme_level: 'UG', duration_semesters: '8', maximum_duration_semesters: '', is_active: false, department_id: '3' };
    const create = toPayload('programmes', v, 'create');
    expect(create).toMatchObject({ programme_code: 'BE', award_name: null, duration_semesters: 8, maximum_duration_semesters: null, is_active: false, department_id: 3 });
    expect(toPayload('programmes', v, 'edit')).not.toHaveProperty('department_id');
  });
  it('defaults: active, university type OTHER, blank strings', () => {
    expect(defaultValues('universities')).toMatchObject({ is_active: true, university_type: 'OTHER', university_code: '' });
    expect(defaultValues('programmes')).toMatchObject({ is_active: true, programme_level: '' });
  });
});
