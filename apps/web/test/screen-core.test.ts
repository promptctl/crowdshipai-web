import {
  actorRef,
  conductAction,
  createInMemoryAuditTrail,
  entryId,
  isIncident,
  IN_GOOD_STANDING,
  policyRuleId,
  publishedSurface,
  reviewQueue,
  CLEAR,
  maturityRating,
  type AuditTrail,
  type AuditTrailDeps,
  type EntryId,
  type PolicyBoundary,
  type PolicyDecision,
  type PolicySubject,
} from '@crowdship/moderation';
import { timestamp, type Result, type Timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { performScreen, type ScreenDeps } from '../src/server/screen-core';
import { getPolicyBoundary } from '../src/server/policy';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW: Timestamp = must(timestamp(1_000_000));

/** A fresh in-memory trail with deterministic ids, so a recorded incident reads back
 *  with a known id the assertions can name. */
const trail = (): AuditTrail => {
  let n = 0;
  const deps: AuditTrailDeps = {
    clock: { now: () => NOW },
    newEntryId: (): EntryId => must(entryId(`entry-${(n += 1)}`)),
  };
  return createInMemoryAuditTrail(deps);
};

/** A boundary that returns one fixed decision for any subject — lets a test drive
 *  `performScreen` over each `outcome` arm without depending on which rule fired. */
const fixedBoundary = (decision: PolicyDecision): PolicyBoundary => ({ decide: () => decision });

const CONDUCT_SUBJECT: PolicySubject = {
  kind: 'actor-conduct',
  actor: must(actorRef('acct-builder')),
  action: must(conductAction('go-live')),
  standing: IN_GOOD_STANDING,
};

const DENIED: PolicyDecision = {
  outcome: 'denied',
  violations: [{ kind: 'violation', rule: must(policyRuleId('conduct')), reason: 'banned: repeated abuse' }],
};
const GATED: PolicyDecision = {
  outcome: 'gated',
  gates: [{ kind: 'gate', rule: must(policyRuleId('maturity-gate')), required: 'mature' }],
};
const ALLOWED: PolicyDecision = { outcome: 'allowed' };

describe('performScreen: the recording edge from a decision to the review queue', () => {
  it('records a denied decision as a policy-decided incident the review queue surfaces', async () => {
    const audit = trail();
    const decision = await performScreen({ boundary: fixedBoundary(DENIED), audit }, CONDUCT_SUBJECT);

    expect(decision).toEqual(DENIED);
    const entries = await audit.entries();
    expect(entries).toEqual([{ id: 'entry-1', at: NOW, event: { kind: 'policy-decided', subject: CONDUCT_SUBJECT, decision: DENIED } }]);

    // The recorded incident projects into the queue carrying the subject and the
    // violations — exactly what a reviewer needs, with no extra plumbing.
    const queue = reviewQueue(entries);
    expect(queue).toEqual([
      { kind: 'incident', id: 'entry-1', subject: CONDUCT_SUBJECT, violations: DENIED.violations },
    ]);
  });

  it('records NOTHING for an allowed decision — a pass is not a trail entry', async () => {
    const audit = trail();
    const decision = await performScreen({ boundary: fixedBoundary(ALLOWED), audit }, CONDUCT_SUBJECT);

    expect(decision).toEqual(ALLOWED);
    expect(await audit.entries()).toEqual([]);
    expect(reviewQueue(await audit.entries())).toEqual([]);
  });

  it('records NOTHING for a gated decision — allowed-with-standing is not an incident', async () => {
    // The access arm's outcome: a gated viewer is ordinary access control, never a
    // moderation incident (incidentViolations returns null for gated). Even screened,
    // it leaves the trail empty, so it could never reach a reviewer as a denial.
    const audit = trail();
    const decision = await performScreen({ boundary: fixedBoundary(GATED), audit }, CONDUCT_SUBJECT);

    expect(decision).toEqual(GATED);
    expect(isIncident(decision)).toBe(false);
    expect(await audit.entries()).toEqual([]);
  });

  it('returns the boundary verdict unchanged, leaving the surface to enforce it', async () => {
    const audit = trail();
    // The seam records; it does not refuse. The caller still gets the deny to act on.
    expect(await performScreen({ boundary: fixedBoundary(DENIED), audit }, CONDUCT_SUBJECT)).toEqual(DENIED);
  });
});

describe('performScreen over the REAL policy boundary: automated denials reach the queue', () => {
  const boundary = getPolicyBoundary();

  it('a barred builder going live is denied and surfaces as an incident with the bar reason', async () => {
    const audit = trail();
    const subject: PolicySubject = {
      kind: 'actor-conduct',
      actor: must(actorRef('acct-builder')),
      action: must(conductAction('go-live')),
      standing: { kind: 'barred', reason: 'suspended: harassment' },
    };

    const decision = await performScreen({ boundary, audit }, subject);
    expect(decision.outcome).toBe('denied');

    const queue = reviewQueue(await audit.entries());
    expect(queue).toHaveLength(1);
    expect(queue[0]?.kind).toBe('incident');
    if (queue[0]?.kind === 'incident') {
      expect(queue[0].violations.map((v) => v.reason)).toContain('suspended: harassment');
    }
  });

  it('published media a classifier found prohibited is denied and surfaces with the verdict reason', async () => {
    const audit = trail();
    const subject: PolicySubject = {
      kind: 'published-media',
      author: must(actorRef('acct-builder')),
      surface: must(publishedSurface('stream-frame')),
      verdict: { kind: 'prohibited', reason: 'nudity involving a person' },
    };

    const decision = await performScreen({ boundary, audit }, subject);
    expect(decision.outcome).toBe('denied');

    const queue = reviewQueue(await audit.entries());
    expect(queue).toHaveLength(1);
    if (queue[0]?.kind === 'incident') {
      expect(queue[0].violations.map((v) => v.reason)).toContain('nudity involving a person');
    }
  });

  it('a builder in good standing and clear media record nothing — the queue stays empty', async () => {
    const audit = trail();
    await performScreen({ boundary, audit }, {
      kind: 'actor-conduct',
      actor: must(actorRef('acct-builder')),
      action: must(conductAction('go-live')),
      standing: IN_GOOD_STANDING,
    });
    await performScreen({ boundary, audit }, {
      kind: 'published-media',
      author: must(actorRef('acct-builder')),
      surface: must(publishedSurface('stream-frame')),
      verdict: CLEAR,
    });
    expect(reviewQueue(await audit.entries())).toEqual([]);
  });

  it('a gated viewer-access decision records nothing through the real boundary', async () => {
    // Even routed through the recording seam, the access arm never enqueues — proof the
    // ticket's "access.ts must not record" holds structurally, not by omission.
    const audit = trail();
    const decision = await performScreen({ boundary, audit }, {
      kind: 'viewer-access',
      viewer: must(actorRef('anonymous-viewer')),
      rating: maturityRating('mature', []),
      clearance: 'general',
    });
    expect(decision.outcome).toBe('gated');
    expect(await audit.entries()).toEqual([]);
  });
});
