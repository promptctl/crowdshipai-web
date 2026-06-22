import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  timestamp,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type AccountKind,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Timestamp,
  type Transfer,
  type TransactionReason,
} from '@crowdship/ledger-kernel';

import type { Ledger, LedgerQuery, PostError, PostReceipt } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};
const mustReceipt = (r: Result<PostReceipt, PostError>): PostReceipt => must(r);

const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const reason: TransactionReason = must(transactionReason('audit-movement'));
const at = (ms: number): Timestamp => must(timestamp(ms));

/**
 * The behavioural contract of the {@link LedgerQuery} audit/read seam, asserted
 * against whatever backend `ledgerOf` returns. The in-memory fake runs it in the
 * fast suite (folding its own movements); the real TigerBeetle engine runs the
 * identical suite under integration (reading its native history). The two derive
 * every answer from their own single source of truth, so this proves they cannot
 * disagree on what an account's past was [LAW:behavior-not-structure].
 *
 * Point-in-time assertions read the moment back from each post's receipt rather
 * than assuming a wall-clock value, so the contract holds whatever clock the
 * backend stamped a movement with — the fast fake's injected clock or the engine's
 * own [LAW:no-ambient-temporal-coupling].
 */
export const ledgerQueryContract = (ledgerOf: () => Ledger & LedgerQuery): void => {
  let nsCounter = 0;
  const ns = (): string => `q${(nsCounter += 1)}-`;

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
  ): { transfers: readonly [Transfer, ...Transfer[]]; reason: TransactionReason; idempotencyKey: IdempotencyKey } => ({
    transfers,
    reason,
    idempotencyKey,
  });

  describe('the ledger query/audit contract', () => {
    test('an untouched account has a zero balance at every moment and an empty history', async () => {
      const L = ledgerOf();
      const { acc } = scope();
      const ghost = acc('ghost');
      must(await L.openAccount(account(ghost, 'user-wallet')));

      expect(await L.balanceAt(ghost, at(0))).toBe(0n);
      expect(await L.balanceAt(ghost, at(2_000_000_000_000))).toBe(0n);
      expect(await L.historyOf(ghost)).toEqual([]);
    });

    test('a funded account reflects the funding from its moment onward, and zero before it', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const r = mustReceipt(await L.post(move([leg(mint, alice, 500n)], key('fund'))));
      const t = r.occurredAt;

      expect(await L.balanceAt(alice, t)).toBe(500n); // the movement at t is included
      expect(await L.balanceAt(alice, at(t - 1))).toBe(0n); // immune to a future it hasn't reached
    });

    test('point-in-time balance is immune to activity that came after the asked-for moment', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const bob = acc('bob');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(bob, 'user-wallet')));

      const fund = mustReceipt(await L.post(move([leg(mint, alice, 500n)], key('fund'))));
      const spend = mustReceipt(await L.post(move([leg(alice, bob, 200n)], key('spend'))));
      const t1 = fund.occurredAt;
      const t2 = spend.occurredAt;

      expect(await L.balanceAt(alice, at(Math.max(t1, t2)))).toBe(300n); // after both
      expect(await L.balanceAt(alice, at(t1 - 1))).toBe(0n); // before both
      // At t1 the spend counts only if the engine stamped it no later than the funding.
      expect(await L.balanceAt(alice, t1)).toBe(t2 <= t1 ? 300n : 500n);
    });

    test('history records each leg from the account side: direction, amount, counterparty, reason, balance', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const bob = acc('bob');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(bob, 'user-wallet')));

      const fund = mustReceipt(await L.post(move([leg(mint, alice, 500n)], key('fund'))));
      const spend = mustReceipt(await L.post(move([leg(alice, bob, 200n)], key('spend'))));

      expect(await L.historyOf(alice)).toEqual([
        {
          occurredAt: fund.occurredAt,
          direction: 'credit',
          amount: 500n,
          counterparty: mint,
          resultingBalance: 500n,
          reason,
        },
        {
          occurredAt: spend.occurredAt,
          direction: 'debit',
          amount: 200n,
          counterparty: bob,
          resultingBalance: 300n,
          reason,
        },
      ]);

      // Bob's side sees the same leg as an arriving credit from alice.
      expect(await L.historyOf(bob)).toEqual([
        {
          occurredAt: spend.occurredAt,
          direction: 'credit',
          amount: 200n,
          counterparty: alice,
          resultingBalance: 200n,
          reason,
        },
      ]);
    });

    test('a multi-leg movement appears as one entry per leg in the payer history, balances accumulating in order', async () => {
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

      const fund = mustReceipt(await L.post(move([leg(mint, backer, 100n)], key('fund'))));
      const pay = mustReceipt(
        await L.post(move([leg(backer, builder, 95n), leg(backer, platform, 5n)], key('pay'))),
      );

      expect(await L.historyOf(backer)).toEqual([
        {
          occurredAt: fund.occurredAt,
          direction: 'credit',
          amount: 100n,
          counterparty: mint,
          resultingBalance: 100n,
          reason,
        },
        {
          occurredAt: pay.occurredAt,
          direction: 'debit',
          amount: 95n,
          counterparty: builder,
          resultingBalance: 5n,
          reason,
        },
        {
          occurredAt: pay.occurredAt,
          direction: 'debit',
          amount: 5n,
          counterparty: platform,
          resultingBalance: 0n,
          reason,
        },
      ]);
    });

    test('the mint audit trail: each issuance is a debit driving the balance further negative', async () => {
      // The single most important reconciliation query in a coin ledger — "every coin
      // came from somewhere" reads as the mint's own debit history, and its balance is
      // the coins in circulation. The mint is the one account that goes negative, so its
      // resulting balances exercise the signed path on both backends.
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      const bob = acc('bob');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));
      must(await L.openAccount(account(bob, 'user-wallet')));

      const issueA = mustReceipt(await L.post(move([leg(mint, alice, 500n)], key('issue-a'))));
      const issueB = mustReceipt(await L.post(move([leg(mint, bob, 200n)], key('issue-b'))));

      expect(await L.historyOf(mint)).toEqual([
        {
          occurredAt: issueA.occurredAt,
          direction: 'debit',
          amount: 500n,
          counterparty: alice,
          resultingBalance: -500n,
          reason,
        },
        {
          occurredAt: issueB.occurredAt,
          direction: 'debit',
          amount: 200n,
          counterparty: bob,
          resultingBalance: -700n,
          reason,
        },
      ]);

      expect(await L.balanceAt(mint, at(Math.max(issueA.occurredAt, issueB.occurredAt)))).toBe(-700n);
      expect(await L.balanceAt(mint, at(issueA.occurredAt - 1))).toBe(0n); // before any coin existed
    });

    test('a replayed movement records once, so history shows one entry, not two', async () => {
      const L = ledgerOf();
      const { acc, key } = scope();
      const mint = acc('mint');
      const alice = acc('alice');
      must(await L.openAccount(account(mint, 'mint')));
      must(await L.openAccount(account(alice, 'user-wallet')));

      const k = key('once');
      mustReceipt(await L.post(move([leg(mint, alice, 40n)], k)));
      mustReceipt(await L.post(move([leg(mint, alice, 40n)], k))); // identical replay

      const history = await L.historyOf(alice);
      expect(history).toHaveLength(1);
      expect(history[0]?.resultingBalance).toBe(40n);
    });
  });
};
