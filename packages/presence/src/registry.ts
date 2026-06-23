import type { PresenceTopic } from './topic.js';

/**
 * One viewer's presence on a stream, held for as long as they are watching and ended
 * by `release`. Releasing is idempotent — releasing an already-released presence is a
 * no-op, never an error, and never double-counts a single departure — mirroring how
 * `LiveSubscription.close` and `IngestBroker.close` treat a repeated teardown as
 * success. This matters because the one caller (the SSE route) tears a dropped
 * connection down through two independent paths whose order it cannot assume, so it
 * must be able to release on both without driving the count wrong [LAW:no-ambient-temporal-coupling].
 */
export interface PresenceHandle {
  release(): void;
}

/**
 * THE source of truth for how many viewers are watching a stream RIGHT NOW
 * [LAW:one-source-of-truth]. A viewer joins when their watch connection opens and
 * releases when it closes; the count is derived from those live presences, never
 * tallied from a stream of join/leave events that a dropped message could corrupt —
 * the whole reason a count needs its own authoritative registry rather than riding
 * the best-effort live feed.
 *
 * It is to a real cross-instance presence backend (a Redis set, a presence service —
 * a solved problem we do not rebuild) exactly what `LiveFeed` is to a real fan-out
 * transport and `IngestBroker` is to a media provider: one port, an in-memory fake
 * for now, a real backend swapped in behind it later with no caller change
 * [LAW:one-type-per-behavior]. `join` and `countOf` are synchronous because the
 * in-process registry is local state; a networked backend that needs them async binds
 * a different seam shape when it arrives, the same deliberate call the other ports made.
 *
 * It knows nothing of the live feed: publishing the derived count to watchers is the
 * app's job at its composition point, so this core never depends on a sibling core
 * [LAW:one-way-deps]. The registry owns the number; the app carries it to the overlay.
 */
export interface PresenceRegistry {
  /** Register one viewer as present on a topic; the returned handle ends that presence. */
  join(topic: PresenceTopic): PresenceHandle;

  /** How many viewers are present on a topic right now — `0` for a topic no one is watching. */
  countOf(topic: PresenceTopic): number;
}
