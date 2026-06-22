import type { Result } from '@crowdship/std';

/**
 * Unwrap a reconstruction that cannot legitimately fail for a row this store wrote
 * — the {@link EntryId} and {@link Timestamp} the trail itself minted and stamped. If
 * it ever does, that is a durable row corrupted out from under the writer, halted
 * loudly rather than smuggled onward as a malformed envelope [LAW:no-silent-failure].
 * The moderation-node twin of identity-node's `orThrow`; duplicated rather than shared
 * across a sibling adapter, because an adapter may not depend on a sibling adapter
 * [LAW:one-way-deps] — the few lines are the price of that independence, and the
 * `node:sqlite` loader idiom that platform-92o folds into one home is the larger
 * instance of the same duplication.
 */
export const orThrow = <T>(r: Result<T, unknown>, context: string): T => {
  if (!r.ok) throw new Error(`moderation-node: ${context}: ${JSON.stringify(r.error)}`);
  return r.value;
};

type Row = Record<string, unknown>;

/** Read a column that must be a string, halting loudly if the durable record holds anything else [LAW:no-silent-failure]. */
export const reqStr = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`moderation-node: column ${column} is not a string: ${JSON.stringify(value)}`);
  }
  return value;
};

/** Read a column that must be a safe-integer number; a bigint or anything else is corruption, halted loudly. */
export const reqInt = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`moderation-node: column ${column} is not a safe integer: ${JSON.stringify(value)}`);
  }
  return value;
};
