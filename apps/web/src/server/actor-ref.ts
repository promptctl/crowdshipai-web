import type { Principal } from '@crowdship/identity';
import { actorRef, type ActorRef } from '@crowdship/moderation';
import { show } from '@crowdship/std';

/**
 * The one place the web app names an authenticated principal to moderation
 * [LAW:single-enforcer]. The policy boundary, the report path, and the review path all
 * speak in moderation's opaque {@link ActorRef}, never an identity `AccountId` —
 * moderation is core and cannot see identity (a sibling core) [LAW:one-way-deps]. Every
 * surface that hands an acting principal to moderation maps it HERE, so "what is this
 * account's actor ref" has exactly one answer and the mapping cannot drift across the
 * viewer, the reporter, and the reviewer.
 *
 * An `AccountId` is already a non-blank branded value, so a blank ref is
 * impossible-by-construction; we still unwrap loudly rather than coerce, because a
 * silently-empty actor ref would be a lie about who acted [LAW:no-silent-failure]. The
 * anonymous-viewer ref (a logged-out reader) is access's own concern — only an
 * authenticated principal has an identity to name, and that is what this maps.
 */
export const actorRefFor = (principal: Principal): ActorRef => {
  const ref = actorRef(principal.id);
  if (!ref.ok) throw new Error(`actor-ref: invalid actor ref: ${show(ref.error)}`);
  return ref.value;
};
