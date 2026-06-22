import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  conductAction,
  createConductRule,
  createPolicyBoundary,
  IN_GOOD_STANDING,
  policyRuleId,
  publishedSurface,
  type ActorStanding,
  type PolicyRule,
  type PolicySubject,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const RULE_ID = must(policyRuleId('conduct'));
const rule: PolicyRule = createConductRule(RULE_ID);

const actor = must(actorRef('actor-1'));
const goLive = must(conductAction('go-live'));

const conduct = (standing: ActorStanding): PolicySubject => ({
  kind: 'actor-conduct',
  actor,
  action: goLive,
  standing,
});

describe('the conduct rule', () => {
  it('is silent on an actor in good standing — no finding', () => {
    expect(rule.evaluate(conduct(IN_GOOD_STANDING))).toEqual([]);
  });

  it('denies a barred actor, carrying the bar reason on the violation', () => {
    const findings = rule.evaluate(conduct({ kind: 'barred', reason: 'banned for harassment' }));
    expect(findings).toEqual([{ kind: 'violation', rule: RULE_ID, reason: 'banned for harassment' }]);
  });

  it('bars regardless of the action attempted — a barred actor may do nothing', () => {
    const postMessage = must(conductAction('post-message'));
    const barred: ActorStanding = { kind: 'barred', reason: 'suspended' };
    const subject: PolicySubject = { kind: 'actor-conduct', actor, action: postMessage, standing: barred };

    expect(rule.evaluate(subject)).toEqual([{ kind: 'violation', rule: RULE_ID, reason: 'suspended' }]);
  });

  it('is silent on every arm it does not own — content and access are not its concern', () => {
    const text: PolicySubject = {
      kind: 'published-text',
      author: actor,
      surface: must(publishedSurface('bio')),
      text: 'a bio',
    };
    const access: PolicySubject = {
      kind: 'viewer-access',
      viewer: actor,
      rating: { level: 'mature', descriptors: [] },
      clearance: 'general',
    };

    expect(rule.evaluate(text)).toEqual([]);
    expect(rule.evaluate(access)).toEqual([]);
  });
});

describe('the conduct rule composed into the one boundary', () => {
  const boundary = createPolicyBoundary([rule]);

  it('denies a barred actor through decide(), with the bar reason', () => {
    const decision = boundary.decide(conduct({ kind: 'barred', reason: 'banned: repeated abuse' }));
    expect(decision).toEqual({
      outcome: 'denied',
      violations: [{ kind: 'violation', rule: RULE_ID, reason: 'banned: repeated abuse' }],
    });
  });

  it('allows an actor in good standing through decide()', () => {
    expect(boundary.decide(conduct(IN_GOOD_STANDING))).toEqual({ outcome: 'allowed' });
  });
});
