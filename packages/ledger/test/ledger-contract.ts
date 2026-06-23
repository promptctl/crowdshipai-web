import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type AccountKind,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Transfer,
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import { show } from '@crowdship/std';

import type { Ledger, PostError, PostReceipt } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${show(r.error)}`);
  return r.value;
};
const mustReceipt = (r: Result<PostReceipt, PostError>): PostReceipt => must(r);

const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const reason: TransactionReason = must(transactionReason('test-movement'));

/**
 * The behavioural contract of the {@link Ledger} seam, asserted against whatever
 * implementation `ledgerOf` returns. The in-memory fake runs it in the fast suite;
 * the real TigerBeetle engine runs the identical suite under integration, so the
 * two cannot diverge in observable behaviour [LAW:behavior-not-structure].
 *
 * One ledger instance is shared across every test, so each test namespaces its own
 * account ids and idempotency keys — no test can see another's movements, and the
 * suite needs no per-test reset of a persistent engine.
 */
export const ledgerContract = (ledgerOf: () => Ledger): void => {
  let nsCounter = 0;
  const ns = (): string => `c${(nsCounter += 1)}-`;

  // Per-test scoped constructors, prefixed so a shared, persistent engine keeps
  // every test's accounts and keys disjoint.
  const scope = () => {
    const p = ns();
    return {
      acc: (s: string): AccountId => must(accountId(p + s)),
      key: (s: string): IdempotencyKey => must(idempotencyKey(p + s)),
    };
  };
  const account = (id: AccountId, kind: AccountKind): Account => ({ id, kind });
  const leg = (from: AccountId, to: AccountId, amount: bigint): Transfer =>
    must(transfer(from, to, coins(amount)));
  const move = (
    transfers: readonly [Transfer, ...Transfer[]],
    idempotencyKey: IdempotencyKey,
  ): {
    transfers: readonly [Transfer, ...Transfer[]];
    reason: TransactionReason;
    idempotencyKey: IdempotencyKey;
  } => ({
    transfers,
    reason,
    idempotencyKey,
  });

  describe('the ledger seam contract', () => {
    test('a mint to a wallet is reflected in the receipt and in both balances', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const receipt = mustReceipt(await L.post(move([leg(mint, alice, 500n)], key('fund'))));
      expect(receipt.balances.get(alice)).toBe(500n);
      expect(receipt.balances.get(mint)).toBe(-500n);
      expect(receipt.occurredAt).toBeGreaterThan(0);
      expect(receipt.transactionId.length).toBeGreaterThan(0);

      expect(await L.balanceOf(alice)).toBe(500n);
      expect(await L.balanceOf(mint)).toBe(-500n);
    });

    test('posting to an account the ledger never opened is refused and records nothing', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const ghost = acc('ghost');
      must(await L.openAccount(account(mint, 'mint')));

      const result = await L.post(move([leg(mint, ghost, 10n)], key('to-ghost')));
      expect(result).toEqual({ ok: false, error: { kind: 'unknown-account', account: ghost } });
      expect(await L.balanceOf(mint)).toBe(0n);
      expect(await L.balanceOf(ghost)).toBe(0n);
    });

    test('a movement that would overdraft a wallet is refused and not recorded', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const bob = acc('bob');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(bob, 'user-wallet')));
      must(await L.post(move([leg(mint, alice, 30n)], key('fund'))));

      const result = await L.post(move([leg(alice, bob, 100n)], key('overspend')));
      expect(result).toEqual({ ok: false, error: { kind: 'would-overdraft', account: alice } });
      expect(await L.balanceOf(alice)).toBe(30n);
      expect(await L.balanceOf(bob)).toBe(0n);
    });

    test('re-opening an account with the same kind is a no-op; a different kind is refused', async () => {
      const L = ledgerOf();
      const { acc } = scope();
      const alice = acc('alice');
      expect((await L.openAccount(account(alice, 'user-wallet'))).ok).toBe(true);
      expect((await L.openAccount(account(alice, 'user-wallet'))).ok).toBe(true);

      const conflict = await L.openAccount(account(alice, 'escrow'));
      expect(conflict).toEqual({
        ok: false,
        error: { kind: 'kind-conflict', id: alice, existing: 'user-wallet', requested: 'escrow' },
      });
    });

    test('a retry of the same movement under one key returns the original receipt and records once', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const k = key('once');
      const first = mustReceipt(await L.post(move([leg(mint, alice, 500n)], k)));
      const retry = mustReceipt(await L.post(move([leg(mint, alice, 500n)], k)));

      expect(retry.transactionId).toBe(first.transactionId);
      expect(retry.occurredAt).toBe(first.occurredAt);
      expect(retry.balances.get(alice)).toBe(500n); // the replay reports balances too
      expect(retry.balances.get(mint)).toBe(-500n);
      expect(await L.balanceOf(alice)).toBe(500n); // funded once, not twice
    });

    test('many concurrent retries of one key let exactly one movement through', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const k = key('the-one');
      const attempts = Array.from({ length: 50 }, () => L.post(move([leg(mint, alice, 10n)], k)));
      const results = await Promise.all(attempts);

      for (const r of results) expect(r.ok).toBe(true);
      const ids = new Set(results.map((r) => (r.ok ? r.value.transactionId : 'err')));
      expect(ids.size).toBe(1);
      expect(await L.balanceOf(alice)).toBe(10n); // funded once, not 50×
    });

    test('reusing a key for a different movement is refused and records nothing', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const k = key('spent');
      must(await L.post(move([leg(mint, alice, 100n)], k)));
      const conflict = await L.post(move([leg(mint, alice, 999n)], k)); // same key, different amount

      expect(conflict).toEqual({ ok: false, error: { kind: 'idempotency-key-reused', key: k } });
      expect(await L.balanceOf(alice)).toBe(100n);
    });

    test('a failed post spends its key; a corrected retry needs a fresh key', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const sink = acc('sink');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(sink, 'platform-revenue')));

      // Alice holds nothing, so this post overdrafts and fails.
      const k = key('topup');
      const failed = await L.post(move([leg(alice, sink, 50n)], k));
      expect(failed).toEqual({ ok: false, error: { kind: 'would-overdraft', account: alice } });

      // Fund alice, then retry the SAME movement under the SAME key. The key was spent
      // on the failed attempt, so the retry is refused — never silently re-applied.
      must(await L.post(move([leg(mint, alice, 100n)], key('fund'))));
      const reuse = await L.post(move([leg(alice, sink, 50n)], k));
      expect(reuse).toEqual({ ok: false, error: { kind: 'idempotency-key-reused', key: k } });
      expect(await L.balanceOf(alice)).toBe(100n);
      expect(await L.balanceOf(sink)).toBe(0n);

      // The corrected movement succeeds under a FRESH key.
      const retried = mustReceipt(await L.post(move([leg(alice, sink, 50n)], key('topup-2'))));
      expect(retried.balances.get(alice)).toBe(50n);
      expect(await L.balanceOf(sink)).toBe(50n);
    });

    test('the same movement under two different keys posts twice', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const a = mustReceipt(await L.post(move([leg(mint, alice, 10n)], key('buy-1'))));
      const b = mustReceipt(await L.post(move([leg(mint, alice, 10n)], key('buy-2'))));
      expect(a.transactionId).not.toBe(b.transactionId);
      expect(await L.balanceOf(alice)).toBe(20n);
    });

    test('a backer pays a builder and the platform cut in one atomic movement', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const backer = acc('backer');
      const builder = acc('builder');
      const platform = acc('platform');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(backer, 'user-wallet')));
      must(await L.openAccount(account(builder, 'user-wallet')));
      must(await L.openAccount(account(platform, 'platform-revenue')));
      must(await L.post(move([leg(mint, backer, 100n)], key('fund'))));

      const receipt = mustReceipt(
        await L.post(
          move([leg(backer, builder, 95n), leg(backer, platform, 5n)], key('pay')),
        ),
      );
      expect(receipt.balances.get(backer)).toBe(0n);
      expect(receipt.balances.get(builder)).toBe(95n);
      expect(receipt.balances.get(platform)).toBe(5n);

      expect(await L.balanceOf(builder)).toBe(95n);
      expect(await L.balanceOf(platform)).toBe(5n);
      expect(await L.balanceOf(backer)).toBe(0n);
    });

    test('a multi-leg movement whose net would overdraft is rolled back whole', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const backer = acc('backer');
      const builder = acc('builder');
      const platform = acc('platform');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(backer, 'user-wallet')));
      must(await L.openAccount(account(builder, 'user-wallet')));
      must(await L.openAccount(account(platform, 'platform-revenue')));
      must(await L.post(move([leg(mint, backer, 50n)], key('fund')))); // only 50

      // 30 + 40 = 70 needed; the second leg overdrafts, so the whole movement fails.
      const result = await L.post(
        move([leg(backer, builder, 30n), leg(backer, platform, 40n)], key('too-much')),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('would-overdraft');
      expect(await L.balanceOf(backer)).toBe(50n);
      expect(await L.balanceOf(builder)).toBe(0n);
      expect(await L.balanceOf(platform)).toBe(0n);
    });

    test('the mint goes further negative with each issuance', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const bob = acc('bob');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(bob, 'user-wallet')));

      must(await L.post(move([leg(mint, alice, 100n)], key('a'))));
      must(await L.post(move([leg(mint, bob, 50n)], key('b'))));
      expect(await L.balanceOf(mint)).toBe(-150n);
    });

    test('concurrent withdrawals never overspend a funded wallet', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const sink = acc('sink');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(sink, 'platform-revenue')));
      must(await L.post(move([leg(mint, alice, 100n)], key('fund'))));

      // 150 distinct unit withdrawals against a balance of 100: exactly 100 may
      // succeed, and the wallet must never go negative.
      const attempts = Array.from({ length: 150 }, (_unused, i) =>
        L.post(move([leg(alice, sink, 1n)], key(`w-${i}`))),
      );
      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.ok).length;
      expect(succeeded).toBe(100);
      expect(await L.balanceOf(alice)).toBe(0n);
      expect(await L.balanceOf(sink)).toBe(100n);
    });
  });
};
