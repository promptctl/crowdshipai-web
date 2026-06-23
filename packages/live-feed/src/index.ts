/**
 * The live event channel — the real-time layer that overlays what fired onto the
 * stream, live. One seam between the side that publishes (a fired menu effect, a
 * presence change, a settlement release) and the side that watches (the viewer's
 * overlay), created as an interface so neither reaches into the other
 * [LAW:locality-or-seam]. This is core — vendor- and framework-free, standing only
 * on `@crowdship/std`; a real fan-out transport (SSE, websockets, a pub/sub bus)
 * binds the {@link LiveFeed} seam from an adapter later, and the watch surface
 * (discovery-41w.3) subscribes to it; they are not it.
 *
 * What can appear on the feed is OPEN, keyed by an opaque `LiveTopic` and carried as
 * `JsonValue`, so this seam knows nothing of menu, identity, or settlement — the app
 * maps each domain's events onto a topic at its one composition point. It is a LIVE
 * feed, never a history: the durable, authoritative record lives in the ledger and
 * the settlement feed, never here [LAW:one-source-of-truth].
 */
export type { JsonValue } from './json.js';

export type { LiveTopic } from './topic.js';
export { liveTopic } from './topic.js';

export type { LiveEvent, LiveEventType } from './event.js';
export { liveEventType } from './event.js';

export type { LiveFeed, LiveSubscription, LiveWatcher } from './feed.js';

export { createInMemoryLiveFeed } from './in-memory-feed.js';
