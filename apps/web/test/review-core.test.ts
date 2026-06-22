import { accountId, roleSet, staffRoster, type Principal, type StaffRoster } from '@crowdship/identity';
import {
  actorRef,
  createInMemoryAuditTrail,
  entryId,
  policyRuleId,
  publishedSurface,
  reportTarget,
  reviewQueue,
  type AuditTrail,
  type EntryId,
  type PolicySubject,
  type PolicyViolation,
  type QueueItem,
} from '@crowdship/moderation';
import { timestamp, type Result, type Timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { performResolveItem, toQueueView, type ResolveDeps } from '../src/server/review-core';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW: Timestamp = must(timestamp(1_000_000));
const STAFF = 'acct-staff';
const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

const trail = (): AuditTrail => {
  let n = 0;
  return createInMemoryAuditTrail({
    clock: { now: () => NOW },
    newEntryId: (): EntryId => must(entryId(`entry-${(n += 1)}`)),
  });
};

const deps = (subject: Principal | null, staff: readonly string[], audit: AuditTrail): ResolveDeps => {
  const roster: StaffRoster = staffRoster(staff.map((id) => must(accountId(id))));
  return { principal: subject, roster, audit };
};

describe('toQueueView — flattening a queue item to the serializable console shape', () => {
  it('opens a report arm to plain target, reason, and reporter strings', () => {
    const item: QueueItem = {
      kind: 'report',
      id: must(entryId('entry-1')),
      report: { reporter: must(actorRef('acct-viewer')), target: must(reportTarget('witch')), reason: 'spam' },
    };
    expect(toQueueView(item)).toEqual({
      kind: 'report',
      id: 'entry-1',
      target: 'witch',
      reason: 'spam',
      reporter: 'acct-viewer',
    });
  });

  it('opens an incident arm to its subject kind and the violation reasons', () => {
    const subject: PolicySubject = {
      kind: 'published-text',
      author: must(actorRef('acct-author')),
      surface: must(publishedSurface('display-name')),
      text: 'a banned slur',
    };
    const violations: readonly [PolicyViolation, ...PolicyViolation[]] = [
      { kind: 'violation', rule: must(policyRuleId('hard-line')), reason: 'prohibited content' },
    ];
    const item: QueueItem = { kind: 'incident', id: must(entryId('entry-2')), subject, violations };
    expect(toQueueView(item)).toEqual({
      kind: 'incident',
      id: 'entry-2',
      subject: 'published-text',
      violations: ['prohibited content'],
    });
  });
});

describe('performResolveItem — staff record a verdict that clears an item', () => {
  // Seed the trail with one open report and return its entry id.
  const withOpenReport = async (audit: AuditTrail): Promise<string> => {
    const recorded = await audit.record({
      kind: 'report-filed',
      report: { reporter: must(actorRef('acct-viewer')), target: must(reportTarget('witch')), reason: 'spam' },
    });
    return recorded.id;
  };

  it('refuses an anonymous request and records no verdict', async () => {
    const audit = trail();
    const entry = await withOpenReport(audit);
    expect(
      await performResolveItem(deps(null, [], audit), { entry, disposition: 'upheld', note: 'clear abuse' }),
    ).toEqual({ kind: 'must-authenticate' });
    expect(reviewQueue(await audit.entries())).toHaveLength(1);
  });

  it('refuses a signed-in non-staff principal and records no verdict', async () => {
    const audit = trail();
    const entry = await withOpenReport(audit);
    expect(
      await performResolveItem(deps(principal('acct-rando'), [], audit), {
        entry,
        disposition: 'upheld',
        note: 'clear abuse',
      }),
    ).toEqual({ kind: 'forbidden' });
    expect(reviewQueue(await audit.entries())).toHaveLength(1);
  });

  it('records an upheld verdict for staff and the item leaves the queue', async () => {
    const audit = trail();
    const entry = await withOpenReport(audit);
    expect(
      await performResolveItem(deps(principal(STAFF), [STAFF], audit), {
        entry,
        disposition: 'upheld',
        note: 'confirmed harassment',
      }),
    ).toEqual({ kind: 'resolved', disposition: 'upheld' });
    expect(reviewQueue(await audit.entries())).toEqual([]);
  });

  it('records a dismissed verdict too — both verdicts clear the item, the disposition is the value', async () => {
    const audit = trail();
    const entry = await withOpenReport(audit);
    expect(
      (
        await performResolveItem(deps(principal(STAFF), [STAFF], audit), {
          entry,
          disposition: 'dismissed',
          note: 'no rule broken',
        })
      ).kind,
    ).toBe('resolved');
    expect(reviewQueue(await audit.entries())).toEqual([]);
  });

  it('rejects a blank item, an unknown verdict, and a blank note as distinct faults', async () => {
    const audit = trail();
    const entry = await withOpenReport(audit);
    const base = { entry, disposition: 'upheld', note: 'why' };
    expect((await performResolveItem(deps(principal(STAFF), [STAFF], audit), { ...base, entry: '   ' })).kind).toBe(
      'invalid-item',
    );
    expect(
      (await performResolveItem(deps(principal(STAFF), [STAFF], audit), { ...base, disposition: 'maybe' })).kind,
    ).toBe('invalid-disposition');
    expect((await performResolveItem(deps(principal(STAFF), [STAFF], audit), { ...base, note: '   ' })).kind).toBe(
      'invalid-note',
    );
    // None of the rejected attempts recorded anything — the item is still open.
    expect(reviewQueue(await audit.entries())).toHaveLength(1);
  });
});
