import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  netEffect,
  timestamp,
  transaction,
  transactionId,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type AccountKind,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Transaction,
  type Transfer,
} from '@crowdship/ledger-kernel';

import { createLedger, InMemoryLedgerStore, Ledger } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const account = (id: string, kind: AccountKind): Account => ({ id: acc(id), kind });
const reason = must(transactionReason('test'));
const key = (s: string): IdempotencyKey => must(idempotencyKey(s));

// Each post is a distinct operation unless a test deliberately reuses a key, so
// the default key is unique per call — sharing one would make every post a replay
// of the first under the new idempotent boundary.
let keyCounter = 0;
const freshKey = (): IdempotencyKey => key(`k-${(keyCounter += 1)}`);

/** A ledger with deterministic capabilities: a counter id source and a counter
 *  clock, so every test is reproducible and the boundary's supplied id/timestamp
 *  are observable. */
const deterministicLedger = (): { ledger: Ledger; store: InMemoryLedgerStore } => {
  const store = new InMemoryLedgerStore();
  let n = 0;
  const ledger = new Ledger(
    store,
    () => must(timestamp(1000 + n)),
    () => must(transactionId(`txn-${(n += 1)}`)),
  );
  return { ledger, store };
};

const tx = (
  from: string,
  to: string,
  amount: bigint,
  idempotencyKey: IdempotencyKey = freshKey(),
): { transfers: readonly Transfer[]; reason: typeof reason; idempotencyKey: IdempotencyKey } => ({
  transfers: [must(transfer(acc(from), acc(to), coins(amount)))],
  reason,
  idempotencyKey,
});

const sumOf = (m: ReadonlyMap<AccountId, bigint>): bigint =>
  [...m.values()].reduce((a, b) => a + b, 0n);

describe('the single write path records balanced movements', () => {
  test('a coin purchase mints to a wallet and is reflected in balances, history, and the receipt', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const receipt = must(await ledger.post(tx('mint', 'alice', 500n)));
    expect(receipt.balances.get(acc('alice'))).toBe(500n);
    expect(receipt.balances.get(acc('mint'))).toBe(-500n);

    const balances = await ledger.balances();
    expect(balances.get(acc('alice'))).toBe(500n);
    expect(balances.get(acc('mint'))).toBe(-500n);
    expect(sumOf(balances)).toBe(0n);

    const history = await ledger.history();
    expect(history).toHaveLength(1);
  });

  test('the boundary supplies occurredAt and generates a distinct id per post — the kernel never does', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const first = must(await ledger.post(tx('mint', 'alice', 1n)));
    const second = must(await ledger.post(tx('mint', 'alice', 1n)));
    expect(first.transaction.occurredAt).toBe(1001);
    expect(first.transaction.id).not.toBe(second.transaction.id);
  });

  test('the receipt balances are the same numbers the derived balance view reports', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    await ledger.openAccount(account('platform', 'platform-revenue'));

    const receipt = must(await ledger.post(tx('mint', 'alice', 100n)));
    const balances = await ledger.balances();
    for (const [a, b] of receipt.balances) expect(balances.get(a)).toBe(b);
  });
});

describe('the boundary refuses illegal posts as values and never appends them', () => {
  test('posting to an account the ledger never opened is rejected, and history stays empty', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));

    const result = await ledger.post(tx('mint', 'alice', 10n));
    expect(result).toEqual({ ok: false, error: { kind: 'unknown-account', account: acc('alice') } });
    expect(await ledger.history()).toHaveLength(0);
  });

  test('a post that would overdraft a user wallet is rejected and not recorded', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    await ledger.openAccount(account('bob', 'user-wallet'));

    must(await ledger.post(tx('mint', 'alice', 30n)));
    const result = await ledger.post(tx('alice', 'bob', 100n));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('would-overdraft');
    expect(await ledger.history()).toHaveLength(1); // only the funding post
    expect((await ledger.balances()).get(acc('alice'))).toBe(30n);
  });

  test('an empty transaction is rejected by the constructor before anything is recorded', async () => {
    const { ledger } = deterministicLedger();
    const result = await ledger.post({ transfers: [], reason, idempotencyKey: freshKey() });
    expect(result).toEqual({ ok: false, error: { kind: 'no-transfers' } });
    expect(await ledger.history()).toHaveLength(0);
  });
});

