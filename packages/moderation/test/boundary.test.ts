import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  conductAction,
  createPolicyBoundary,
  policyRuleId,
  publishedSurface,
  type ActorRef,
  type PolicyRule,
  type PolicyRuleId,
  type PolicySubject,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const rid = (raw: string): PolicyRuleId => must(policyRuleId(raw));
const actor = (raw: string): ActorRef => must(actorRef(raw));

const textSubject = (text: string): PolicySubject => ({
  kind: 'published-text',
  author: actor('builder-1'),
  surface: must(publishedSurface('bio')),
  text,
});

const conductSubject = (action: string): PolicySubject => ({
  kind: 'actor-conduct',
  actor: actor('builder-1'),
  action: must(conductAction(action)),
});

/** A sample rule: objects to a banned word in published text, ignores conduct.
 *  Lives only in the test — it proves the seam without the package shipping a rule
 *  that belongs to a sibling ticket (o97.6 owns the real hard line). */
const bansWord = (word: string): PolicyRule => ({
  id: rid('test-word-ban'),
  evaluate: (subject) =>
    subject.kind === 'published-text' && subject.text.includes(word)
      ? [{ rule: rid('test-word-ban'), reason: `text contains "${word}"` }]
      : [],
});

/** A sample rule on the conduct axis: refuses one named action. */
const refusesAction = (action: string): PolicyRule => ({
  id: rid('test-action-refuse'),
  evaluate: (subject) =>
    subject.kind === 'actor-conduct' && subject.action === action
      ? [{ rule: rid('test-action-refuse'), reason: `action "${action}" is refused` }]
      : [],
});

describe('the single policy boundary', () => {
  it('allows everything when no rules are configured — loudly empty, not a fake gate', () => {
    const boundary = createPolicyBoundary([]);

    expect(boundary.decide(textSubject('anything at all'))).toEqual({ allowed: true });
    expect(boundary.decide(conductSubject('go-live'))).toEqual({ allowed: true });
  });

  it('allows a subject no rule objects to', () => {
    const boundary = createPolicyBoundary([bansWord('forbidden')]);

    expect(boundary.decide(textSubject('a perfectly fine bio'))).toEqual({ allowed: true });
  });

  it('denies with a violation attributed to the rule that raised it', () => {
    const boundary = createPolicyBoundary([bansWord('forbidden')]);

    const decision = boundary.decide(textSubject('this is forbidden text'));

    expect(decision).toEqual({
      allowed: false,
      violations: [{ rule: rid('test-word-ban'), reason: 'text contains "forbidden"' }],
    });
  });

  it('reports every violation at once rather than one at a time', () => {
    const boundary = createPolicyBoundary([bansWord('alpha'), bansWord('beta')]);

    const decision = boundary.decide(textSubject('alpha and beta both here'));

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(decision.violations).toHaveLength(2);
    expect(decision.violations.map((v) => v.reason)).toEqual([
      'text contains "alpha"',
      'text contains "beta"',
    ]);
  });

  it('denies when any single rule objects among rules that pass — most-restrictive-wins', () => {
    const boundary = createPolicyBoundary([bansWord('never-present'), bansWord('forbidden')]);

    const decision = boundary.decide(textSubject('forbidden'));

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(decision.violations).toHaveLength(1);
    expect(decision.violations[0].rule).toBe(rid('test-word-ban'));
  });

  it('lets a rule ignore the subject kinds it does not judge', () => {
    // The text rule contributes nothing to a conduct subject, and vice versa.
    const boundary = createPolicyBoundary([bansWord('forbidden'), refusesAction('go-live')]);

    expect(boundary.decide(textSubject('forbidden'))).toEqual({
      allowed: false,
      violations: [{ rule: rid('test-word-ban'), reason: 'text contains "forbidden"' }],
    });
    expect(boundary.decide(conductSubject('go-live'))).toEqual({
      allowed: false,
      violations: [{ rule: rid('test-action-refuse'), reason: 'action "go-live" is refused' }],
    });
    // A conduct action no rule refuses passes; the text rule never fires on it.
    expect(boundary.decide(conductSubject('post-message'))).toEqual({ allowed: true });
  });

  it('is order-independent in its verdict — the rule set is a set, not a sequence', () => {
    const a = createPolicyBoundary([bansWord('alpha'), bansWord('beta')]);
    const b = createPolicyBoundary([bansWord('beta'), bansWord('alpha')]);

    const subject = textSubject('alpha beta');
    const da = a.decide(subject);
    const db = b.decide(subject);

    expect(da.allowed).toBe(false);
    expect(db.allowed).toBe(false);
    if (da.allowed || db.allowed) throw new Error('unreachable');
    // Same verdict and same set of reasons, regardless of rule order.
    expect(new Set(da.violations.map((v) => v.reason))).toEqual(new Set(db.violations.map((v) => v.reason)));
  });

  it('refuses to mint a blank rule id, actor, or label', () => {
    expect(policyRuleId('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'policyRuleId' } });
    expect(actorRef('')).toEqual({ ok: false, error: { kind: 'blank', label: 'actorRef' } });
    expect(conductAction('')).toEqual({ ok: false, error: { kind: 'blank', label: 'conductAction' } });
    expect(publishedSurface('')).toEqual({ ok: false, error: { kind: 'blank', label: 'publishedSurface' } });
  });
});
