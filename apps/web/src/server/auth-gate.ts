import type { AuthService, Authenticated } from '@crowdship/identity';
import { sessionToken } from '@crowdship/identity';

/**
 * THE single boundary where a request is turned into a principal — authentication,
 * the first half of the auth gate [LAW:single-enforcer]. This framework-free core
 * takes the bearer value a request carries and the identity port, and re-reads the
 * DOMAIN session every call, so a logout, credential reset, or expiry ends the
 * request's authority immediately rather than letting a self-contained JWT outlive
 * it [LAW:no-silent-failure]. The NextAuth `jwt` callback is the thin adapter that
 * binds the production singleton and maps an absent principal onto cookie
 * invalidation; the decision lives here, testable over a recording service without
 * NextAuth's runtime [LAW:effects-at-boundaries].
 */

/** The narrow identity slice the gate needs — resolve a bearer token to its principal, nothing more [LAW:locality-or-seam]. */
export type SessionResolver = Pick<AuthService, 'resolveSession'>;

/**
 * Resolve the bearer value a request carries to its live principal, or `null` when
 * it has none. No token carried, a malformed one, and one naming no live session
 * are all the same single fact every consumer acts on — "this request is not
 * authenticated" — so the type carries exactly that and no finer distinction
 * nothing reads [LAW:types-are-the-program]. The same operations run every call —
 * parse, then resolve — with the variability in the returned value, never in
 * whether the resolve happens [LAW:dataflow-not-control-flow]. `null` is the honest
 * answer, not a swallowed error: the caller makes it loud by clearing the cookie
 * [LAW:no-silent-failure].
 */
export async function resolveRequest(
  resolver: SessionResolver,
  carried: string | undefined,
): Promise<Authenticated | null> {
  if (carried === undefined) return null;
  const token = sessionToken(carried);
  if (!token.ok) return null;
  const resolved = await resolver.resolveSession(token.value);
  return resolved.ok ? resolved.value : null;
}
