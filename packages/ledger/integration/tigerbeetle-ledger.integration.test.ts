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

import { createTigerBeetleLedger, type Ledger, type LedgerQuery } from '../src/index.js';
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
