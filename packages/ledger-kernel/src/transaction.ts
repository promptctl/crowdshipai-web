import type { AccountId, IdempotencyKey, Timestamp, TransactionId, TransactionReason } from './ids.js';
import type { CoinAmount } from './money.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';
import type { Transfer } from './transfer.js';

export type NonEmptyArray<T> = readonly [T, ...T[]];

/**
 * An atomic, balanced group of transfers with its identity and provenance.
 * Because it is built only from transfers, its net effect across all accounts
 * is exactly zero — every coin is accounted for. Ordering and timing are not
 * implicit here: the moment it occurred is supplied, never read from an ambient
 * clock [LAW:no-ambient-temporal-coupling].
 */
export interface Transaction {
  readonly id: TransactionId;
  readonly reason: TransactionReason;
  readonly transfers: NonEmptyArray<Transfer>;
  readonly occurredAt: Timestamp;
  readonly idempotencyKey: IdempotencyKey;
}

export interface TransactionParams {
  readonly id: TransactionId;
  readonly reason: TransactionReason;
  readonly transfers: readonly Transfer[];
  readonly occurredAt: Timestamp;
  readonly idempotencyKey: IdempotencyKey;
}

export type TransactionError = { readonly kind: 'no-transfers' };

/**
 * The only constructor of a `Transaction`. It rejects the one illegal shape a
 * list of transfers can still take — being empty — and narrows the result to a
 * non-empty tuple so downstream code never re-checks emptiness.
 */
export const transaction = (params: TransactionParams): Result<Transaction, TransactionError> => {
  const [head, ...rest] = params.transfers;
  if (head === undefined) return err({ kind: 'no-transfers' });
  return ok({
    id: params.id,
    reason: params.reason,
    transfers: [head, ...rest],
    occurredAt: params.occurredAt,
    idempotencyKey: params.idempotencyKey,
  });
};

/**
 * A derived, per-account debit/credit view of a transaction. It is a
 * projection of the transfers, never an independent record that could disagree
 * with them [LAW:one-source-of-truth].
 */
export interface Entry {
  readonly account: AccountId;
  readonly direction: 'debit' | 'credit';
  readonly amount: CoinAmount;
  readonly transactionId: TransactionId;
}

export const entriesOf = (txn: Transaction): readonly Entry[] =>
  txn.transfers.flatMap((t): readonly Entry[] => [
    { account: t.from, direction: 'debit', amount: t.amount, transactionId: txn.id },
    { account: t.to, direction: 'credit', amount: t.amount, transactionId: txn.id },
  ]);

/** Signed coin effect of an entry on its account: credits add, debits subtract. */
export const signedEffect = (entry: Entry): bigint =>
  entry.direction === 'credit' ? entry.amount : -entry.amount;

/**
 * Net coin effect per account for one transaction. The ledger's central
 * theorem: the sum of every value in the returned map is always exactly zero.
 * It holds by construction (transfers are balanced pairs); the test suite
 * asserts it as a property over arbitrary transactions [LAW:verifiable-goals].
 */
export const netEffect = (txn: Transaction): ReadonlyMap<AccountId, bigint> => {
  const net = new Map<AccountId, bigint>();
  for (const entry of entriesOf(txn)) {
    net.set(entry.account, (net.get(entry.account) ?? 0n) + signedEffect(entry));
  }
  return net;
};
