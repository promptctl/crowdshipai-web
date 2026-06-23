import { announcePresence, getLiveFeed, liveTopicOf } from '@/server/live-feed';
import { getPresenceRegistry, presenceTopicOf } from '@/server/presence';
import { createWatchEventStream } from '@/server/watch-event-stream';

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
 * and closes when they leave. That whole lifecycle — subscribe, join presence, announce
 * the count, and tear all three down in the right order — lives in
 * {@link createWatchEventStream}, a unit a test drives against a real feed and registry
 * [LAW:decomposition]. This route only resolves the composition roots and the request's
 * slug into plain values and hands them over [LAW:effects-at-boundaries]; it owns
 * nothing of the lifecycle itself. The authoritative count lives in the presence
 * registry, never this feed [LAW:one-source-of-truth].
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

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const body = createWatchEventStream({
    feed: getLiveFeed(),
    topic: liveTopicOf(slug),
    registry: getPresenceRegistry(),
    presenceTopic: presenceTopicOf(slug),
    announcePresence: (count) => announcePresence(slug, count),
    signal: request.signal,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
