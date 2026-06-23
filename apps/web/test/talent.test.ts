import { GENERAL_AUDIENCE } from '@crowdship/moderation';
import { describe, expect, it } from 'vitest';

import { surfaceTalent } from '../src/data/talent';
import type { StreamSummary } from '../src/data/types';

/**
 * The recruiter lens is a pure projection of the roster: a skill rail to pivot on
 * and candidates ordered for hiring. These tests pin that point of view — live
 * builders surface first (watch them think now), the rail counts every craft, and
 * a craft no one lists yields an honest empty list, never an error.
 */

/** A minimal candidate fixture — only the fields the lens reads carry signal; the
 *  rest are plausible constants so each test states just what it is about. */
const candidate = (over: Partial<StreamSummary> & Pick<StreamSummary, 'slug' | 'builderName'>): StreamSummary => ({
  title: 'building something',
  tags: [],
  viewerCount: 0,
  isLive: false,
  accentHue: 0,
  maturity: GENERAL_AUDIENCE,
  ...over,
});

describe('surfaceTalent', () => {
  it('surveys everyone when no skill is active, live builders first', () => {
    const roster = [
      candidate({ slug: 'a', builderName: 'ana', isLive: false }),
      candidate({ slug: 'b', builderName: 'bo', isLive: true }),
    ];
    const view = surfaceTalent(roster, null);
    expect(view.activeSkill).toBeNull();
    expect(view.candidates.map((c) => c.slug)).toEqual(['b', 'a']);
  });

  it('orders live-first, then by audience, then by name for a stable rail', () => {
    const roster = [
      candidate({ slug: 'offline', builderName: 'zed', isLive: false, viewerCount: 9000 }),
      candidate({ slug: 'small-live', builderName: 'mara', isLive: true, viewerCount: 10 }),
      candidate({ slug: 'big-live', builderName: 'dex', isLive: true, viewerCount: 500 }),
      candidate({ slug: 'tied-live', builderName: 'abe', isLive: true, viewerCount: 10 }),
    ];
    // big-live (500) ; then the two tied at 10 broken by name abe<mara ; offline last despite 9000 viewers.
    expect(surfaceTalent(roster, null).candidates.map((c) => c.slug)).toEqual([
      'big-live',
      'tied-live',
      'small-live',
      'offline',
    ]);
  });

  it('builds the skill rail from every candidate, most-common craft first then alphabetical', () => {
    const roster = [
      candidate({ slug: 'a', builderName: 'ana', tags: ['rust', 'compilers'] }),
      candidate({ slug: 'b', builderName: 'bo', tags: ['rust', 'gamedev'] }),
      candidate({ slug: 'c', builderName: 'cy', tags: ['rust'] }),
    ];
    // rust: 3 ; compilers & gamedev: 1 each, broken alphabetically.
    expect(surfaceTalent(roster, null).skills).toEqual([
      { skill: 'rust', count: 3 },
      { skill: 'compilers', count: 1 },
      { skill: 'gamedev', count: 1 },
    ]);
  });

  it('narrows candidates to one craft while keeping the full rail', () => {
    const roster = [
      candidate({ slug: 'a', builderName: 'ana', tags: ['rust'], isLive: true }),
      candidate({ slug: 'b', builderName: 'bo', tags: ['ffmpeg'], isLive: true }),
      candidate({ slug: 'c', builderName: 'cy', tags: ['rust', 'ffmpeg'] }),
    ];
    const view = surfaceTalent(roster, 'rust');
    expect(view.activeSkill).toBe('rust');
    expect(view.candidates.map((c) => c.slug)).toEqual(['a', 'c']);
    // The rail is still every craft, so the recruiter can pivot away from rust.
    expect(view.skills.map((s) => s.skill)).toEqual(['ffmpeg', 'rust']);
  });

  it('yields an empty candidate list but a full rail when no one lists the craft', () => {
    const roster = [candidate({ slug: 'a', builderName: 'ana', tags: ['rust'] })];
    const view = surfaceTalent(roster, 'cobol');
    expect(view.candidates).toEqual([]);
    expect(view.skills).toEqual([{ skill: 'rust', count: 1 }]);
  });

  it('is empty in both rail and candidates for an empty roster', () => {
    expect(surfaceTalent([], null)).toEqual({ skills: [], candidates: [], activeSkill: null });
  });
});
