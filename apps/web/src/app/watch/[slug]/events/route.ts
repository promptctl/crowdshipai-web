import type { LiveSubscription } from '@crowdship/live-feed';
import type { PresenceHandle } from '@crowdship/presence';

import { announcePresence, getLiveFeed, liveTopicOf } from '@/server/live-feed';
import { getPresenceRegistry, presenceTopicOf } from '@/server/presence';

/**
 * The watch surface's real-time transport edge: a Server-Sent-Events stream of one
 * builder's live feed. This is the SUBSCRIBE half of the menu→stream seam — the
 * publish half (a fired offer announcing onto the same topic) is already live in
 * `buyOffer`. A viewer's browser opens an `EventSource` here; every {@link LiveEvent}
 * published to the builder's topic is written down the wire as JSON, verbatim
 * [LAW:effects-at-boundaries] — this edge is a dumb pipe for payloads, it never
 * interprets them, so it carries EVERY event type the feed grows (presence, chat,
 * settlement) through this one route with no change [LAW:no-mode-explosion]. The
 * client decides what each event means.
 *
 * This same connection IS one viewer's presence: it opens when they start watching
 * and closes when they leave, so the route — already the one owner of the connection's
 * lifecycle — is exactly where that viewer is marked present and absent
 * [LAW:no-ambient-temporal-coupling]. Presence is not a payload this pipe interprets;
 * it is the pipe's own occupancy. The authoritative count lives in the presence
 * registry; this route only joins/leaves it and announces the registry's derived
 * count back onto the feed for every watcher [LAW:one-source-of-truth].
 *
 * It is LIVE, not history: the subscription receives only events published after it
 * attaches, and the feed stores nothing. A viewer who joins mid-stream sees effects
 * from the moment they connect, never a backlog — a backlog, if ever wanted, is read
 * from the durable ledger/settlement record, never from this feed [LAW:one-source-of-truth].
 *
 * Runs on the Node runtime so it shares the one in-process `getLiveFeed()` singleton
 * with the publish edge (a server action), and is force-dynamic so Next never tries
 * to statically render a live stream [LAW:no-ambient-temporal-coupling].
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

/** Frame one live event as an SSE `data:` record. The whole event is serializable
 *  (branded string `type`, branded number `at`, `JsonValue` payload), so it crosses
 *  the wire as JSON unchanged for the client to parse at its trust boundary. */
const frame = (event: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const topic = liveTopicOf(slug);
  const feed = getLiveFeed();
  const presenceTopic = presenceTopicOf(slug);
  const registry = getPresenceRegistry();

  // The connection's lifecycle has one explicit owner: the request's abort signal.
  // Subscribe when the stream starts; close the subscription and the stream the
  // instant the client goes away — no reliance on incidental GC or callback order
  // [LAW:no-ambient-temporal-coupling]. `close()` is idempotent, so the abort path
  // and the consumer-cancel path can both call it safely.
  let subscription: LiveSubscription | null = null;
  let presence: PresenceHandle | null = null;

  // One viewer leaves exactly once: release their presence and announce the now-lower
  // count to everyone still watching. The runtime tears a dropped connection down
  // through two paths (the abort signal and the pipe's own cancel) in an order we do
  // not own, so this is guarded to release and announce a single departure once — the
  // same single-owner discipline the controller close below uses [LAW:no-ambient-temporal-coupling].
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    presence?.release();
    void announcePresence(slug, registry.countOf(presenceTopic));
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      subscription = feed.subscribe(topic, (event) => controller.enqueue(frame(event)));
      // An opening comment flushes the response headers promptly so the client's
      // `EventSource` reaches its open state before the first real event arrives.
      controller.enqueue(encoder.encode(': connected\n\n'));
      // Mark this viewer present AFTER subscribing, so the count this join announces
      // fans out to their own just-attached subscription too: they see themselves
      // counted, and so does everyone already watching. The order is the route's to
      // own, not an accident of callback timing [LAW:no-ambient-temporal-coupling].
      presence = registry.join(presenceTopic);
      void announcePresence(slug, registry.countOf(presenceTopic));
      request.signal.addEventListener('abort', () => {
        leave();
        subscription?.close();
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
      subscription?.close();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
