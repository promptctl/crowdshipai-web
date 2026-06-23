import { SystemClock } from '@crowdship/identity-node';
import {
  createInMemoryLiveFeed,
  liveEventType,
  liveTopic,
  type LiveEvent,
  type LiveEventType,
  type LiveFeed,
  type LiveTopic,
} from '@crowdship/live-feed';
import type { Effect, EffectReceipt } from '@crowdship/menu';

import { CHAT_MESSAGE_EVENT, EFFECT_FIRED_EVENT } from '../data/live-event';

/**
 * The single place the web app decides which {@link LiveFeed} it runs against
 * [LAW:one-source-of-truth] — the real-time twin of `getIngestBroker()` and
 * `getMarket()`. Everything that publishes onto a stream's overlay, and the watch
 * surface that subscribes to it (discovery-41w.3), reaches the feed through
 * `getLiveFeed()`, so swapping today's in-memory fan-out for a real transport (SSE,
 * websockets, a pub/sub bus) is a change HERE and nowhere else [LAW:locality-or-seam].
 *
 * It is also the ONE composition point where the menu's `Effect` and the stream's
 * channel are mapped onto the feed's opaque `LiveTopic` and `JsonValue` — neither
 * core reaches into the other, exactly as the live-feed seam requires; the app does
 * the bridging here, just as `market.ts` maps a `Principal` onto a ledger account
 * [LAW:decomposition]. Today the feed is the in-memory stand-in — the honest
 * walking-skeleton fake, not a silent pretense: a real backend binds this same
 * accessor with no caller change [LAW:no-silent-failure].
 */

const clock = new SystemClock();

/** The kind every effect-fired live event carries — the open label a watcher's
 *  overlay routes on, minted from the SAME wire label the watch surface parses on,
 *  so publish and consume cannot drift to different spellings [LAW:one-source-of-truth].
 *  A non-blank literal, so a blank is a broken invariant that halts loudly rather than
 *  minting a blank type [LAW:no-silent-failure]. */
const EFFECT_FIRED: LiveEventType = (() => {
  const t = liveEventType(EFFECT_FIRED_EVENT);
  if (!t.ok) throw new Error('live-feed: minted a blank live event type');
  return t.value;
})();

/** The kind every chat-message live event carries — chat riding the same spine as
 *  fired effects, minted from the SAME wire label the watch surface parses on so
 *  publish and consume cannot drift [LAW:one-source-of-truth]. Halts loudly on a
 *  blank rather than minting a blank type [LAW:no-silent-failure]. */
const CHAT_MESSAGE: LiveEventType = (() => {
  const t = liveEventType(CHAT_MESSAGE_EVENT);
  if (!t.ok) throw new Error('live-feed: minted a blank live event type');
  return t.value;
})();

// One feed per process, the single owner of the in-memory subscriptions
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR, which
// re-evaluates modules, reuses the live subscriptions instead of dropping every
// watcher on each edit — the same pattern the ingest broker and market use.
const globalForLiveFeed = globalThis as unknown as { __crowdshipLiveFeed?: LiveFeed };
const liveFeed: LiveFeed = globalForLiveFeed.__crowdshipLiveFeed ?? createInMemoryLiveFeed();
if (process.env.NODE_ENV !== 'production') globalForLiveFeed.__crowdshipLiveFeed = liveFeed;

export const getLiveFeed = (): LiveFeed => liveFeed;

/** The live topic a builder's stream publishes onto and viewers watch, derived from
 *  the channel slug at this one composition point — the real-time twin of how
 *  `market.ts` derives a builder's payee account from the same slug. A blank slug is
 *  a routing bug, not a runtime condition, so it halts loudly [LAW:no-silent-failure]. */
export const liveTopicOf = (builderSlug: string): LiveTopic => {
  const topic = liveTopic(`channel:${builderSlug}`);
  if (!topic.ok) throw new Error(`live-feed: blank topic for builder slug ${JSON.stringify(builderSlug)}`);
  return topic.value;
};

/**
 * Announce that an effect fired on a builder's stream — the publish half of the
 * menu→stream seam. It maps the menu's `Effect` and its `EffectReceipt` onto an open
 * `JsonValue` payload and publishes it to the builder's topic, stamped now. The
 * watcher's overlay reads `effectKind`/`params`/`receipt` to render it; the feed
 * never interprets the payload [LAW:effects-at-boundaries].
 *
 * This is best-effort live fan-out, NOT the record of what happened: the money moved
 * and the purchase is recorded complete in the ledger regardless of who is watching,
 * so a viewer who misses this re-derives it from that durable truth, never from the
 * feed [LAW:one-source-of-truth]. It is therefore called only on a genuine first
 * firing, never on an idempotent replay — a faithful retry must not re-show an effect
 * the audience already saw.
 */
export const announceEffectFired = (
  builderSlug: string,
  effect: Effect,
  receipt: EffectReceipt,
): Promise<void> => {
  const live: LiveEvent = {
    type: EFFECT_FIRED,
    at: clock.now(),
    payload: { effectKind: effect.kind, params: effect.params, receipt },
  };
  return getLiveFeed().publish(liveTopicOf(builderSlug), live);
};

/**
 * Broadcast one chat line on a builder's stream — the publish half of the chat
 * channel, twin of {@link announceEffectFired}. The `author` is already the public
 * label decided at the action edge (a channel name or a viewer pseudonym), so this
 * edge only stamps it now and fans it out; it makes no naming or authorization
 * decision of its own [LAW:decomposition]. Best-effort LIVE fan-out: the feed stores
 * nothing, so a watcher who connects later never sees this line, and that is the
 * channel's nature, not a dropped record [LAW:one-source-of-truth].
 */
export const announceChatMessage = (builderSlug: string, author: string, text: string): Promise<void> => {
  const live: LiveEvent = {
    type: CHAT_MESSAGE,
    at: clock.now(),
    payload: { author, text },
  };
  return getLiveFeed().publish(liveTopicOf(builderSlug), live);
};
