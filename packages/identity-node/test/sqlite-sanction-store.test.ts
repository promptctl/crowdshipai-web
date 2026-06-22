import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  InMemorySanctionStore,
  accountId,
  effectiveSanction,
  type AccountId,
  type Sanction,
  type SanctionStore,
} from '@crowdship/identity';
import { SqliteSanctionStore, openIdentityDb } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));
const TARGET: AccountId = must(accountId('acct-target'));
const OTHER: AccountId = must(accountId('acct-other'));

const permanent = (reason: string, issuedAt: number): Sanction => ({
  reason,
  issuedAt: at(issuedAt),
  scope: { kind: 'permanent' },
});

const until = (reason: string, issuedAt: number, untilMs: number): Sanction => ({
  reason,
  issuedAt: at(issuedAt),
  scope: { kind: 'until', until: at(untilMs) },
});

/** A SQLite store over a fresh in-memory database — the fast, isolated durable store. */
const sqliteStore = (): SqliteSanctionStore => new SqliteSanctionStore(openIdentityDb(':memory:'));

describe('SqliteSanctionStore: durable parity with the in-memory reference', () => {
  test('records of both scope kinds round-trip back, in record order, byte-for-byte', async () => {
    const memory: SanctionStore = new InMemorySanctionStore();
    const sqlite: SanctionStore = sqliteStore();
    const log: readonly Sanction[] = [
      until('cooling off', 10, 1010),
      permanent('repeated abuse', 20),
      until('second strike', 30, 5030),
    ];
    for (const sanction of log) {
      await memory.record(TARGET, sanction);
      await sqlite.record(TARGET, sanction);
    }
    // The durable store agrees with the reference exactly — same values, same order.
    expect(await sqlite.forAccount(TARGET)).toEqual(log);
    expect(await sqlite.forAccount(TARGET)).toEqual(await memory.forAccount(TARGET));
  });

  test('forAccount is keyed strictly by account — one account never reads another\'s bars', async () => {
    const sqlite = sqliteStore();
    await sqlite.record(TARGET, permanent('theirs', 1));
    await sqlite.record(OTHER, permanent('not theirs', 2));
    expect(await sqlite.forAccount(TARGET)).toEqual([permanent('theirs', 1)]);
    expect(await sqlite.forAccount(OTHER)).toEqual([permanent('not theirs', 2)]);
  });

  test('an account with no sanctions reads back empty, never undefined', async () => {
    expect(await sqliteStore().forAccount(TARGET)).toEqual([]);
  });

  test('effectiveSanction over the SQLite-read list governs the same as over the in-memory one', async () => {
    const memory: SanctionStore = new InMemorySanctionStore();
    const sqlite: SanctionStore = sqliteStore();
    const log: readonly Sanction[] = [
      until('short', 1, 100),
      until('long', 2, 9000),
      until('shortest', 3, 50),
    ];
    for (const sanction of log) {
      await memory.record(TARGET, sanction);
      await sqlite.record(TARGET, sanction);
    }
    const now = at(10);
    // Most-restrictive-active is the longest-reaching timed bar; the derivation is
    // identical whichever store fed it the list.
    const governing = effectiveSanction(await sqlite.forAccount(TARGET), now);
    expect(governing).toEqual(until('long', 2, 9000));
    expect(governing).toEqual(effectiveSanction(await memory.forAccount(TARGET), now));
  });

  test('a permanent bar always governs a timed one, read back from the durable store', async () => {
    const sqlite = sqliteStore();
    await sqlite.record(TARGET, until('suspension', 1, 5000));
    await sqlite.record(TARGET, permanent('ban', 2));
    const governing = effectiveSanction(await sqlite.forAccount(TARGET), at(10));
    expect(governing?.scope.kind).toBe('permanent');
    expect(governing?.reason).toBe('ban');
  });
});

describe('SqliteSanctionStore: sanctions survive a process restart', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('a sanction recorded to a file reads back after the database is closed and reopened', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crowdship-sanction-'));
    const file = join(dir, 'identity.db');

    // Issue a ban, then drop the entire connection — the moderator's process is gone.
    const opened = openIdentityDb(file);
    await new SqliteSanctionStore(opened).record(TARGET, until('temp ban', 100, 9999));
    await new SqliteSanctionStore(opened).record(TARGET, permanent('permanent ban', 200));
    opened.close();

    // A fresh open of the same file — a new process — still holds the bars, in order.
    const reopened = openIdentityDb(file);
    const after = await new SqliteSanctionStore(reopened).forAccount(TARGET);
    expect(after).toEqual([until('temp ban', 100, 9999), permanent('permanent ban', 200)]);
    expect(effectiveSanction(after, at(300))?.scope.kind).toBe('permanent');
    reopened.close();
  });
});

describe('SqliteSanctionStore: a malformed durable row is surfaced loudly, never coerced', () => {
  test('an unknown scope_kind halts the read rather than guessing a scope', async () => {
    const db = openIdentityDb(':memory:');
    // Hand-write a row the writer could never produce — a third scope kind.
    db.prepare(
      'INSERT INTO sanctions (account_id, reason, issued_at, scope_kind, until) VALUES (?, ?, ?, ?, ?)',
    ).run(TARGET, 'corrupt', 1, 'shadowban', null);
    await expect((async () => new SqliteSanctionStore(db).forAccount(TARGET))()).rejects.toThrow(
      /scope_kind is not a known scope/,
    );
  });

  test('a timed scope whose until column is null is corruption, not a permanent bar', async () => {
    const db = openIdentityDb(':memory:');
    db.prepare(
      'INSERT INTO sanctions (account_id, reason, issued_at, scope_kind, until) VALUES (?, ?, ?, ?, ?)',
    ).run(TARGET, 'corrupt', 1, 'until', null);
    await expect((async () => new SqliteSanctionStore(db).forAccount(TARGET))()).rejects.toThrow(
      /column until is not a safe integer/,
    );
  });

  test('a permanent scope carrying a stray until is corruption, not a clean permanent bar', async () => {
    const db = openIdentityDb(':memory:');
    db.prepare(
      'INSERT INTO sanctions (account_id, reason, issued_at, scope_kind, until) VALUES (?, ?, ?, ?, ?)',
    ).run(TARGET, 'corrupt', 1, 'permanent', 9999);
    await expect((async () => new SqliteSanctionStore(db).forAccount(TARGET))()).rejects.toThrow(
      /until set on a permanent scope/,
    );
  });
});
