import type { Principal } from '@crowdship/identity';

import { auth } from './auth';

/**
 * The current request's authenticated principal — the authorization subject — or
 * `null` when the request carries no live session. This is the single server-side
 * read every page, route handler, and action uses to learn WHO is acting and WHAT
 * they may do, so an authz check (`mayManageChannel`, `maySetVerification`, …) is
 * always fed its subject from the same place and cannot drift [LAW:single-enforcer].
 *
 * It does NO IO of its own. The `jwt` gate in `./auth` already re-resolved the
 * domain session this request and stamped the principal into the session —
 * invalidating the cookie outright if that session was dead — so a non-null result
 * here is a GUARANTEED-LIVE principal carrying capabilities as fresh as this
 * request, read straight off the session with the bearer token never re-exposed
 * [LAW:effects-at-boundaries]. Callers that also need the email or other
 * account-shaped data reach for `auth()` directly; this returns exactly the authz
 * subject and nothing more [LAW:decomposition].
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const session = await auth();
  if (session === null) return null;
  return { id: session.user.id, roles: session.user.roles };
}
