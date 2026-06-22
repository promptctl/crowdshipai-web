import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { effectiveSanction, type Sanction } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));

const permanent = (reason: string, issuedAt = 1_000): Sanction => ({
  reason,
  issuedAt: at(issuedAt),
  scope: { kind: 'permanent' },
});
const until = (untilMs: number, reason: string, issuedAt = 1_000): Sanction => ({
  reason,
  issuedAt: at(issuedAt),
  scope: { kind: 'until', until: at(untilMs) },
});

const NOW = at(5_000);

describe('effectiveSanction — the governing bar derived from an account log', () => {
  it('is null when there are no sanctions', () => {
    expect(effectiveSanction([], NOW)).toBeNull();
  });

  it('is null when the only sanction is a suspension that has already expired', () => {
    expect(effectiveSanction([until(4_999, 'cooldown')], NOW)).toBeNull();
  });

  it('treats a suspension as active up to but not including its instant', () => {
    // Active while now < until; at exactly `until` it has expired.
    expect(effectiveSanction([until(5_001, 'still cooling')], NOW)?.scope).toEqual({
      kind: 'until',
      until: at(5_001),
    });
    expect(effectiveSanction([until(5_000, 'just expired')], NOW)).toBeNull();
  });

  it('returns a permanent ban as the governing sanction', () => {
    expect(effectiveSanction([permanent('banned')], NOW)?.reason).toBe('banned');
  });

  it('lets a permanent ban outrank an active suspension', () => {
    const governing = effectiveSanction([until(9_000, 'suspended'), permanent('banned')], NOW);
    expect(governing?.scope.kind).toBe('permanent');
    expect(governing?.reason).toBe('banned');
  });

  it('among active suspensions picks the one reaching furthest into the future', () => {
    const governing = effectiveSanction(
      [until(6_000, 'short'), until(9_000, 'long'), until(7_000, 'mid')],
      NOW,
    );
    expect(governing?.reason).toBe('long');
  });

  it('ignores expired suspensions when a live one governs', () => {
    const governing = effectiveSanction([until(4_000, 'old'), until(8_000, 'current')], NOW);
    expect(governing?.reason).toBe('current');
  });
});
