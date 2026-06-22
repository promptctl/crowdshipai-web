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
