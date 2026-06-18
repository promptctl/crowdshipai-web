import type { Brand } from './brand.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type AccountId = Brand<string, 'AccountId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

/**
 * Why coins moved, recorded verbatim. The ledger never branches on the reason
 * — it carries it [LAW:dataflow-not-control-flow] — so this is an open label,
 * not a closed enum the platform must extend for every new kind of offer.
 */
export type TransactionReason = Brand<string, 'TransactionReason'>;

/** Epoch milliseconds, supplied from a boundary that owns the clock. */
export type Timestamp = Brand<number, 'EpochMillis'>;

export type IdError = { readonly kind: 'empty'; readonly label: string };

const nonEmpty = <B extends string>(label: string, raw: string): Result<Brand<string, B>, IdError> =>
  raw.length > 0 ? ok(raw as Brand<string, B>) : err({ kind: 'empty', label });

export const accountId = (raw: string): Result<AccountId, IdError> =>
  nonEmpty<'AccountId'>('accountId', raw);
export const transactionId = (raw: string): Result<TransactionId, IdError> =>
  nonEmpty<'TransactionId'>('transactionId', raw);
export const idempotencyKey = (raw: string): Result<IdempotencyKey, IdError> =>
  nonEmpty<'IdempotencyKey'>('idempotencyKey', raw);
export const transactionReason = (raw: string): Result<TransactionReason, IdError> =>
  nonEmpty<'TransactionReason'>('transactionReason', raw);

export type TimestampError =
  | { readonly kind: 'not-integer'; readonly value: number }
  | { readonly kind: 'negative'; readonly value: number };

export const timestamp = (value: number): Result<Timestamp, TimestampError> => {
  if (!Number.isInteger(value)) return err({ kind: 'not-integer', value });
  if (value < 0) return err({ kind: 'negative', value });
  return ok(value as Timestamp);
};