describe('the account registry', () => {
  test('re-opening an account with the same kind is a no-op success; a different kind is refused', async () => {
    const { ledger } = deterministicLedger();
    expect((await ledger.openAccount(account('alice', 'user-wallet'))).ok).toBe(true);
    expect((await ledger.openAccount(account('alice', 'user-wallet'))).ok).toBe(true);

    const conflict = await ledger.openAccount(account('alice', 'escrow'));
    expect(conflict).toEqual({
      ok: false,
      error: { kind: 'kind-conflict', id: acc('alice'), existing: 'user-wallet', requested: 'escrow' },
    });
  });
});

describe('the log is append-only and the authoritative source of every balance', () => {
  const pool = ['mint', 'alice', 'bob', 'platform'] as const;

  test('balances always equal the fold of the recorded history, after any sequence of posts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            from: fc.constantFrom(...pool),
            to: fc.constantFrom(...pool),
            amount: fc.bigInt({ min: 1n, max: 1000n }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        async (moves) => {
          const { ledger } = deterministicLedger();
          await ledger.openAccount(account('mint', 'mint'));
          await ledger.openAccount(account('alice', 'user-wallet'));
          await ledger.openAccount(account('bob', 'user-wallet'));
          await ledger.openAccount(account('platform', 'platform-revenue'));

          for (const m of moves) {
            if (m.from === m.to) continue; // a transfer needs distinct accounts
            await ledger.post(tx(m.from, m.to, m.amount)); // ignore overdraft rejections
          }

          // Independent oracle: fold the authoritative history ourselves.
          const history = await ledger.history();
          const expected = new Map<AccountId, bigint>();
          for (const t of history) {
            for (const [a, delta] of netEffect(t)) {
              expected.set(a, (expected.get(a) ?? 0n) + delta);
            }
          }
          for (const [a, v] of [...expected]) if (v === 0n) expected.delete(a);

          const balances = await ledger.balances();
          if (balances.size !== expected.size) return false;
          if (sumOf(balances) !== 0n) return false; // the central theorem still holds across the whole log
          return [...expected].every(([a, v]) => balances.get(a) === v);
        },
      ),
    );
  });
});

describe('posts are serialized — concurrency cannot tear a write or double-spend', () => {
  test('against a funded wallet, exactly as many unit withdrawals succeed as there are coins, and it never goes negative', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    await ledger.openAccount(account('sink', 'platform-revenue'));

    must(await ledger.post(tx('mint', 'alice', 100n)));

    // Fire 150 concurrent unit withdrawals at a wallet holding 100. If the
    // read-decide-append sequence could interleave, more than 100 would observe a
    // positive balance and overspend. Serialization must let exactly 100 through.
    const attempts = Array.from({ length: 150 }, () => ledger.post(tx('alice', 'sink', 1n)));
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.ok).length;
    expect(succeeded).toBe(100);

    const balances = await ledger.balances();
    expect(balances.get(acc('alice'))).toBeUndefined(); // exactly zero — omitted from non-zero map
    expect(balances.get(acc('sink'))).toBe(100n);
    expect(balances.get(acc('mint'))).toBe(-100n);
    expect(sumOf(balances)).toBe(0n);

    // The funding post plus exactly 100 successful withdrawals are recorded — nothing torn.
    expect((await ledger.history()).length).toBe(1 + 100);
  });
});

