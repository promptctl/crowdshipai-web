import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OVERLAY_STYLE,
  OVERLAY_DURATION_SECONDS,
  OVERLAY_PLACEMENTS,
  overlayStyleFrom,
  overlayStyleProblems,
} from '../src/data/overlay-style';

/**
 * The one style validator draws the whole legal/illegal line for every boundary that
 * admits a style — authoring, the SSE wire, the durable decode [LAW:single-enforcer].
 * These tests are its accept/reject table verbatim: every reject row perturbs exactly
 * one invariant while the others hold, so a gap cannot hide behind a happy path.
 */

const legal = { placement: 'top-right', accentHue: 200, durationSeconds: 5 };

describe('overlayStyleFrom: the accept set', () => {
  it('accepts every placement in the closed set', () => {
    for (const placement of OVERLAY_PLACEMENTS) {
      expect(overlayStyleFrom({ ...legal, placement })).toEqual({ ...legal, placement });
    }
  });

  it('accepts both hue bounds — the wheel is inclusive at 0 and 360', () => {
    expect(overlayStyleFrom({ ...legal, accentHue: 0 })).toEqual({ ...legal, accentHue: 0 });
    expect(overlayStyleFrom({ ...legal, accentHue: 360 })).toEqual({ ...legal, accentHue: 360 });
  });

  it('accepts both residency bounds', () => {
    const { min, max } = OVERLAY_DURATION_SECONDS;
    expect(overlayStyleFrom({ ...legal, durationSeconds: min })).toEqual({ ...legal, durationSeconds: min });
    expect(overlayStyleFrom({ ...legal, durationSeconds: max })).toEqual({ ...legal, durationSeconds: max });
  });

  it('accepts the named default itself — the baseline is always a legal style', () => {
    expect(overlayStyleFrom(DEFAULT_OVERLAY_STYLE)).toEqual(DEFAULT_OVERLAY_STYLE);
  });

  it('tolerates unknown extra fields but never carries them into the value — open growth, closed value', () => {
    expect(overlayStyleFrom({ ...legal, futureAxis: 'sparkles' })).toEqual(legal);
  });
});

describe('overlayStyleFrom: the reject set — not an object at all', () => {
  it.each([null, undefined, 'bottom-left', 42, true])('rejects %s', (value) => {
    expect(overlayStyleFrom(value)).toBeNull();
  });

  it('rejects an array, which is object-typed but holds no axes', () => {
    expect(overlayStyleFrom([legal])).toBeNull();
  });
});

describe('overlayStyleFrom: the reject set — one invariant perturbed, others held', () => {
  it.each([
    ['a corner outside the set', { ...legal, placement: 'center' }],
    ['a case-shifted corner', { ...legal, placement: 'TOP-LEFT' }],
    ['a non-string placement', { ...legal, placement: 3 }],
    ['a missing placement', { accentHue: legal.accentHue, durationSeconds: legal.durationSeconds }],
    ['a hue below the wheel', { ...legal, accentHue: -1 }],
    ['a hue past the wheel', { ...legal, accentHue: 361 }],
    ['a fractional hue', { ...legal, accentHue: 12.5 }],
    ['a numeric-string hue', { ...legal, accentHue: '200' }],
    ['a NaN hue', { ...legal, accentHue: Number.NaN }],
    ['a missing hue', { placement: legal.placement, durationSeconds: legal.durationSeconds }],
    ['a residency below the floor', { ...legal, durationSeconds: OVERLAY_DURATION_SECONDS.min - 1 }],
    ['a residency past the ceiling', { ...legal, durationSeconds: OVERLAY_DURATION_SECONDS.max + 1 }],
    ['a fractional residency', { ...legal, durationSeconds: 2.5 }],
    ['a numeric-string residency', { ...legal, durationSeconds: '8' }],
    ['a missing residency', { placement: legal.placement, accentHue: legal.accentHue }],
  ])('rejects %s', (_name, value) => {
    expect(overlayStyleFrom(value)).toBeNull();
  });
});

describe('overlayStyleProblems: the diagnosing face of the same line', () => {
  it('names no problems for a legal style', () => {
    expect(overlayStyleProblems(legal)).toEqual([]);
  });

  it('names exactly the perturbed axis', () => {
    expect(overlayStyleProblems({ ...legal, accentHue: 999 })).toEqual(['accentHue']);
    expect(overlayStyleProblems({ ...legal, placement: 'center' })).toEqual(['placement']);
    expect(overlayStyleProblems({ ...legal, durationSeconds: 0 })).toEqual(['durationSeconds']);
  });

  it('names every failing axis at once, never just the first [LAW:no-silent-failure]', () => {
    expect(overlayStyleProblems({ placement: 'center', accentHue: -1, durationSeconds: 0 })).toEqual([
      'placement',
      'accentHue',
      'durationSeconds',
    ]);
  });

  it('a non-object fails every axis — it holds no legal value on any of them', () => {
    expect(overlayStyleProblems('not a style')).toEqual(['placement', 'accentHue', 'durationSeconds']);
  });

  it('agrees with overlayStyleFrom on every judgment — one line, two faces [LAW:single-enforcer]', () => {
    const candidates = [
      legal,
      DEFAULT_OVERLAY_STYLE,
      { ...legal, placement: 'center' },
      { ...legal, accentHue: 361 },
      { ...legal, durationSeconds: 1 },
      null,
      [],
    ];
    for (const candidate of candidates) {
      expect(overlayStyleFrom(candidate) === null).toBe(overlayStyleProblems(candidate).length > 0);
    }
  });
});
