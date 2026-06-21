import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  mayGoNegative,
  netEffect,
  timestamp,
  transaction,
  transactionId,
  transactionReason,
  transfer,
  type AccountId,
  type AccountKind,
  type CoinAmount,
  type Result,
  type Transaction,
  type Transfer,
} from '@crowdship/ledger-kernel';

import { decidePosting, type LedgerView } from '../src/index.js';

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
      id: must(transactionId('txn')),
      reason: must(transactionReason('test')),
      transfers,
      occurredAt: must(timestamp(0)),
      idempotencyKey: must(idempotencyKey('key')),
    }),
  );

const viewOf = (
  kinds: ReadonlyMap<AccountId, AccountKind>,
  balances: ReadonlyMap<AccountId, bigint>,
): LedgerView => ({
  kindOf: (id) => kinds.get(id),
  balanceOf: (id) => balances.get(id) ?? 0n,
});

describe('the gate refuses, as values, exactly the illegal posts', () => {
  test('an account the ledger has never opened is unknown — its negativity rule cannot be assumed', () => {
    const txn = txnOf([must(transfer(acc('mint'), acc('alice'), coins(50n)))]);
    const kinds = new Map<AccountId, AccountKind>([[acc('mint'), 'mint']]); // alice not opened
    const decision = decidePosting(viewOf(kinds, new Map()), txn);
    expect(decision).toEqual({ ok: false, error: { kind: 'unknown-account', account: acc('alice') } });
  });

  test('a user wallet cannot be driven negative', () => {
    const txn = txnOf([must(transfer(acc('alice'), acc('bob'), coins(10n)))]);
    const kinds = new Map<AccountId, AccountKind>([
      [acc('alice'), 'user-wallet'],
      [acc('bob'), 'user-wallet'],
    ]);
    const decision = decidePosting(viewOf(kinds, new Map([[acc('alice'), 3n]])), txn);
    expect(decision).toEqual({
      ok: false,
      error: { kind: 'would-overdraft', account: acc('alice'), accountKind: 'user-wallet', balance: 3n, delta: -10n, resulting: -7n },
    });
  });

  test('the mint is the one kind that may go negative — its negative balance is the coins in circulation', () => {
    const txn = txnOf([must(transfer(acc('mint'), acc('alice'), coins(500n)))]);
    const kinds = new Map<AccountId, AccountKind>([
      [acc('mint'), 'mint'],
      [acc('alice'), 'user-wallet'],
    ]);
    const decision = decidePosting(viewOf(kinds, new Map()), txn);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.changed.get(acc('mint'))).toBe(-500n);
      expect(decision.value.changed.get(acc('alice'))).toBe(500n);
    }
  });

  test('an account that dips and recovers within one atomic transaction is judged on its net effect only', () => {
    // alice (balance 0) receives 10 from mint and sends 10 to bob in the same txn: net zero, never refused.
    const txn = txnOf([
      must(transfer(acc('mint'), acc('alice'), coins(10n))),
      must(transfer(acc('alice'), acc('bob'), coins(10n))),
    ]);
    const kinds = new Map<AccountId, AccountKind>([
      [acc('mint'), 'mint'],
      [acc('alice'), 'user-wallet'],
      [acc('bob'), 'user-wallet'],
    ]);
    const decision = decidePosting(viewOf(kinds, new Map()), txn);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.changed.has(acc('alice'))).toBe(false); // net zero — unchanged
      expect(decision.value.changed.get(acc('bob'))).toBe(10n);
      expect(decision.value.changed.get(acc('mint'))).toBe(-10n);
    }
  });
});

describe('the gate is correct over arbitrary state (independent oracle)', () => {
  const pool = ['mint', 'alice', 'bob', 'carol', 'escrow', 'platform'] as const;
  const kindPool: readonly AccountKind[] = ['user-wallet', 'escrow', 'platform-revenue', 'mint'];

  const arbAccount = fc.constantFrom(...pool).map(acc);
  const arbTransfer = fc
    .record({ from: arbAccount, to: arbAccount, amount: fc.bigInt({ min: 1n, max: 10n ** 9n }).map(coins) })
    .filter((t) => t.from !== t.to)
    .map((t) => must(transfer(t.from, t.to, t.amount)));
  const arbTransaction = fc.array(arbTransfer, { minLength: 1, maxLength: 12 }).map(txnOf);

  // Each pool account independently may be unopened, and if opened gets a random kind and starting balance.
  const arbKinds = fc
    .array(fc.option(fc.constantFrom(...kindPool), { nil: undefined }), { minLength: pool.length, maxLength: pool.length })
    .map((kindsForPool) => {
      const m = new Map<AccountId, AccountKind>();
      pool.forEach((name, i) => {
        const k = kindsForPool[i];
        if (k !== undefined) m.set(acc(name), k);
      });
      return m;
    });
  const arbBalances = fc
    .array(fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }), { minLength: pool.length, maxLength: pool.length })
    .map((vals) => {
      const m = new Map<AccountId, bigint>();
      pool.forEach((name, i) => m.set(acc(name), vals[i] ?? 0n));
      return m;
    });

  test('approves iff every named account is known and no non-mint account ends below zero', () => {
    fc.assert(
      fc.property(arbTransaction, arbKinds, arbBalances, (txn, kinds, balances) => {
        const view = viewOf(kinds, balances);
        const net = netEffect(txn);

        // Oracle computed without reusing decidePosting's branching.
        const namedAccounts = new Set<AccountId>();
        for (const t of txn.transfers) {
          namedAccounts.add(t.from);
          namedAccounts.add(t.to);
        }
        const allKnown = [...namedAccounts].every((a) => kinds.get(a) !== undefined);
        const anyIllegal = [...net].some(([a, delta]) => {
          const k = kinds.get(a);
          if (k === undefined) return false; // unknown is reported separately
          return (balances.get(a) ?? 0n) + delta < 0n && !mayGoNegative(k);
        });
        const expectedOk = allKnown && !anyIllegal;

        const decision = decidePosting(view, txn);
        if (decision.ok !== expectedOk) return false;

        if (decision.ok) {
          // Every changed balance equals start + net delta, and only net-changed accounts appear.
          for (const [a, delta] of net) {
            if (decision.value.changed.get(a) !== (balances.get(a) ?? 0n) + delta) return false;
          }
          return decision.value.changed.size === net.size;
        }
        return true;
      }),
    );
  });
});
