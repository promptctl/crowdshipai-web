import {
  createInMemoryPresenceRegistry,
  presenceTopic,
  type PresenceRegistry,
  type PresenceTopic,
} from '@crowdship/presence';

/**
 * The single place the web app decides which {@link PresenceRegistry} it runs against
 * [LAW:one-source-of-truth] — the occupancy twin of `getLiveFeed()`. The watch route
 * marks a viewer present when their SSE connection opens and absent when it closes,
 * and the surface reads the live count off it; both reach the registry through
 * `getPresenceRegistry()`, so swapping today's in-process count for a cross-instance
 * backend (a Redis set, a presence service) is a change HERE and nowhere else
 * [LAW:locality-or-seam].
 *
 * Presence and the live feed are deliberately separate seams keyed off the same slug
 * at this one composition point: the registry OWNS the authoritative count, and the
 * feed only CARRIES the derived number to watchers. A core never reaches into a
 * sibling core [LAW:one-way-deps]; the app does the bridging — read the count here,
 * announce it on the feed there — exactly as it maps a `Principal` onto a ledger
 * account in `market.ts`.
 */

// One registry per process, the single owner of the in-memory presence
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR, which
// re-evaluates modules, reuses the live count instead of resetting every stream's
// occupancy to zero on each edit — the same pattern the live feed and market use.
const globalForPresence = globalThis as unknown as { __crowdshipPresence?: PresenceRegistry };
const presence: PresenceRegistry = globalForPresence.__crowdshipPresence ?? createInMemoryPresenceRegistry();
if (process.env.NODE_ENV !== 'production') globalForPresence.__crowdshipPresence = presence;

export const getPresenceRegistry = (): PresenceRegistry => presence;

/** The presence topic a builder's stream is counted under, derived from the channel
 *  slug at this one composition point — the occupancy twin of `liveTopicOf`. A blank
 *  slug is a routing bug, not a runtime condition, so it halts loudly [LAW:no-silent-failure]. */
export const presenceTopicOf = (builderSlug: string): PresenceTopic => {
  const topic = presenceTopic(`channel:${builderSlug}`);
  if (!topic.ok) throw new Error(`presence: blank topic for builder slug ${JSON.stringify(builderSlug)}`);
  return topic.value;
};
