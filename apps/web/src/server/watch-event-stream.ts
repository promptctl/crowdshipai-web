import type { LiveFeed, LiveSubscription, LiveTopic } from '@crowdship/live-feed';
import type { PresenceHandle, PresenceRegistry, PresenceTopic } from '@crowdship/presence';

/**
 * Build the SSE byte stream that bridges one viewer's watch connection to a builder's
 * live feed and presence — the body the watch route hands back as its response. Pulled
 * out of the route so the connection's whole lifecycle (subscribe, join presence,
 * announce the count, and tear all three down in the right order) is a unit that runs
 * and is asserted against a real feed and registry in a test, not logic welded to a
 * Next handler that only reasoning can check [LAW:decomposition]. The route resolves
 * the composition roots and the request's slug into the plain values below and owns
 * nothing of the lifecycle itself [LAW:effects-at-boundaries].
 *
 * The connection IS one viewer's presence: it opens when they start watching and
 * closes when they leave, so this stream — the one owner of that connection's lifecycle
 * — is exactly where the viewer is marked present and absent [LAW:no-ambient-temporal-coupling].
 * The authoritative count lives in the {@link PresenceRegistry}; this stream only
 * joins/leaves it and announces the registry's DERIVED count back onto the feed for
 * every watcher [LAW:one-source-of-truth].
 */
export interface WatchEventStreamDeps {
  /** The feed this connection subscribes to; every event on the topic is written verbatim. */
  readonly feed: LiveFeed;
  /** The live topic for this builder's stream — already derived from the slug at the edge. */
  readonly topic: LiveTopic;
  /** The source of truth for how many viewers are watching this stream right now. */
  readonly registry: PresenceRegistry;
  /** The presence topic for this stream — already derived from the slug at the edge. */
  readonly presenceTopic: PresenceTopic;
  /** Announce the already-derived viewer count to every watcher; slug is bound at the edge. */
  announcePresence(count: number): Promise<void>;
  /** The request's abort signal — one of the two teardown paths for a dropped connection. */
  readonly signal: AbortSignal;
}

const encoder = new TextEncoder();

/** Frame one live event as an SSE `data:` record. The whole event is serializable
 *  (branded string `type`, branded number `at`, `JsonValue` payload), so it crosses
 *  the wire as JSON unchanged for the client to parse at its trust boundary. */
const frame = (event: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export const createWatchEventStream = (deps: WatchEventStreamDeps): ReadableStream<Uint8Array> => {
  const { feed, topic, registry, presenceTopic, announcePresence, signal } = deps;

  // The connection's lifecycle has one explicit owner: this stream. Subscribe and join
  // presence when it starts; close the subscription, release presence, and announce the
  // departure the instant the client goes away — no reliance on incidental GC or
  // callback order [LAW:no-ambient-temporal-coupling].
  let subscription: LiveSubscription | null = null;
  let presence: PresenceHandle | null = null;

  // One viewer leaves exactly once. Close the feed subscription FIRST — before releasing
  // presence and announcing the lower count — so the departing viewer is no longer a
  // recipient of its own leave-frame. Announcing while still subscribed would fan that
  // frame back into THIS connection's already tearing-down controller, whose `enqueue`
  // throws; that throw would abort the teardown and leak the dead subscription into the
  // feed, where the next publish to the topic iterates it, throws again, and starves
  // every other watcher's fan-out. Closing first removes the self-delivery and means the
  // announced count already excludes this viewer. Guarded by `left` so the two teardown
  // paths (abort + pipe cancel), whose order we do not own, retire one departure exactly
  // once [LAW:no-ambient-temporal-coupling].
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    subscription?.close();
    presence?.release();
    void announcePresence(registry.countOf(presenceTopic));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      subscription = feed.subscribe(topic, (event) => {
        // A watcher must never throw back into the publisher. The consumer can vanish
        // between the runtime retiring this controller and our teardown callback
        // running, and `enqueue` into a closed controller throws — so a dead controller
        // ends its OWN subscription here rather than breaking the fan-out for every
        // other watcher of this stream. This is the terminal disconnect, the same
        // end-of-connection the abort and cancel paths handle, reached by whichever
        // signal observes it first [LAW:no-ambient-temporal-coupling]; it is handled at
        // the boundary, not hidden [LAW:no-silent-failure].
        try {
          controller.enqueue(frame(event));
        } catch {
          leave();
        }
      });
      // An opening comment flushes the response headers promptly so the client's
      // `EventSource` reaches its open state before the first real event arrives.
      controller.enqueue(encoder.encode(': connected\n\n'));
      // Mark this viewer present AFTER subscribing, so the count this join announces
      // fans out to their own just-attached subscription too: they see themselves
      // counted, and so does everyone already watching. The order is this stream's to
      // own, not an accident of callback timing [LAW:no-ambient-temporal-coupling].
      presence = registry.join(presenceTopic);
      void announcePresence(registry.countOf(presenceTopic));
      signal.addEventListener('abort', () => {
        leave();
        // The runtime tears a disconnected stream down through two independent paths
        // (this abort signal and the response pipe's own cancel), and their order is
        // not ours to assume. Closing an already-closed controller throws, so close
        // only while it is still open, reading the controller's own authoritative
        // state rather than trusting teardown order [LAW:no-ambient-temporal-coupling].
        if (controller.desiredSize !== null) controller.close();
      });
    },
    cancel() {
      leave();
    },
  });
};
