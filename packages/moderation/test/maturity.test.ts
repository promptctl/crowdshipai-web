import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  contentDescriptor,
  GENERAL_AUDIENCE,
  maturityAtLeast,
  maturityLevel,
  maturityRating,
  MATURITY_LEVELS,
  type ContentDescriptor,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a rejected input in a test that
 *  expected success is a broken test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const descriptor = (raw: string): ContentDescriptor => must(contentDescriptor(raw));

describe('maturity level — a closed, ordered, platform-owned scale', () => {
  it('accepts every tier the platform defines', () => {
    for (const tier of MATURITY_LEVELS) {
      expect(maturityLevel(tier)).toEqual({ ok: true, value: tier });
    }
  });

  it('rejects a tier outside the closed scale, loudly', () => {
    expect(maturityLevel('nc-17')).toEqual({
      ok: false,
      error: { kind: 'unknown-maturity-level', value: 'nc-17' },
    });
    expect(maturityLevel('')).toEqual({
      ok: false,
      error: { kind: 'unknown-maturity-level', value: '' },
    });
  });

  it('lists the tiers in ascending order — the single source of order', () => {
    expect(MATURITY_LEVELS).toEqual(['general', 'teen', 'mature', 'adult']);
  });
});

describe('maturityAtLeast — the one ordering primitive', () => {
  it('is reflexive: a level meets its own floor', () => {
    for (const tier of MATURITY_LEVELS) {
      expect(maturityAtLeast(tier, tier)).toBe(true);
    }
  });

  it('reads the canonical order, not a hand-coded sequence', () => {
    expect(maturityAtLeast('adult', 'general')).toBe(true);
    expect(maturityAtLeast('mature', 'teen')).toBe(true);
    expect(maturityAtLeast('general', 'mature')).toBe(false);
    expect(maturityAtLeast('teen', 'adult')).toBe(false);
  });

  it('agrees with MATURITY_LEVELS for every pair — order has one source', () => {
    MATURITY_LEVELS.forEach((a, ai) => {
      MATURITY_LEVELS.forEach((b, bi) => {
        expect(maturityAtLeast(a, b)).toBe(ai >= bi);
      });
    });
  });
});

describe('content descriptor — an open label, not a flag in a soup', () => {
  it('takes any non-blank kind verbatim, so new kinds need no platform change', () => {
    expect(must(contentDescriptor('violence'))).toBe('violence');
    expect(must(contentDescriptor('loot-boxes'))).toBe('loot-boxes');
  });

  it('rejects a blank label at the trust boundary', () => {
    expect(contentDescriptor('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'contentDescriptor' } });
    expect(contentDescriptor('')).toEqual({ ok: false, error: { kind: 'blank', label: 'contentDescriptor' } });
  });
});

describe('maturityRating — the canonical data value', () => {
  it('carries one ordered level and a set of open content kinds', () => {
    const rating = maturityRating('mature', [descriptor('violence'), descriptor('gambling')]);

    expect(rating.level).toBe('mature');
    expect(rating.descriptors).toEqual(['violence', 'gambling']);
  });

  it('canonicalizes the descriptor set: duplicates collapse, first occurrence wins', () => {
    const rating = maturityRating('teen', [
      descriptor('violence'),
      descriptor('language'),
      descriptor('violence'),
    ]);

    expect(rating.descriptors).toEqual(['violence', 'language']);
  });

  it('a level with no flagged kinds is an empty descriptor set, not a missing field', () => {
    expect(maturityRating('general', [])).toEqual({ level: 'general', descriptors: [] });
  });

  it('GENERAL_AUDIENCE is the named baseline rating', () => {
    expect(GENERAL_AUDIENCE).toEqual({ level: 'general', descriptors: [] });
  });

  it('GENERAL_AUDIENCE is immutable at runtime, not only by type — a shared singleton stays uncorrupted', () => {
    expect(Object.isFrozen(GENERAL_AUDIENCE)).toBe(true);
    expect(Object.isFrozen(GENERAL_AUDIENCE.descriptors)).toBe(true);
  });
});
