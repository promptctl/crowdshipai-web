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

import {
  CHAT_MESSAGE_EVENT,
  EFFECT_FIRED_EVENT,
  PRESENCE_EVENT,
  SETTLEMENT_EVENT,
  type SettlementMoment,
} from '../data/live-event';

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

/** Mint the open `LiveEventType` an announcer publishes under, from the SAME wire
 *  label the watch surface parses on, so publish and consume cannot drift to different
 *  spellings [LAW:one-source-of-truth]. The label is a non-blank literal known at
 *  module load, so a blank is a broken invariant that halts loudly rather than minting
 *  a blank type [LAW:no-silent-failure] — and the check lives in exactly one place for
 *  every event kind the spine grows [LAW:single-enforcer]. */
const mintEventType = (label: string): LiveEventType => {
  const t = liveEventType(label);
  if (!t.ok) throw new Error(`live-feed: minted a blank live event type from ${JSON.stringify(label)}`);
  return t.value;
};

// The open labels each announcer below publishes under — fired effects, chat lines,
// the live viewer count, and settlement moments, every kind riding the one feed
// [LAW:no-mode-explosion].
const EFFECT_FIRED: LiveEventType = mintEventType(EFFECT_FIRED_EVENT);
const CHAT_MESSAGE: LiveEventType = mintEventType(CHAT_MESSAGE_EVENT);
const PRESENCE: LiveEventType = mintEventType(PRESENCE_EVENT);
const SETTLEMENT: LiveEventType = mintEventType(SETTLEMENT_EVENT);

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

/**
 * Surface the live viewer count on a builder's stream — the publish half of presence,
 * twin of {@link announceEffectFired}. The `count` is ALREADY derived by the presence
 * registry (the authoritative occupancy); this edge only carries that number to every
 * watcher, it never tallies anything itself [LAW:decomposition]. The caller reads the
 * count from the registry and hands it here whole, so the frame carries the truth
 * rather than a +1/-1 delta a watcher would have to accumulate — the count's authority
 * stays in the registry, the feed only echoes it [LAW:one-source-of-truth]. Best-effort
 * LIVE fan-out: a missed frame leaves a watcher a beat stale until the next presence
 * change re-announces the count, never wrong forever, because the next frame is again
 * the whole truth.
 */
export const announcePresence = (builderSlug: string, count: number): Promise<void> => {
  const live: LiveEvent = {
    type: PRESENCE,
    at: clock.now(),
    payload: { count },
  };
  return getLiveFeed().publish(liveTopicOf(builderSlug), live);
};

/**
 * Announce a settlement moment on a builder's stream — the money moving in view of the
 * audience, the publish half of the settlement→stream seam and the twin of
 * {@link announceEffectFired}. The frame is a NUDGE plus the one line worth saying the
 * instant a pool ships: the durable money story stays the ledger's, and every watcher
 * re-reads the settlement-feed projection on receipt, so a missed or replayed frame
 * can never make the audience's view of the money wrong — only a beat stale
 * [LAW:one-source-of-truth]. The `shipped` figures ride the frame verbatim from the
 * ledger's recorded release and cut legs; this edge derives nothing.
 */
export const announceSettlement = (builderSlug: string, moment: SettlementMoment): Promise<void> => {
  const live: LiveEvent = {
    type: SETTLEMENT,
    at: clock.now(),
    payload: moment.shipped === undefined ? { poolTitle: moment.poolTitle } : { poolTitle: moment.poolTitle, shipped: moment.shipped },
  };
  return getLiveFeed().publish(liveTopicOf(builderSlug), live);
};
