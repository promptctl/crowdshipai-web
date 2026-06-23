import type { LiveEvent } from './event.js';
import type { LiveTopic } from './topic.js';

/**
 * What a watcher does with each event as it fires — render it on the overlay, write
 * it down an open SSE connection, push it to a websocket. The feed hands it the
 * event and asks nothing back; delivery is fire-and-forget fan-out, the nature of a
 * live overlay [LAW:effects-at-boundaries].
 */
export type LiveWatcher = (event: LiveEvent) => void;

/**
 * A live watch in progress, ended by `close`. Closing is idempotent — closing an
 * already-closed watch is a no-op, never an error — mirroring how `IngestBroker.close`
 * treats an unknown stream as success, so a caller (an SSE handler tearing down on a
 * dropped connection) need not track whether it already closed.
 */
export interface LiveSubscription {
  close(): void;
}

/**
 * THE real-time seam between the menu (what fired) and the stream (showing it):
 * one side publishes events onto a topic, the other watches that topic and receives
 * them as they fire — and neither reaches into the other [LAW:locality-or-seam].
 * It is to a real fan-out transport (SSE, websockets, a Redis pub/sub bus — a solved
 * problem we do not rebuild) exactly what `IngestBroker` is to a media provider and
 * `PaymentGateway` is to Stripe: one port, an in-memory fake for now, a real backend
 * swapped in behind it later with no caller change [LAW:one-type-per-behavior].
 *
 * It is a LIVE feed, not a history: a subscription receives only events published
 * AFTER it attaches, and the feed records nothing [LAW:decomposition]. The durable
 * record of what happened is owned elsewhere and authoritatively — the ledger's
 * history, the settlement feed, the audit trail — so this feed never becomes a
 * second tally of the truth that could drift from the money [LAW:one-source-of-truth].
 * A viewer who misses a live event re-derives it from that durable source; the live
 * feed only carries it to those watching at the instant it fires.
 *
 * `publish` is async because a real fan-out backend is (a network hop to the bus);
 * modeling it sync now would force a rewrite later, the same reasoning the `Ledger`,
 * `IngestBroker`, and `AuthService` seams use. `subscribe` is synchronous because a
 * watcher attaches to an already-established feed — the connection the framework
 * (an SSE route, a websocket handler) has already opened — so attaching a listener
 * is local registration, not a round trip.
 */
export interface LiveFeed {
  /** Publish an event onto a topic, fanning it out to every watcher of that topic at this instant. */
  publish(topic: LiveTopic, event: LiveEvent): Promise<void>;

  /** Watch a topic: receive every event published while the subscription is live. Returns the handle that ends it. */
  subscribe(topic: LiveTopic, watcher: LiveWatcher): LiveSubscription;
}
