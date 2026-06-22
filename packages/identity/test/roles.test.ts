import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_ROLES,
  NO_ROLES,
  ROLES,
  hasRole,
  role,
  roleSet,
  withRole,
  withoutRole,
  type Role,
} from '../src/index.js';

const aRole = fc.constantFrom<Role>(...ROLES);

describe('role constructor (the trust boundary)', () => {
  test.each(ROLES)('admits the known role %j', (r) => {
    expect(role(r)).toEqual({ ok: true, value: r });
  });

  test.each(['', 'admin', 'Builder', 'BACKER', 'recruiter ', 'owner'])('rejects unknown role %j', (raw) => {
    const r = role(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ kind: 'unknown-role', value: raw });
  });
});

describe('roleSet is canonical: deduplicated and ordered by ROLES', () => {
  test('duplicates collapse and order follows ROLES, not insertion order', () => {
    expect(roleSet(['recruiter', 'backer', 'builder', 'backer'])).toEqual(['backer', 'builder', 'recruiter']);
  });

  test('the empty set has no members; DEFAULT_ROLES is exactly backer', () => {
    expect(NO_ROLES).toEqual([]);
    expect(DEFAULT_ROLES).toEqual(['backer']);
  });

  test('property: any ordering/duplication of the same roles yields one canonical, deep-equal value', () => {
    fc.assert(
      fc.property(fc.array(aRole), (roles) => {
        const once = roleSet(roles);
        // Re-canonicalizing is a no-op, and a shuffled input lands on the same value.
        expect(roleSet(once)).toEqual(once);
        expect(roleSet([...roles].reverse())).toEqual(once);
        // Canonical means: a member appears at most once, in ROLES order.
        expect(once).toEqual(ROLES.filter((r) => roles.includes(r)));
      }),
    );
  });
});

describe('membership and the pure grant/revoke algebra', () => {
  test('hasRole reflects exactly what the set holds', () => {
    const set = roleSet(['backer', 'recruiter']);
    expect(hasRole(set, 'backer')).toBe(true);
    expect(hasRole(set, 'recruiter')).toBe(true);
    expect(hasRole(set, 'builder')).toBe(false);
  });

  test('property: withRole then hasRole is always true; the result stays canonical', () => {
    fc.assert(
      fc.property(fc.array(aRole), aRole, (roles, r) => {
        const granted = withRole(roleSet(roles), r);
        expect(hasRole(granted, r)).toBe(true);
        expect(roleSet(granted)).toEqual(granted);
      }),
    );
  });

  test('property: withoutRole then hasRole is always false', () => {
    fc.assert(
      fc.property(fc.array(aRole), aRole, (roles, r) => {
        expect(hasRole(withoutRole(roleSet(roles), r), r)).toBe(false);
      }),
    );
  });

  test('property: grant and revoke are idempotent — re-applying changes nothing', () => {
    fc.assert(
      fc.property(fc.array(aRole), aRole, (roles, r) => {
        const set = roleSet(roles);
        expect(withRole(withRole(set, r), r)).toEqual(withRole(set, r));
        expect(withoutRole(withoutRole(set, r), r)).toEqual(withoutRole(set, r));
      }),
    );
  });

  test('property: granting a held role, or revoking an absent one, returns an equal set', () => {
    fc.assert(
      fc.property(fc.array(aRole), aRole, (roles, r) => {
        const set = roleSet(roles);
        if (hasRole(set, r)) expect(withRole(set, r)).toEqual(set);
        else expect(withoutRole(set, r)).toEqual(set);
      }),
    );
  });
});
