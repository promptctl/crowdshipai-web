import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  conductAction,
  createMaturityGateRule,
  maturityRating,
  policyRuleId,
  publishedSurface,
  type ActorRef,
  type ContentDescriptor,
  type MaturityLevel,
  type PolicyRuleId,
  type PolicySubject,
  MATURITY_LEVELS,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const GATE_ID: PolicyRuleId = must(policyRuleId('maturity-gate'));
const rule = createMaturityGateRule(GATE_ID);

const viewer: ActorRef = must(actorRef('viewer-1'));

const access = (level: MaturityLevel, clearance: MaturityLevel): PolicySubject => ({
  kind: 'viewer-access',
  viewer,
  rating: maturityRating(level, [] as ContentDescriptor[]),
  clearance,
});

describe('the maturity gate rule', () => {
  it('is silent on subjects it does not own — text and conduct pass through it', () => {
    const text: PolicySubject = {
      kind: 'published-text',
      author: viewer,
      surface: must(publishedSurface('bio')),
      text: 'whatever',
    };
    const conduct: PolicySubject = {
      kind: 'actor-conduct',
      actor: viewer,
      action: must(conductAction('go-live')),
    };

    expect(rule.evaluate(text)).toEqual([]);
    expect(rule.evaluate(conduct)).toEqual([]);
  });

  it('does not gate a viewer cleared to the content level', () => {
    expect(rule.evaluate(access('mature', 'mature'))).toEqual([]);
  });

  it('does not gate a viewer cleared above the content level', () => {
    expect(rule.evaluate(access('teen', 'adult'))).toEqual([]);
  });

  it('gates a viewer short of the content level, requiring exactly that level', () => {
    expect(rule.evaluate(access('adult', 'teen'))).toEqual([
      { kind: 'gate', rule: GATE_ID, required: 'adult' },
    ]);
  });

  it('never gates general-audience content — everyone clears the baseline', () => {
    for (const clearance of MATURITY_LEVELS) {
      expect(rule.evaluate(access('general', clearance))).toEqual([]);
    }
  });

  it('agrees with the canonical order for every (rating, clearance) pair', () => {
    // The gate fires iff the viewer is NOT cleared to the content level — exactly
    // when clearance sits below the rating in MATURITY_LEVELS. One source of order.
    MATURITY_LEVELS.forEach((level, li) => {
      MATURITY_LEVELS.forEach((clearance, ci) => {
        const findings = rule.evaluate(access(level, clearance));
        if (ci >= li) {
          expect(findings).toEqual([]);
        } else {
          expect(findings).toEqual([{ kind: 'gate', rule: GATE_ID, required: level }]);
        }
      });
    });
  });
});
