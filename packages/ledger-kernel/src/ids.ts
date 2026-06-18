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

export type IdError = { readonly kind: 'blank'; readonly label: string };

// An id is treated as an exact, opaque string (no normalization — trimming would
// silently change a load-bearing key [LAW:no-silent-failure]). A blank id —
// empty OR whitespace-only — carries no identity and is rejected at the source.
const nonBlank = <B extends string>(label: string, raw: string): Result<Brand<string, B>, IdError> =>
  raw.trim().length > 0 ? ok(raw as Brand<string, B>) : err({ kind: 'blank', label });

export const accountId = (raw: string): Result<AccountId, IdError> =>
  nonBlank<'AccountId'>('accountId', raw);
export const transactionId = (raw: string): Result<TransactionId, IdError> =>
  nonBlank<'TransactionId'>('transactionId', raw);
export const idempotencyKey = (raw: string): Result<IdempotencyKey, IdError> =>
  nonBlank<'IdempotencyKey'>('idempotencyKey', raw);
export const transactionReason = (raw: string): Result<TransactionReason, IdError> =>
  nonBlank<'TransactionReason'>('transactionReason', raw);

export type TimestampError =
  | { readonly kind: 'not-safe-integer'; readonly value: number }
  | { readonly kind: 'negative'; readonly value: number };

// Number.isSafeInteger rejects fractions, NaN, Infinity, AND magnitudes past
// 2^53 where integer precision silently breaks down — a timestamp must not lose
// precision under us [LAW:no-silent-failure].
export const timestamp = (value: number): Result<Timestamp, TimestampError> => {
  if (!Number.isSafeInteger(value)) return err({ kind: 'not-safe-integer', value });
  if (value < 0) return err({ kind: 'negative', value });
  return ok(value as Timestamp);
};
