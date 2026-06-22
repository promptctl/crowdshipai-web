import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  CLEAR,
  conductAction,
  createHardLineRule,
  createPolicyBoundary,
  maturityRating,
  policyRuleId,
  publishedSurface,
  type ContentDescriptor,
  type HardLineVerdict,
  type MaturityLevel,
  type PolicyRule,
  type PolicySubject,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const RULE_ID = must(policyRuleId('hard-line'));
const rule: PolicyRule = createHardLineRule(RULE_ID);

const author = must(actorRef('builder-1'));
const frame = must(publishedSurface('stream-frame'));

const media = (verdict: HardLineVerdict): PolicySubject => ({
  kind: 'published-media',
  author,
  surface: frame,
  verdict,
});

describe('the hard-line rule', () => {
  it('is silent on media a classifier passed — no finding', () => {
    expect(rule.evaluate(media(CLEAR))).toEqual([]);
  });

  it('denies prohibited media, carrying the classifier reason on the violation', () => {
    const findings = rule.evaluate(media({ kind: 'prohibited', reason: 'nudity involving a person' }));
    expect(findings).toEqual([{ kind: 'violation', rule: RULE_ID, reason: 'nudity involving a person' }]);
  });

  it('denies regardless of the surface — the hard line holds on any published media', () => {
    const avatar: PolicySubject = {
      kind: 'published-media',
      author,
      surface: must(publishedSurface('avatar')),
      verdict: { kind: 'prohibited', reason: 'sexual content' },
    };
    expect(rule.evaluate(avatar)).toEqual([{ kind: 'violation', rule: RULE_ID, reason: 'sexual content' }]);
  });

  it('is silent on every arm it does not own — text, conduct, and access are not its concern', () => {
    const text: PolicySubject = {
      kind: 'published-text',
      author,
      surface: must(publishedSurface('bio')),
      text: 'a bio',
    };
    const conduct: PolicySubject = {
      kind: 'actor-conduct',
      actor: author,
      action: must(conductAction('go-live')),
      standing: { kind: 'in-good-standing' },
    };
    const access: PolicySubject = {
      kind: 'viewer-access',
      viewer: author,
      rating: maturityRating('mature' as MaturityLevel, [] as ContentDescriptor[]),
      clearance: 'general' as MaturityLevel,
    };

    expect(rule.evaluate(text)).toEqual([]);
    expect(rule.evaluate(conduct)).toEqual([]);
    expect(rule.evaluate(access)).toEqual([]);
  });
});

describe('the hard-line rule composed into the one boundary', () => {
  const boundary = createPolicyBoundary([rule]);

  it('denies prohibited media through decide(), with the classifier reason', () => {
    const decision = boundary.decide(media({ kind: 'prohibited', reason: 'pornography involving people' }));
    expect(decision).toEqual({
      outcome: 'denied',
      violations: [{ kind: 'violation', rule: RULE_ID, reason: 'pornography involving people' }],
    });
  });

  it('allows clear media through decide()', () => {
    expect(boundary.decide(media(CLEAR))).toEqual({ outcome: 'allowed' });
  });
});
