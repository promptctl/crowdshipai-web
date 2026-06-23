import type { Principal } from '@crowdship/identity';
import {
  actorRef,
  type ActorRef,
  type MaturityLevel,
  type MaturityRating,
  type PolicyDecision,
} from '@crowdship/moderation';
import { show } from '@crowdship/std';

import { actorRefFor } from './actor-ref';
import { getPolicyBoundary } from './policy';

/**
 * The viewer-access seam: the one composition point that maps a viewer onto the
 * facts the age gate (o97.3) judges, then asks the single policy boundary whether
 * they may see rated content. Every surface that renders rated content — the
 * channel page, the browse grid, the watch surface as it lands — routes its
 * access question through here, so the principal→`ActorRef` mapping and the
 * clearance derivation live in exactly one place and cannot drift across surfaces
 * [LAW:single-enforcer], the same role `server/sanctions.ts` plays for conduct
 * standing.
 *
 * It is PURE: the only IO — reading WHO is acting — is `currentPrincipal()`, which
 * the calling surface performs at its own edge and hands in. So the decision is a
 * total function of (principal, rating) and is unit-testable without a session
 * [LAW:effects-at-boundaries]. The boundary it consults is itself a pure,
 * stateless singleton.
 */

/**
 * The stable actor reference for the anonymous viewer — a logged-out request still
 * needs SOME `ActorRef` to name the subject the gate decides about, and "everyone
 * not logged in" is one actor as far as access goes. A literal, non-blank label, so
 * the `actorRef` constructor below can only fail by programmer error.
 */
const ANONYMOUS_VIEWER = 'anonymous-viewer';

/**
 * Map a viewer onto moderation's opaque {@link ActorRef} at the one composition
 * point [LAW:decomposition] — the same move `getPolicyBoundary`'s doc names and
 * `server/sanctions` makes for an actor's standing. A logged-in viewer is named by
 * their account id through the one principal→ref mapping [LAW:single-enforcer], a
 * logged-out one by the shared anonymous label. The anonymous label is a non-blank
 * literal, so a blank ref here is impossible-by-construction; we still unwrap loudly
 * rather than coerce, because a silently-empty actor ref would be a lie
 * [LAW:no-silent-failure].
 */
const viewerRef = (principal: Principal | null): ActorRef => {
  if (principal !== null) return actorRefFor(principal);
  const ref = actorRef(ANONYMOUS_VIEWER);
  if (!ref.ok) throw new Error(`access: invalid actor ref: ${show(ref.error)}`);
  return ref.value;
};

/**
 * The highest maturity level this viewer is cleared to see, derived from the
 * world-fact of their age and verification. The platform records NEITHER yet, so
 * the honest answer for every viewer — logged in or not — is the baseline
 * `'general'`. This is the floor, not a silent default: mature content gates for
 * everyone until age verification exists, rather than pretending a clearance no
 * fact backs [LAW:no-silent-failure]. When that fact lands (an age check, a
 * verified-adult flag), it is read HERE and nowhere else [LAW:single-enforcer], and
 * no caller of {@link viewerAccessDecision} changes.
 */
const viewerClearance = (_principal: Principal | null): MaturityLevel => 'general';

/**
 * Decide whether a viewer may see content of the given rating: gather the viewer's
 * facts and run them through the one boundary. The outcome is the boundary's own
 * 3-arm {@link PolicyDecision} — `allowed`, `gated` (allowable to a viewer cleared
 * to `gates[].required`), or `denied` — which the surface destructures
 * exhaustively. A `gated` outcome is ordinary access control, NOT a moderation
 * incident; the surface prompts for the standing rather than blocking outright.
 */
export const viewerAccessDecision = (
  principal: Principal | null,
  rating: MaturityRating,
): PolicyDecision =>
  getPolicyBoundary().decide({
    kind: 'viewer-access',
    viewer: viewerRef(principal),
    rating,
    clearance: viewerClearance(principal),
  });