describe('the headline settlement shapes post atomically and conserve', () => {
  test('a backer pays a builder and the platform cut in one balanced transaction', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('backer', 'user-wallet'));
    await ledger.openAccount(account('builder', 'user-wallet'));
    await ledger.openAccount(account('platform', 'platform-revenue'));

    must(await ledger.post(tx('mint', 'backer', 100n)));
    const receipt = must(
      await ledger.post({
        transfers: [
          must(transfer(acc('backer'), acc('builder'), coins(95n))),
          must(transfer(acc('backer'), acc('platform'), coins(5n))),
        ],
        reason,
        idempotencyKey: freshKey(),
      }),
    );

    expect(receipt.balances.get(acc('backer'))).toBe(0n); // -100 net within this txn
    expect(receipt.balances.get(acc('builder'))).toBe(95n);
    expect(receipt.balances.get(acc('platform'))).toBe(5n);

    const balances = await ledger.balances();
    expect(balances.get(acc('builder'))).toBe(95n);
    expect(balances.get(acc('platform'))).toBe(5n);
    expect(balances.get(acc('backer'))).toBeUndefined(); // exactly zero
    expect(balances.get(acc('mint'))).toBe(-100n);
    expect(sumOf(balances)).toBe(0n);
    expect(await ledger.history()).toHaveLength(2);
  });

  test('the mint may go further negative with each issuance — its balance is the coins in circulation', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    await ledger.openAccount(account('bob', 'user-wallet'));

    must(await ledger.post(tx('mint', 'alice', 100n)));
    must(await ledger.post(tx('mint', 'bob', 50n)));

    const balances = await ledger.balances();
    expect(balances.get(acc('mint'))).toBe(-150n);
    expect(sumOf(balances)).toBe(0n);
  });
});

describe('integrity is defended loudly, not silently', () => {
  test('a duplicate transaction id is corruption: the post rejects rather than double-posting', async () => {
    const store = new InMemoryLedgerStore();
    // A broken id source that mints the same id twice — stands in for any id
    // collision or corruption of the authoritative record.
    const ledger = new Ledger(
      store,
      () => must(timestamp(1)),
      () => must(transactionId('collision')),
    );
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    must(await ledger.post(tx('mint', 'alice', 1n)));
    await expect(ledger.post(tx('mint', 'alice', 1n))).rejects.toThrow(/corruption/);

    // The corrupt second movement was never recorded.
    expect(await ledger.history()).toHaveLength(1);
    expect((await ledger.balances()).get(acc('alice'))).toBe(1n);
  });
});

describe('openAccount and post share the one write queue', () => {
  test('a post enqueued before an account is opened sees the pre-open state and is refused', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));

    // Enqueue the post FIRST, then the open, without awaiting between them. The
    // single-writer queue must run them in enqueue order: the post observes alice
    // as not-yet-opened. If openAccount could interleave, the post might wrongly
    // see a half-opened account.
    const posted = ledger.post(tx('mint', 'alice', 10n));
    const opened = ledger.openAccount(account('alice', 'user-wallet'));
    const [postResult, openResult] = await Promise.all([posted, opened]);

    expect(postResult).toEqual({ ok: false, error: { kind: 'unknown-account', account: acc('alice') } });
    expect(openResult.ok).toBe(true);
    expect(await ledger.history()).toHaveLength(0);
  });
});

describe('createLedger wires production capabilities', () => {
  test('the default ledger generates real unique ids and a present timestamp', async () => {
    const ledger = createLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const a = must(await ledger.post(tx('mint', 'alice', 1n)));
    const b = must(await ledger.post(tx('mint', 'alice', 1n)));
    expect(a.transaction.id).not.toBe(b.transaction.id);
    expect(a.transaction.occurredAt).toBeGreaterThan(0);
  });
});

