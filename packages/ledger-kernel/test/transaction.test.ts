import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  entriesOf,
  idempotencyKey,
  netEffect,
  timestamp,
  transaction,
  transactionId,
  transactionReason,
  transfer,
  type AccountId,
  type CoinAmount,
  type Result,
  type Transaction,
  type Transfer,
} from '../src/index.js';

/** Test-only: unwrap a Result loudly. A money test must never silently proceed past a failed construction. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const coins = (n: bigint): CoinAmount => must(coinAmount(n));

const txnOf = (transfers: readonly Transfer[]): Transaction =>
  must(
    transaction({
      id: must(transactionId('txn-1')),
      reason: must(transactionReason('test')),
      transfers,
      occurredAt: must(timestamp(0)),
      idempotencyKey: must(idempotencyKey('key-1')),
    }),
  );

const sumOf = (net: ReadonlyMap<AccountId, bigint>): bigint =>
  [...net.values()].reduce((a, b) => a + b, 0n);

describe('constructors reject illegal inputs as values, not exceptions', () => {
  test('a zero or negative coin amount is not-positive', () => {
    expect(coinAmount(0n)).toEqual({ ok: false, error: { kind: 'not-positive', value: 0n } });
    expect(coinAmount(-5n)).toEqual({ ok: false, error: { kind: 'not-positive', value: -5n } });
  });

  test('a transfer to the same account is rejected', () => {
    const a = acc('a');
    expect(transfer(a, a, coins(10n))).toEqual({
      ok: false,
      error: { kind: 'same-account', account: a },
    });
  });

  test('a transaction with no transfers is rejected', () => {
    const built = transaction({
      id: must(transactionId('t')),
      reason: must(transactionReason('r')),
      transfers: [],
      occurredAt: must(timestamp(0)),
      idempotencyKey: must(idempotencyKey('k')),
    });
    expect(built).toEqual({ ok: false, error: { kind: 'no-transfers' } });
  });

  test('blank ids — empty or whitespace-only — are rejected with their label', () => {
    expect(accountId('')).toEqual({ ok: false, error: { kind: 'blank', label: 'accountId' } });
    expect(accountId('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'accountId' } });
    expect(accountId('\n\t')).toEqual({ ok: false, error: { kind: 'blank', label: 'accountId' } });
  });

  test('a raw object cannot pose as a Transfer — the brand is unforgeable', () => {
    const a = acc('a');
    const b = acc('b');
    // @ts-expect-error Transfer is nominal; only transfer() can produce one, so the
    // same-account invariant is carried by the type, not just checked in a function.
    const forged: Transfer = { from: a, to: b, amount: coins(1n) };
    void forged;
  });
});

describe('the transaction algebra', () => {
  test('a coin purchase: mint -> wallet nets to zero, wallet gains, mint mirrors it', () => {
    const txn = txnOf([must(transfer(acc('mint'), acc('alice'), coins(500n)))]);
    const net = netEffect(txn);
    expect(net.get(acc('alice'))).toBe(500n);
    expect(net.get(acc('mint'))).toBe(-500n);
    expect(sumOf(net)).toBe(0n);
  });

  test('a split: backer pays builder and the platform cut in one balanced transaction', () => {
    const txn = txnOf([
      must(transfer(acc('backer'), acc('builder'), coins(95n))),
      must(transfer(acc('backer'), acc('platform'), coins(5n))),
    ]);
    const net = netEffect(txn);
    expect(net.get(acc('backer'))).toBe(-100n);
    expect(net.get(acc('builder'))).toBe(95n);
    expect(net.get(acc('platform'))).toBe(5n);
    expect(sumOf(net)).toBe(0n);
  });

  test('every transfer projects to exactly one debit and one credit', () => {
    const txn = txnOf([
      must(transfer(acc('a'), acc('b'), coins(1n))),
      must(transfer(acc('b'), acc('c'), coins(2n))),
    ]);
    const entries = entriesOf(txn);
    expect(entries).toHaveLength(4);
    expect(entries.filter((e) => e.direction === 'debit')).toHaveLength(2);
    expect(entries.filter((e) => e.direction === 'credit')).toHaveLength(2);
  });

  test('a pass-through intermediary nets zero and is omitted from the deltas', () => {
    const txn = txnOf([
      must(transfer(acc('a'), acc('b'), coins(7n))),
      must(transfer(acc('b'), acc('c'), coins(7n))),
    ]);
    const net = netEffect(txn);
    expect(net.get(acc('a'))).toBe(-7n);
    expect(net.get(acc('c'))).toBe(7n);
    expect(net.has(acc('b'))).toBe(false); // touched but net zero — not a balance change
  });
});

describe('the central theorem', () => {
  const pool = ['mint', 'alice', 'bob', 'carol', 'escrow', 'platform'] as const;
  const arbAccount = fc.constantFrom(...pool).map(acc);
  const arbTransfer = fc
    .record({ from: arbAccount, to: arbAccount, amount: fc.bigInt({ min: 1n, max: 10n ** 12n }).map(coins) })
    .filter((t) => t.from !== t.to)
    .map((t) => must(transfer(t.from, t.to, t.amount)));
  const arbTransaction = fc.array(arbTransfer, { minLength: 1, maxLength: 25 }).map(txnOf);

  test('netEffect of any transaction sums to exactly zero', () => {
    fc.assert(fc.property(arbTransaction, (txn) => sumOf(netEffect(txn)) === 0n));
  });

  test('netEffect matches deltas derived directly from transfers (independent oracle, not via entriesOf)', () => {
    fc.assert(
      fc.property(arbTransaction, (txn) => {
        // Oracle: compute expected balance deltas straight from the transfers,
        // never touching entriesOf/signedEffect. A debit/credit swap or a dropped
        // leg in the projection would diverge from this and fail the test
        // [LAW:behavior-not-structure].
        const expected = new Map<AccountId, bigint>();
        for (const t of txn.transfers) {
          expected.set(t.to, (expected.get(t.to) ?? 0n) + t.amount);
          expected.set(t.from, (expected.get(t.from) ?? 0n) - t.amount);
        }
        for (const [id, v] of [...expected]) {
          if (v === 0n) expected.delete(id);
        }
        const net = netEffect(txn);
        if (net.size !== expected.size) return false;
        return [...expected].every(([id, v]) => net.get(id) === v);
      }),
    );
  });
});
