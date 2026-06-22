import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  actorRef,
  createInMemoryAuditTrail,
  entryId,
  reportTarget,
  type ActorRef,
  type AuditTrail,
  type EntryId,
  type ModerationEvent,
  type RecordedEvent,
  type Report,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank test input is a broken test,
 *  never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));
const fixedClock = (ms: number): Clock => ({ now: () => at(ms) });

/** A deterministic id minter — a readable counting sequence, so a test asserts exact
 *  ids without a CSPRNG in core. Mirrors how `IngestBrokerDeps.newStreamId` is faked. */
const countingIds = (): (() => EntryId) => {
  let n = 0;
  return () => must(entryId(`entry-${(n += 1)}`));
};

const reporter: ActorRef = must(actorRef('viewer-1'));
const aReport: Report = {
  reporter,
  target: must(reportTarget('chat-message:99')),
  reason: 'spamming the chat',
};
const reportEvent: ModerationEvent = { kind: 'report-filed', report: aReport };

describe('the in-memory audit trail', () => {
  const make = (ms = 1_000): AuditTrail =>
    createInMemoryAuditTrail({ clock: fixedClock(ms), newEntryId: countingIds() });

  it('stamps a recorded event with the trail-assigned id and the clock instant', async () => {
    const trail = make(1_700_000_000_000);

    const recorded = await trail.record(reportEvent);

    expect(recorded).toEqual({
      id: must(entryId('entry-1')),
      at: at(1_700_000_000_000),
      event: reportEvent,
    });
  });

  it('keeps the whole history in record order — append only', async () => {
    const trail = make();
    const second: ModerationEvent = {
      kind: 'action-taken',
      resolves: must(entryId('entry-1')),
      resolution: { reviewer: must(actorRef('mod-1')), disposition: 'upheld', note: 'clear spam' },
    };

    const first = await trail.record(reportEvent);
    const next = await trail.record(second);

    expect(await trail.entries()).toEqual([first, next]);
  });

  it('issues a fresh id per record, never reusing one', async () => {
    const trail = make();

    const a = await trail.record(reportEvent);
    const b = await trail.record(reportEvent);

    expect(a.id).not.toBe(b.id);
  });

  it('hands back a snapshot — mutating the returned list cannot corrupt the trail', async () => {
    const trail = make();
    const recorded = await trail.record(reportEvent);

    const snapshot = await trail.entries();
    (snapshot as RecordedEvent[]).push(recorded);

    expect(await trail.entries()).toHaveLength(1);
  });

  it('refuses a minter that repeats an id — a collision fails loudly, never a silent merge', () => {
    const dup = must(entryId('entry-dup'));
    const trail = createInMemoryAuditTrail({ clock: fixedClock(1_000), newEntryId: () => dup });

    void trail.record(reportEvent);

    expect(() => trail.record(reportEvent)).toThrow(/duplicate entry id/);
  });
});