describe('the boundary is idempotent on the request key — a retry can never double-spend', () => {
  test('re-posting the same operation under the same key returns the original receipt and records nothing new', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const k = key('mint-alice-once');
    const first = must(await ledger.post(tx('mint', 'alice', 500n, k)));
    const retry = must(await ledger.post(tx('mint', 'alice', 500n, k)));

    // The retry is the original, byte-for-byte: same id, same point-in-time balances.
    expect(retry.transaction.id).toBe(first.transaction.id);
    expect(retry.transaction.occurredAt).toBe(first.transaction.occurredAt);
    expect(retry.balances.get(acc('alice'))).toBe(500n);
    expect(retry.balances.get(acc('mint'))).toBe(-500n);

    // Exactly one movement recorded, and alice was funded once, not twice.
    expect(await ledger.history()).toHaveLength(1);
    expect((await ledger.balances()).get(acc('alice'))).toBe(500n);
  });

  test('many concurrent retries of one key let exactly one movement through; all share the same receipt', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const k = key('the-one-purchase');
    // Fire 100 identical posts at once. If the dedup check could interleave with
    // the append, more than one would miss the prior and record a duplicate —
    // double-spend. The serialized critical section must let exactly one append.
    const attempts = Array.from({ length: 100 }, () => ledger.post(tx('mint', 'alice', 10n, k)));
    const results = await Promise.all(attempts);

    for (const r of results) expect(r.ok).toBe(true);
    const ids = new Set(results.map((r) => (r.ok ? r.value.transaction.id : 'err')));
    expect(ids.size).toBe(1); // every caller saw the same single transaction

    expect(await ledger.history()).toHaveLength(1);
    expect((await ledger.balances()).get(acc('alice'))).toBe(10n); // funded once, not 100×
    expect((await ledger.balances()).get(acc('mint'))).toBe(-10n);
  });

  test('a replay is referentially transparent: its balances stay point-in-time even after later activity', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const k = key('first-mint');
    must(await ledger.post(tx('mint', 'alice', 100n, k))); // alice: 100
    must(await ledger.post(tx('mint', 'alice', 50n))); // distinct op, alice now 150

    const replay = must(await ledger.post(tx('mint', 'alice', 100n, k)));
    // The receipt reflects the balances as of the original post (100), not now (150).
    expect(replay.balances.get(acc('alice'))).toBe(100n);
    expect(replay.balances.get(acc('mint'))).toBe(-100n);
    expect((await ledger.balances()).get(acc('alice'))).toBe(150n); // current is unchanged by the replay
    expect(await ledger.history()).toHaveLength(2); // the replay added nothing
  });

  test('reusing a key for a different operation is refused loudly as a value, and records nothing', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const k = key('spent-key');
    const first = must(await ledger.post(tx('mint', 'alice', 100n, k)));
    const conflict = await ledger.post(tx('mint', 'alice', 999n, k)); // same key, different amount

    expect(conflict).toEqual({
      ok: false,
      error: {
        kind: 'idempotency-key-reused',
        key: k,
        recordedTransactionId: first.transaction.id,
      },
    });
    // The conflicting movement was never recorded; alice keeps her original 100.
    expect(await ledger.history()).toHaveLength(1);
    expect((await ledger.balances()).get(acc('alice'))).toBe(100n);
  });

  test('the same operation under two different keys posts twice — dedup is by key, not by content', async () => {
    const { ledger } = deterministicLedger();
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const a = must(await ledger.post(tx('mint', 'alice', 10n, key('buy-1'))));
    const b = must(await ledger.post(tx('mint', 'alice', 10n, key('buy-2'))));

    expect(a.transaction.id).not.toBe(b.transaction.id);
    expect(await ledger.history()).toHaveLength(2);
    expect((await ledger.balances()).get(acc('alice'))).toBe(20n);
  });

  test('posting one key any number of times records it exactly once and returns one stable receipt', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (retries) => {
        const { ledger } = deterministicLedger();
        await ledger.openAccount(account('mint', 'mint'));
        await ledger.openAccount(account('alice', 'user-wallet'));

        const k = key('property-key');
        const receipts = [];
        for (let i = 0; i < retries; i += 1) {
          receipts.push(must(await ledger.post(tx('mint', 'alice', 7n, k))));
        }

        const oneId = receipts[0]?.transaction.id;
        const allSame = receipts.every((r) => r.transaction.id === oneId);
        const history = await ledger.history();
        const aliceBalance = (await ledger.balances()).get(acc('alice'));
        return allSame && history.length === 1 && aliceBalance === 7n;
      }),
    );
  });
});

describe('the store guards the at-most-one-transaction-per-key invariant of the log', () => {
  test('appending a second transaction under a key already in the log is corruption and halts loudly', async () => {
    const store = new InMemoryLedgerStore();
    const sharedKey = key('shared');
    const build = (id: string): Transaction => {
      const t = transaction({
        id: must(transactionId(id)),
        reason,
        transfers: [must(transfer(acc('mint'), acc('alice'), coins(1n)))],
        occurredAt: must(timestamp(1)),
        idempotencyKey: sharedKey,
      });
      return must(t);
    };

    await store.append(build('txn-a'));
    // A different transaction id but the same key — only reachable if the boundary
    // dedup were bypassed; the store refuses it rather than holding two postings
    // under one key. The guard halts before mutating (it throws as the boundary's
    // `await this.store.append(...)` would surface a rejection), so the log is left
    // with just the first transaction.
    expect(() => store.append(build('txn-b'))).toThrow(/corruption.*idempotency key/);
    expect(await store.history()).toHaveLength(1);
  });
});
