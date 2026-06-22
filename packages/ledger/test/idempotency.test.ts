import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  timestamp,
  transaction,
  transactionId,
  transactionReason,
  transfer,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Transaction,
  type TransactionReason,
  type Transfer,
} from '@crowdship/ledger-kernel';

import { decideIdempotency } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const xfer = (from: string, to: string, amount: bigint): Transfer =>
  must(transfer(acc(from), acc(to), coins(amount)));
const reasonOf = (s: string): TransactionReason => must(transactionReason(s));
const keyOf = (s: string): IdempotencyKey => must(idempotencyKey(s));

/** The transaction the store returns for a key — exactly what the gate sees as
 *  `prior`. Only its operation identity (reason + transfers) drives the decision;
 *  the id/occurredAt are present but deliberately not compared. */
const recorded = (transfers: readonly Transfer[], reason: string, key: string): Transaction =>
  must(
    transaction({
      id: must(transactionId('recorded')),
      reason: reasonOf(reason),
      transfers,
      occurredAt: must(timestamp(1)),
      idempotencyKey: keyOf(key),
    }),
  );

const op = (transfers: readonly Transfer[], reason: string) => ({ transfers, reason: reasonOf(reason) });

describe('decideIdempotency classifies every request against what a key already holds', () => {
  test('no prior posting is a fresh post', () => {
    const decision = decideIdempotency(op([xfer('mint', 'alice', 100n)], 'buy'), undefined);
    expect(decision).toEqual({ kind: 'fresh' });
  });

  test('an identical operation under the key is an exact replay carrying the prior posting', () => {
    const prior = recorded([xfer('mint', 'alice', 100n)], 'buy', 'k');
    const decision = decideIdempotency(op([xfer('mint', 'alice', 100n)], 'buy'), prior);
    expect(decision).toEqual({ kind: 'replay', recorded: prior });
  });

  test('the same transfers under a different reason are a conflict', () => {
    const prior = recorded([xfer('mint', 'alice', 100n)], 'buy', 'k');
    const decision = decideIdempotency(op([xfer('mint', 'alice', 100n)], 'refund'), prior);
    expect(decision).toEqual({
      kind: 'conflict',
      conflict: { kind: 'idempotency-key-reused', key: keyOf('k'), recordedTransactionId: must(transactionId('recorded')) },
    });
  });

  test.each([
    ['a different amount', [xfer('mint', 'alice', 999n)]],
    ['a different destination', [xfer('mint', 'bob', 100n)]],
    ['a different source', [xfer('platform', 'alice', 100n)]],
    ['an extra transfer leg', [xfer('mint', 'alice', 100n), xfer('mint', 'bob', 1n)]],
  ])('%s under the same key is a conflict, never a replay', (_label, transfers) => {
    const prior = recorded([xfer('mint', 'alice', 100n)], 'buy', 'k');
    const decision = decideIdempotency(op(transfers, 'buy'), prior);
    expect(decision.kind).toBe('conflict');
  });

  test('transfer order is significant — the same legs reordered are a conflict', () => {
    const prior = recorded([xfer('mint', 'alice', 100n), xfer('mint', 'bob', 50n)], 'buy', 'k');
    const reordered = decideIdempotency(
      op([xfer('mint', 'bob', 50n), xfer('mint', 'alice', 100n)], 'buy'),
      prior,
    );
    expect(reordered.kind).toBe('conflict');
  });
});
