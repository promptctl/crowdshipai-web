import type { Result } from '@crowdship/std';

import { show } from './format.js';

/**
 * Unwrap a construction that cannot legitimately fail at this call site — a randomly
 * minted id, a base64url token, the current clock reading, a brand rebuilt from a row
 * the store itself wrote. If it ever does fail, that is a broken invariant in the
 * platform's own primitives or a corrupted durable record, halted loudly rather than
 * smuggled onward as a malformed value [LAW:no-silent-failure]. `context` describes the
 * unwrap so the thrown error names what broke; the error payload is rendered through
 * `show` because it can carry a bigint (e.g. a non-positive `coinAmount`'s `{ value }`)
 * that a raw `JSON.stringify` would itself throw on.
 */
export const orThrow = <T>(r: Result<T, unknown>, context: string): T => {
  if (!r.ok) throw new Error(`${context}: ${show(r.error)}`);
  return r.value;
};
