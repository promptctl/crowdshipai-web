import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  netEffect,
  timestamp,
  transactionId,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type AccountKind,
  type CoinAmount,
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
const key = must(idempotencyKey('key'));

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

const tx = (from: string, to: string, amount: bigint): { transfers: readonly Transfer[]; reason: typeof reason; idempotencyKey: typeof key } => ({
  transfers: [must(transfer(acc(from), acc(to), coins(amount)))],
  reason,
  idempotencyKey: key,
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
    const result = await ledger.post({ transfers: [], reason, idempotencyKey: key });
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
        idempotencyKey: key,
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
