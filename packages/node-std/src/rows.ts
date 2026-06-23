/**
 * The trust-boundary readers for a row read back from SQLite: a durable record is
 * untrusted input until each column's type is checked, so these read a column AS a
 * given type and halt loudly if the stored value is anything else [LAW:no-silent-failure].
 * A corrupt record stops here rather than being smuggled onward as a malformed value.
 *
 * They live here once, shared by every durable store, because reading a typed column is
 * one behaviour [LAW:one-type-per-behavior]; an adapter could not share them with a
 * sibling adapter without an adapter→adapter edge [LAW:one-way-deps], so this
 * node-runtime home is where they belong. The thrown message names the column and the
 * offending value; which store raised it is carried by the call's stack frame, not
 * duplicated into the text.
 */

import { show } from '@crowdship/std';

/** A row read back from a query — every column an untrusted value until checked. */
type Row = Record<string, unknown>;

/** Read a column that must be a string. */
export const reqStr = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`column ${column} is not a string: ${show(value)}`);
  }
  return value;
};

/** Read a column that must be a safe-integer number; a bigint, a float, or anything else is corruption. */
export const reqInt = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`column ${column} is not a safe integer: ${show(value)}`);
  }
  return value;
};

/** Read a BLOB column as a Buffer, halting loudly if it is not byte data. */
export const reqBytes = (row: Row, column: string): Buffer => {
  const value = row[column];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`column ${column} is not bytes: ${show(value)}`);
  }
  return Buffer.from(value);
};
