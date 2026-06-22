import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CLEAR,
  actorRef,
  contentDescriptor,
  createInMemoryAuditTrail,
  entryId,
  maturityRating,
  policyRuleId,
  publishedSurface,
  reportTarget,
  reviewQueue,
  type AuditTrail,
  type AuditTrailDeps,
  type EntryId,
  type ModerationEvent,
} from '@crowdship/moderation';
import { timestamp, type Result, type Timestamp } from '@crowdship/std';

import { createSqliteAuditTrail, openModerationDb } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW: Timestamp = must(timestamp(1_000_000));

/** Fresh injected capabilities with their OWN id counter, so two trails handed the
 *  same `deps()` independently assign `entry-1`, `entry-2`, … in lockstep — the only
 *  way the in-memory and durable RecordedEvents can be compared byte-for-byte. */
const deps = (): AuditTrailDeps => {
  let n = 0;
  return { clock: { now: () => NOW }, newEntryId: (): EntryId => must(entryId(`entry-${(n += 1)}`)) };
};

// One event of each arm, including the deepest `policy-decided` payloads — a
// viewer-access subject with a built rating, and a published-media subject carrying a
// hard-line verdict — so the JSON round-trip is exercised over the whole nested tree.
const REPORT: ModerationEvent = {
  kind: 'report-filed',
  report: { reporter: must(actorRef('acct-viewer')), target: must(reportTarget('witch')), reason: 'spam' },
};
const GATED_DECISION: ModerationEvent = {
  kind: 'policy-decided',
  subject: {
    kind: 'viewer-access',
    viewer: must(actorRef('acct-viewer')),
    rating: maturityRating('mature', [must(contentDescriptor('violence'))]),
    clearance: 'general',
  },
  decision: { outcome: 'gated', gates: [{ kind: 'gate', rule: must(policyRuleId('age-gate')), required: 'mature' }] },
};
const DENIED_DECISION: ModerationEvent = {
  kind: 'policy-decided',
  subject: { kind: 'published-media', author: must(actorRef('acct-author')), surface: must(publishedSurface('clip')), verdict: CLEAR },
  decision: {
    outcome: 'denied',
    violations: [{ kind: 'violation', rule: must(policyRuleId('hard-line')), reason: 'prohibited content' }],
  },
};

/** A SQLite trail over a fresh in-memory database — the fast, isolated durable store. */
const sqliteTrail = (d: AuditTrailDeps): AuditTrail => createSqliteAuditTrail(openModerationDb(':memory:'), d);

describe('createSqliteAuditTrail: durable parity with the in-memory reference', () => {
  test('every event arm round-trips back, in record order, identical to the in-memory trail', async () => {
    const memory = createInMemoryAuditTrail(deps());
    const sqlite = sqliteTrail(deps());
    const log: readonly ModerationEvent[] = [REPORT, GATED_DECISION, DENIED_DECISION];
    for (const event of log) {
      await memory.record(event);
      await sqlite.record(event);
    }
    // Same ids (lockstep counters), same timestamps (fixed clock), same nested bodies.
    expect((await sqlite.entries()).map((e) => e.event)).toEqual(log);
    expect(await sqlite.entries()).toEqual(await memory.entries());
  });

  test('record hands back the entry it assigned — the id the caller resolves against', async () => {
    const sqlite = sqliteTrail(deps());
    const recorded = await sqlite.record(REPORT);
    expect(recorded).toEqual({ id: 'entry-1', at: NOW, event: REPORT });
  });

  test('an empty trail reads back empty, never undefined', async () => {
    expect(await sqliteTrail(deps()).entries()).toEqual([]);
  });

  test('the review queue projects the durable entries exactly as it does the in-memory ones', async () => {
    const sqlite = sqliteTrail(deps());
    const report = await sqlite.record(REPORT);
    await sqlite.record(DENIED_DECISION);
    // A report and an incident are both open; resolving the report by its id clears it.
    expect(reviewQueue(await sqlite.entries())).toHaveLength(2);
    await sqlite.record({
      kind: 'action-taken',
      resolves: must(entryId(report.id)),
      resolution: { reviewer: must(actorRef('acct-staff')), disposition: 'upheld', note: 'confirmed' },
    });
    expect(reviewQueue(await sqlite.entries()).map((i) => i.kind)).toEqual(['incident']);
  });

  test('a duplicate entry id is refused by the durable store, never silently overwriting an entry', async () => {
    const fixed: AuditTrailDeps = { clock: { now: () => NOW }, newEntryId: () => must(entryId('entry-dup')) };
    const sqlite = sqliteTrail(fixed);
    await sqlite.record(REPORT);
    await expect((async () => sqlite.record(GATED_DECISION))()).rejects.toThrow();
  });
});

describe('createSqliteAuditTrail: moderation history survives a process restart', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('events recorded to a file read back after the database is closed and reopened', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crowdship-moderation-'));
    const file = join(dir, 'moderation.db');

    // File a report and decide an incident, then drop the whole connection — process gone.
    const opened = openModerationDb(file);
    const trail = createSqliteAuditTrail(opened, deps());
    await trail.record(REPORT);
    await trail.record(DENIED_DECISION);
    opened.close();

    // A fresh open of the same file — a new process — still holds the history, in order.
    const reopened = openModerationDb(file);
    const after = await createSqliteAuditTrail(reopened, deps()).entries();
    expect(after.map((e) => e.event)).toEqual([REPORT, DENIED_DECISION]);
    expect(reviewQueue(after)).toHaveLength(2);
    reopened.close();
  });
});

describe('createSqliteAuditTrail: a malformed durable row is surfaced loudly, never coerced', () => {
  // Hand-write a row the writer could never produce, then assert the read halts. The
  // read reconstructs the array synchronously, so the async wrapper turns its throw into
  // the rejection these assertions await.
  const corrupt = async (id: string, at: unknown, kind: string, payload: string): Promise<readonly unknown[]> => {
    const db = openModerationDb(':memory:');
    db.prepare('INSERT INTO moderation_events (id, at, kind, payload) VALUES (?, ?, ?, ?)').run(
      id,
      at as string,
      kind,
      payload,
    );
    return createSqliteAuditTrail(db, deps()).entries();
  };

  test('a payload whose kind disagrees with the discriminant column halts the read', async () => {
    await expect(
      corrupt('entry-1', 1, 'action-taken', JSON.stringify(REPORT)),
    ).rejects.toThrow(/does not match its action-taken discriminant/);
  });

  test('an unparseable payload halts the read rather than reading back a guessed event', async () => {
    await expect(corrupt('entry-1', 1, 'report-filed', 'not json')).rejects.toThrow();
  });

  test('a blank entry id column is corruption, not a real trail-issued id', async () => {
    await expect(corrupt('', 1, 'report-filed', JSON.stringify(REPORT))).rejects.toThrow(/moderation_events\.id/);
  });

  test('a non-integer timestamp column is corruption, halted at the read', async () => {
    await expect(corrupt('entry-1', 'soon', 'report-filed', JSON.stringify(REPORT))).rejects.toThrow(
      /at is not a safe integer/,
    );
  });
});
