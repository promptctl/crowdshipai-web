import { createHash } from 'node:crypto';
import type { Result } from '@crowdship/std';

/**
 * Unwrap a construction that cannot legitimately fail here — a randomly minted
 * id, a base64url token, the current clock reading. If it ever does, that is a
 * broken invariant in the platform's own primitives, halted loudly rather than
 * smuggled onward as a malformed value [LAW:no-silent-failure].
 */
export const orThrow = <T>(r: Result<T, unknown>, context: string): T => {
  if (!r.ok) throw new Error(`identity-node: ${context}: ${JSON.stringify(r.error)}`);
  return r.value;
};

/**
 * The at-rest key for a high-entropy bearer token: an unsalted SHA-256. A salt
 * would buy nothing — the token is 256 bits of CSPRNG output, not a guessable
 * user secret, so there is no dictionary to defend against — and the digest is
 * what the session/recovery tables store, so a database leak yields no usable
 * token [LAW:effects-at-boundaries]. Same input always maps to the same key, which
 * is exactly what lookup-by-token needs.
 */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

type Row = Record<string, unknown>;

/** Read a column that must be a string, halting loudly if the durable record holds anything else [LAW:no-silent-failure]. */
export const reqStr = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`identity-node: column ${column} is not a string: ${JSON.stringify(value)}`);
  }
  return value;
};

/** Read a column that must be a safe-integer number; a bigint or anything else is corruption, halted loudly. */
export const reqInt = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`identity-node: column ${column} is not a safe integer: ${JSON.stringify(value)}`);
  }
  return value;
};

/** Read a BLOB column as a Buffer, halting loudly if it is not byte data. */
export const reqBytes = (row: Row, column: string): Buffer => {
  const value = row[column];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`identity-node: column ${column} is not bytes: ${JSON.stringify(value)}`);
  }
  return Buffer.from(value);
};
