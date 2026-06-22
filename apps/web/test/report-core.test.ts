import { accountId, roleSet, type Principal } from '@crowdship/identity';
import {
  createInMemoryAuditTrail,
  entryId,
  reviewQueue,
  type AuditTrail,
  type EntryId,
} from '@crowdship/moderation';
import { timestamp, type Result, type Timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { performFileReport, type ReportDeps } from '../src/server/report-core';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW: Timestamp = must(timestamp(1_000_000));
const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

// A trail with a deterministic, readable id sequence — the same injection the real
// composition root makes, with a counter standing in for the CSPRNG minter.
const trail = (): AuditTrail => {
  let n = 0;
  return createInMemoryAuditTrail({
    clock: { now: () => NOW },
    newEntryId: (): EntryId => must(entryId(`entry-${(n += 1)}`)),
  });
};

const deps = (subject: Principal | null, audit: AuditTrail): ReportDeps => ({ principal: subject, audit });

describe('performFileReport — an authenticated viewer flags a thing for review', () => {
  it('refuses an anonymous request and records nothing', async () => {
    const audit = trail();
    expect(await performFileReport(deps(null, audit), { target: 'witch', reason: 'spam' })).toEqual({
      kind: 'must-authenticate',
    });
    expect(await audit.entries()).toEqual([]);
  });

  it('records a report-filed event that the review queue then surfaces', async () => {
    const audit = trail();
    expect(
      await performFileReport(deps(principal('acct-viewer'), audit), { target: 'witch', reason: 'harassment' }),
    ).toEqual({ kind: 'filed' });

    const queue = reviewQueue(await audit.entries());
    expect(queue).toHaveLength(1);
    const [item] = queue;
    expect(item).toMatchObject({
      kind: 'report',
      report: { target: 'witch', reason: 'harassment', reporter: 'acct-viewer' },
    });
  });

  it('trims a pasted target and reason rather than recording surrounding whitespace', async () => {
    const audit = trail();
    expect(
      await performFileReport(deps(principal('acct-viewer'), audit), {
        target: '  witch  ',
        reason: '  spamming the chat  ',
      }),
    ).toEqual({ kind: 'filed' });
    const [item] = reviewQueue(await audit.entries());
    expect(item).toMatchObject({ kind: 'report', report: { target: 'witch', reason: 'spamming the chat' } });
  });

  it('rejects a blank target and a blank reason as distinct input faults, recording neither', async () => {
    const audit = trail();
    expect(
      (await performFileReport(deps(principal('acct-viewer'), audit), { target: '   ', reason: 'why' })).kind,
    ).toBe('invalid-target');
    expect(
      (await performFileReport(deps(principal('acct-viewer'), audit), { target: 'witch', reason: '   ' })).kind,
    ).toBe('invalid-reason');
    expect(await audit.entries()).toEqual([]);
  });
});
