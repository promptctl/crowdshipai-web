import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  entriesOf,
  idempotencyKey,
  netEffect,
  signedEffect,
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
} from '@crowdship/ledger-kernel';

import { resultingBalances } from '../src/index.js';

/** Unwrap a Result loudly — a money test must never proceed past a failed construction. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const xfer = (from: string, to: string, amount: bigint): Transfer =>
  must(transfer(acc(from), acc(to), coins(amount)));

/** A transaction with a caller-chosen id, so a log can be assembled and indexed. */
const txn = (id: string, transfers: readonly Transfer[]): Transaction =>
  must(
    transaction({
      id: must(transactionId(id)),
      reason: must(transactionReason('test')),
      transfers,
      occurredAt: must(timestamp(0)),
      idempotencyKey: must(idempotencyKey(id)),
    }),
  );

describe('resultingBalances derives a post receipt from the authoritative log, once', () => {
  test('the resulting balance of each changed account is the fold up to and including the transaction', () => {
    const t1 = txn('t1', [xfer('mint', 'alice', 100n)]);
    const t2 = txn('t2', [xfer('alice', 'bob', 30n)]);
    const log = [t1, t2];

    expect(resultingBalances(log, t1)).toEqual(
      new Map([
        [acc('mint'), -100n],
        [acc('alice'), 100n],
      ]),
    );
    expect(resultingBalances(log, t2)).toEqual(
      new Map([
        [acc('alice'), 70n],
        [acc('bob'), 30n],
      ]),
    );
  });

  test('accounts the transaction nets to zero are absent — only what it changed appears', () => {
    // alice receives 10 and forwards 10 within one transaction: her net is zero.
    const t = txn('t', [xfer('mint', 'alice', 10n), xfer('alice', 'bob', 10n)]);
    const balances = resultingBalances([t], t);
    expect(balances.has(acc('alice'))).toBe(false);
    expect(balances.get(acc('mint'))).toBe(-10n);
    expect(balances.get(acc('bob'))).toBe(10n);
  });

  test('the receipt is point-in-time: later activity never perturbs an earlier transaction’s balances', () => {
    const t1 = txn('t1', [xfer('mint', 'alice', 100n)]);
    const t2 = txn('t2', [xfer('mint', 'alice', 50n)]); // alice keeps moving after t1
    const justT1 = resultingBalances([t1], t1);
    const afterT2 = resultingBalances([t1, t2], t1); // same t1, longer log

    expect(afterT2).toEqual(justT1);
    expect(afterT2.get(acc('alice'))).toBe(100n); // not 150n — point-in-time, not current
  });

  test('a transaction absent from the log it claims to belong to halts loudly — never a silent wrong number', () => {
    const present = txn('present', [xfer('mint', 'alice', 1n)]);
    const stray = txn('stray', [xfer('mint', 'bob', 1n)]);
    expect(() => resultingBalances([present], stray)).toThrow(/corruption/);
  });
});

describe('resultingBalances agrees with an independent fold over arbitrary logs', () => {
  const pool = ['mint', 'alice', 'bob', 'carol'] as const;
  const arbAccount = fc.constantFrom(...pool).map(acc);
  const arbTransfer = fc
    .record({ from: arbAccount, to: arbAccount, amount: fc.bigInt({ min: 1n, max: 10n ** 6n }).map(coins) })
    .filter((t) => t.from !== t.to)
    .map((t) => must(transfer(t.from, t.to, t.amount)));
  const arbLog = fc
    .array(fc.array(arbTransfer, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 8 })
    .map((txnsTransfers) => txnsTransfers.map((transfers, i) => txn(`t${i}`, transfers)));

  /** Independent oracle: the balance of each account after the first `count`
   *  transactions, computed via the kernel's entry view (debit/credit), a
   *  different code path than netEffect. */
  const balancesAfter = (log: readonly Transaction[], count: number): Map<AccountId, bigint> => {
    const balances = new Map<AccountId, bigint>();
    for (const t of log.slice(0, count)) {
      for (const entry of entriesOf(t)) {
        balances.set(entry.account, (balances.get(entry.account) ?? 0n) + signedEffect(entry));
      }
    }
    return balances;
  };

  test('for every transaction in the log, its receipt equals the independent fold restricted to the accounts it changed', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        for (let i = 0; i < log.length; i++) {
          const target = log[i];
          if (target === undefined) return false;
          const derived = resultingBalances(log, target);
          const oracle = balancesAfter(log, i + 1);
          const changed = netEffect(target);

          // Same key set: exactly the accounts the target transaction changed.
          if (derived.size !== changed.size) return false;
          for (const account of changed.keys()) {
            if (derived.get(account) !== oracle.get(account)) return false;
          }
        }
        return true;
      }),
    );
  });
});
