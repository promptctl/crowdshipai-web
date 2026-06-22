import type { Result } from '@crowdship/std';
import {
  actorRef,
  CLEAR,
  isIncident,
  publishedSurface,
  type HardLineVerdict,
  type PolicySubject,
} from '@crowdship/moderation';
import { describe, expect, it } from 'vitest';

import { getPolicyBoundary } from '../src/server/policy';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const mediaSubject = (verdict: HardLineVerdict): PolicySubject => ({
  kind: 'published-media',
  author: must(actorRef('builder-1')),
  surface: must(publishedSurface('stream-frame')),
  verdict,
});

describe('hard-line enforcement through the one policy boundary', () => {
  const boundary = getPolicyBoundary();

  it('denies published media a classifier found prohibited, carrying its reason', () => {
    const decision = boundary.decide(
      mediaSubject({ kind: 'prohibited', reason: 'nudity involving a person' }),
    );

    expect(decision.outcome).toBe('denied');
    if (decision.outcome === 'denied') {
      expect(decision.violations.map((v) => v.reason)).toContain('nudity involving a person');
    }
  });

  it('allows published media that screened clear', () => {
    expect(boundary.decide(mediaSubject(CLEAR))).toEqual({ outcome: 'allowed' });
  });

  it('classifies a hard-line deny as a review-queue incident with no extra plumbing', () => {
    // The free win from o97.4: any denied decision is an incident, so once the recording
    // edge logs it, the same queue projection that surfaces conduct and content denials
    // surfaces a hard-line hit too — nothing o97.6 had to build.
    const decision = boundary.decide(mediaSubject({ kind: 'prohibited', reason: 'sexual content' }));

    expect(isIncident(decision)).toBe(true);
  });
});
