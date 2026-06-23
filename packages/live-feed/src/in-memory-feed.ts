import type { LiveEvent } from './event.js';
import type { LiveFeed, LiveSubscription, LiveWatcher } from './feed.js';
import type { LiveTopic } from './topic.js';

/**
 * The in-memory live feed: correct for a single process and for tests, the dev/test
 * stand-in behind the {@link LiveFeed} seam that a real fan-out transport (SSE,
 * websockets, a pub/sub bus) replaces with no caller change [LAW:locality-or-seam] —
 * mirroring `createInMemoryIngestBroker` and `createInMemoryPaymentGateway`.
 *
 * Each watcher is boxed in its own record so the same function may watch a topic
 * more than once and each watch closes independently [LAW:one-source-of-truth — a
 * subscription's identity is the box, not the function]. `publish` delivers to a
 * SNAPSHOT of the topic's watchers taken before any callback runs, so a watcher that
 * subscribes or closes DURING delivery neither joins nor is skipped mid-fan-out: the
 * recipients are exactly those watching at the instant publish was called, with no
 * dependence on incidental callback order [LAW:no-ambient-temporal-coupling]. A topic
 * whose last watcher closes is dropped from the map, so idle topics cannot accumulate.
 */
export const createInMemoryLiveFeed = (): LiveFeed => {
  // A box gives each subscription a stable identity independent of its watcher fn.
  type Watch = { readonly watcher: LiveWatcher };
  const topics = new Map<LiveTopic, Set<Watch>>();

  const publish = (topic: LiveTopic, event: LiveEvent): Promise<void> => {
    // Absence of watchers is a real, empty fan-out — a no-op success, not a failure
    // and not a guard hiding a skipped step [LAW:no-defensive-null-guards].
    const watching = topics.get(topic);
    const recipients = watching === undefined ? [] : [...watching];
    for (const { watcher } of recipients) watcher(event);
    return Promise.resolve();
  };

  const subscribe = (topic: LiveTopic, watcher: LiveWatcher): LiveSubscription => {
    const watching = topics.get(topic) ?? new Set<Watch>();
    topics.set(topic, watching);
    const watch: Watch = { watcher };
    watching.add(watch);
    return {
      close: () => {
        watching.delete(watch);
        // Drop an emptied topic, but ONLY while the map still holds THIS set: a
        // stale double-close (the idempotent no-op the contract promises) acts on the
        // captured set, which may already have been dropped and the topic reused by a
        // fresh subscription's set — deleting on size alone would silently evict that
        // live subscriber [LAW:one-source-of-truth — `topics.get` is authoritative,
        // the captured reference is a stale copy].
        if (watching.size === 0 && topics.get(topic) === watching) topics.delete(topic);
      },
    };
  };

  return { publish, subscribe };
};
