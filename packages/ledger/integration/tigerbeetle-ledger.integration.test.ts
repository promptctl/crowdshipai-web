import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  transfer,
  type AccountId,
  type IdempotencyKey,
  type Result,
  type Transfer,
} from '@crowdship/ledger-kernel';

import {
  createInMemoryNameStore,
  createSqliteNameStore,
  createTigerBeetleLedger,
  type Ledger,
  type LedgerQuery,
} from '../src/index.js';
import { ledgerContract } from '../test/ledger-contract.js';
import { ledgerQueryContract } from '../test/ledger-query-contract.js';
import { startTigerBeetle, type RunningTigerBeetle } from './tigerbeetle-harness.js';

// The real engine, proven against the identical contract the in-memory fake passes
// in the fast suite. This is where "the money rules are TigerBeetle's" is verified
// against TigerBeetle itself — no-overdraft, idempotent replay, conflict refusal,
// atomic multi-leg movements — so the fake can never silently drift from production
// [LAW:behavior-not-structure]. A live cluster is booted once for the file.
let running: RunningTigerBeetle;
let ledger: Ledger & LedgerQuery;

beforeAll(async () => {
  running = await startTigerBeetle();
  ledger = createTigerBeetleLedger(running.config);
});

afterAll(async () => {
  await ledger.close();
  await running.stop();
});

ledgerContract(() => ledger);

// The same audit/query contract the in-memory fake passes, now proven against the
// real engine: point-in-time balances and full per-account history read from
// TigerBeetle's own native history (the `history` account flag), with the verbatim
// account ids and reasons recovered from the control-plane store. One ledger instance
// records and reads through one name store, the single-process case [LAW:behavior-not-structure].
ledgerQueryContract(() => ledger);

// Two ledgers over two clients against ONE cluster stand in for two app processes:
// their in-process serializers share nothing, so this is the cross-process idempotency
// the single-process contract suite cannot reach. The engine — not our serializer — is
// the real arbiter: a cross-process replay must return the original receipt and a
// cross-process reuse must be refused as a value, never thrown as "corruption"
// [LAW:single-enforcer].
describe('two processes share one engine', () => {
  const must = <T>(r: Result<T, unknown>): T => {
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    return r.value;
  };
  const acc = (s: string): AccountId => must(accountId(s));
  const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
  const reason = must(transactionReason('cross-process'));
  const leg = (from: string, to: string, amount: bigint): Transfer =>
    must(transfer(acc(from), acc(to), must(coinAmount(amount))));
  const move = (transfers: readonly [Transfer, ...Transfer[]], k: IdempotencyKey) => ({
    transfers,
    reason,
    idempotencyKey: k,
  });

  let p1: Ledger;
  let p2: Ledger;
  beforeAll(async () => {
    p1 = createTigerBeetleLedger(running.config);
    p2 = createTigerBeetleLedger(running.config);
    must(await p1.openAccount({ id: acc('xp-mint'), kind: 'mint' }));
    must(await p1.openAccount({ id: acc('xp-alice'), kind: 'user-wallet' }));
    must(await p1.openAccount({ id: acc('xp-bob'), kind: 'user-wallet' }));
  });
  afterAll(async () => {
    await p1.close();
    await p2.close();
  });

  test('concurrent identical posts from two processes apply once and share one receipt', async () => {
    const k = key('xp-same');
    const [a, b] = await Promise.all([
      p1.post(move([leg('xp-mint', 'xp-alice', 70n)], k)),
      p2.post(move([leg('xp-mint', 'xp-alice', 70n)], k)),
    ]);
    // Both succeed (one fresh, one a replay the engine forced the loser to recognise),
    // neither throws, and they agree on the transaction id.
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.transactionId).toBe(b.value.transactionId);
    expect(await p1.balanceOf(acc('xp-alice'))).toBe(70n); // applied exactly once
  });

  test('concurrent different posts under one key: exactly one applies, the other is a conflict', async () => {
    const k = key('xp-diff');
    const [a, b] = await Promise.all([
      p1.post(move([leg('xp-mint', 'xp-bob', 10n)], k)),
      p2.post(move([leg('xp-mint', 'xp-bob', 20n)], k)),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.error.kind === 'idempotency-key-reused');
    expect(oks).toHaveLength(1); // exactly one movement won the key
    expect(conflicts).toHaveLength(1); // the loser is refused as a value, not thrown
    // Bob holds exactly what the winner posted (10 or 20), never both.
    const bob = await p1.balanceOf(acc('xp-bob'));
    expect(bob === 10n || bob === 20n).toBe(true);
  });
});

