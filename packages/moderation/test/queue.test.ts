import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  createInMemoryAuditTrail,
  entryId,
  incidentViolations,
  isIncident,
  policyRuleId,
  publishedSurface,
  reportTarget,
  reviewQueue,
  type ActorRef,
  type AuditTrail,
  type EntryId,
  type PolicyDecision,
  type PolicySubject,
  type Report,
  type Resolution,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));
const fixedClock = (ms: number): Clock => ({ now: () => at(ms) });
const countingIds = (): (() => EntryId) => {
  let n = 0;
  return () => must(entryId(`entry-${(n += 1)}`));
};
const makeTrail = (): AuditTrail =>
  createInMemoryAuditTrail({ clock: fixedClock(1_000), newEntryId: countingIds() });

const builder: ActorRef = must(actorRef('builder-1'));
const viewer: ActorRef = must(actorRef('viewer-1'));

const aReport: Report = { reporter: viewer, target: must(reportTarget('stream:7')), reason: 'harassment' };

const textSubject: PolicySubject = {
  kind: 'published-text',
  author: builder,
  surface: must(publishedSurface('bio')),
  text: 'a bio',
};

const denied = (reason: string): Extract<PolicyDecision, { outcome: 'denied' }> => ({
  outcome: 'denied',
  violations: [{ kind: 'violation', rule: must(policyRuleId('hard-line')), reason }],
});
const allowed: PolicyDecision = { outcome: 'allowed' };
const gated: PolicyDecision = {
  outcome: 'gated',
  gates: [{ kind: 'gate', rule: must(policyRuleId('maturity-gate')), required: 'mature' }],
};

const resolve = (note: string): Resolution => ({ reviewer: must(actorRef('mod-1')), disposition: 'upheld', note });

describe('incident classification', () => {
  it('treats a denial as an incident and surfaces its violations', () => {
    const violation = { kind: 'violation', rule: must(policyRuleId('hard-line')), reason: 'banned' } as const;
    const decision: PolicyDecision = { outcome: 'denied', violations: [violation] };
    expect(incidentViolations(decision)).toEqual([violation]);
    expect(isIncident(decision)).toBe(true);
  });

  it('treats a gate as access control, not an incident', () => {
    expect(incidentViolations(gated)).toBeNull();
    expect(isIncident(gated)).toBe(false);
  });

  it('treats an allow as no incident', () => {
    expect(incidentViolations(allowed)).toBeNull();
    expect(isIncident(allowed)).toBe(false);
  });
});

describe('the review queue projected from the trail', () => {
  it('is empty when nothing has been recorded', async () => {
    const trail = makeTrail();
    expect(reviewQueue(await trail.entries())).toEqual([]);
  });

  it('surfaces a filed report as a report item', async () => {
    const trail = makeTrail();
    const recorded = await trail.record({ kind: 'report-filed', report: aReport });

    expect(reviewQueue(await trail.entries())).toEqual([
      { kind: 'report', id: recorded.id, report: aReport },
    ]);
  });

  it('surfaces a recorded denial as an incident carrying its subject and violations', async () => {
    const trail = makeTrail();
    const decision = denied('contains banned content');
    const recorded = await trail.record({ kind: 'policy-decided', subject: textSubject, decision });

    expect(reviewQueue(await trail.entries())).toEqual([
      { kind: 'incident', id: recorded.id, subject: textSubject, violations: decision.violations },
    ]);
  });

  it('never queues an allowed or gated decision — only denials are incidents', async () => {
    const trail = makeTrail();
    await trail.record({ kind: 'policy-decided', subject: textSubject, decision: allowed });
    await trail.record({ kind: 'policy-decided', subject: textSubject, decision: gated });

    expect(reviewQueue(await trail.entries())).toEqual([]);
  });

  it('drops a report once an action resolves its id', async () => {
    const trail = makeTrail();
    const report = await trail.record({ kind: 'report-filed', report: aReport });
    await trail.record({ kind: 'action-taken', resolves: report.id, resolution: resolve('handled') });

    expect(reviewQueue(await trail.entries())).toEqual([]);
  });

  it('drops an incident once an action resolves its id', async () => {
    const trail = makeTrail();
    const incident = await trail.record({
      kind: 'policy-decided',
      subject: textSubject,
      decision: denied('bad'),
    });
    await trail.record({ kind: 'action-taken', resolves: incident.id, resolution: resolve('removed') });

    expect(reviewQueue(await trail.entries())).toEqual([]);
  });

  it('leaves the human and automated paths that remain open, dropping only the resolved one', async () => {
    const trail = makeTrail();
    const report = await trail.record({ kind: 'report-filed', report: aReport });
    const incident = await trail.record({
      kind: 'policy-decided',
      subject: textSubject,
      decision: denied('bad'),
    });
    // Resolve only the report; the incident stays open.
    await trail.record({ kind: 'action-taken', resolves: report.id, resolution: resolve('dismissed-as-noise') });

    const queue = reviewQueue(await trail.entries());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'incident', id: incident.id });
  });

  it('resolves order-free — an action recorded before the item it closes still removes it', async () => {
    const trail = makeTrail();
    // The action lands first (entry-1) naming entry-2, the id the report takes next:
    // the verdict must not depend on which was recorded first.
    await trail.record({
      kind: 'action-taken',
      resolves: must(entryId('entry-2')),
      resolution: resolve('pre-closed'),
    });
    await trail.record({ kind: 'report-filed', report: aReport });

    expect(reviewQueue(await trail.entries())).toEqual([]);
  });

  it('tolerates an action resolving a non-existent id — a no-op that leaves the open item', async () => {
    const trail = makeTrail();
    const report = await trail.record({ kind: 'report-filed', report: aReport });
    await trail.record({
      kind: 'action-taken',
      resolves: must(entryId('entry-999')),
      resolution: resolve('typo'),
    });

    expect(reviewQueue(await trail.entries())).toEqual([{ kind: 'report', id: report.id, report: aReport }]);
  });

  it('tolerates two actions resolving the same id — idempotent, no double effect and no throw', async () => {
    const trail = makeTrail();
    const report = await trail.record({ kind: 'report-filed', report: aReport });
    await trail.record({ kind: 'action-taken', resolves: report.id, resolution: resolve('first') });
    await trail.record({ kind: 'action-taken', resolves: report.id, resolution: resolve('again') });

    expect(reviewQueue(await trail.entries())).toEqual([]);
  });
});
