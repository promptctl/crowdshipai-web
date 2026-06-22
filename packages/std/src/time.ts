import type { Brand } from './brand.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/** Epoch milliseconds, supplied from a boundary that owns the clock [LAW:no-ambient-temporal-coupling]. */
export type Timestamp = Brand<number, 'EpochMillis'>;

export type TimestampError =
  | { readonly kind: 'not-safe-integer'; readonly value: number }
  | { readonly kind: 'negative'; readonly value: number };

// Number.isSafeInteger rejects fractions, NaN, Infinity, and magnitudes past
// 2^53 where integer precision silently breaks down [LAW:no-silent-failure].
export const timestamp = (value: number): Result<Timestamp, TimestampError> => {
  if (!Number.isSafeInteger(value)) return err({ kind: 'not-safe-integer', value });
  if (value < 0) return err({ kind: 'negative', value });
  return ok(value as Timestamp);
};

/**
 * The capability of reading the current instant. Injected, never reached for
 * ambiently — a component that needs "now" declares this dependency so its
 * behavior is a function of its inputs and is testable without real time
 * [LAW:no-ambient-temporal-coupling] [LAW:effects-at-boundaries].
 */
export interface Clock {
  now(): Timestamp;
}