// The reason this ticket exists, proven end to end against the real engine: a name one
// process records must be resolvable by another process's audit. Two ledgers stand in
// for two app processes; the *money* is always shared (one cluster), but the *names*
// are only shared when the NameStore is durable and shared. With a per-process in-memory
// store the auditing process hits a loud name gap; with one shared SQLite file it reads
// the full, named history [LAW:behavior-not-structure].
describe('a durable shared NameStore lets one process audit what another recorded', () => {
  const must = <T>(r: Result<T, unknown>): T => {
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    return r.value;
  };
  const acc = (s: string): AccountId => must(accountId(s));
  const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
  const reason = must(transactionReason('cross-process-audit'));
  const leg = (from: string, to: string, amount: bigint): Transfer =>
    must(transfer(acc(from), acc(to), must(coinAmount(amount))));

  const workdir = mkdtempSync(join(tmpdir(), 'crowdship-ledger-names-'));
  // Two separate handles on one file: the recorder writes names, the auditor reads
  // them — each owns its own handle and closes it, the discipline the store's close()
  // doc demands (the injected ledger never closes them).
  const sharedNames = createSqliteNameStore(join(workdir, 'names.db'));
  const auditorNames = createSqliteNameStore(join(workdir, 'names.db'));

  // The recorder ("process 1") opens accounts and posts a movement, writing every name
  // into the shared file. The auditor ("process 2") shares the same file but is a
  // different ledger/client, exactly as a second process would be.
  let recorder: Ledger & LedgerQuery;
  let auditor: Ledger & LedgerQuery;
  beforeAll(async () => {
    recorder = createTigerBeetleLedger(running.config, sharedNames);
    auditor = createTigerBeetleLedger(running.config, auditorNames);
    must(await recorder.openAccount({ id: acc('audit-mint'), kind: 'mint' }));
    must(await recorder.openAccount({ id: acc('audit-alice'), kind: 'user-wallet' }));
    must(await recorder.post({ transfers: [leg('audit-mint', 'audit-alice', 90n)], reason, idempotencyKey: key('audit-1') }));
  });
  afterAll(async () => {
    await recorder.close();
    await auditor.close();
    sharedNames.close();
    auditorNames.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  test("the auditor reads the recorder's movement, fully named, from the shared file", async () => {
    const history = await auditor.historyOf(acc('audit-alice'));
    expect(history).toHaveLength(1);
    const [movement] = history;
    expect(movement?.direction).toBe('credit');
    expect(movement?.amount).toBe(90n);
    expect(movement?.counterparty).toBe('audit-mint'); // resolved from a name the recorder wrote
    expect(movement?.reason).toBe('cross-process-audit'); // recovered verbatim across the seam
    expect(movement?.resultingBalance).toBe(90n);
  });

  test('without a shared store the same audit hits a loud name gap — the bug this fixes', async () => {
    // A fresh, empty in-memory store is the per-process default that cannot see names
    // another process recorded. The money is intact in the engine, so this is a *name*
    // gap surfaced loudly, never silent wrong data [LAW:no-silent-failure].
    const isolated = createTigerBeetleLedger(running.config, createInMemoryNameStore());
    try {
      await expect(isolated.historyOf(acc('audit-alice'))).rejects.toThrow(/name/i);
    } finally {
      await isolated.close();
    }
  });
});
