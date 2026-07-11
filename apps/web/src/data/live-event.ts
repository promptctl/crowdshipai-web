import { offerDisplayIn, type OfferDisplay } from './offer-display';
import { overlayStyleFrom, type OverlayStyle } from './overlay-style';

/**
 * The watch surface's side of the live event channel: the wire labels the stream
 * publishes under, and the parses of an SSE frame into the things this client build
 * renders — a fired effect, a chat line, and the live viewer count. The serializable
 * cross-network model, a sibling of {@link import('./buy-result')} (a server action's
 * reply) — all carry only primitives across the boundary, never a service handle.
 *
 * It is LIVE, not history: a watcher receives only events published after it
 * connects, and the feed stores nothing. So nothing here reconciles against a
 * durable record — the ledger and settlement feed are that record, never this
 * channel [LAW:one-source-of-truth]. A missed frame is not a money error; the
 * purchase already committed and is recorded regardless of who was watching, and a
 * missed chat line is simply a line a late viewer never saw. The viewer count is the
 * one frame the late viewer does NOT lose to this looseness: each frame carries the
 * already-derived count in full (not a +1/-1 delta), so the next presence frame
 * re-establishes the truth — the count's authority lives in the presence registry,
 * never in this feed [LAW:one-source-of-truth].
 */

/**
 * The open event-type label a fired-effect live event carries on the wire — the
 * single source of truth both the publish edge (`server/live-feed.ts`, which mints
 * the `LiveEventType` from this string) and this consume edge agree on, so the two
 * halves cannot drift to different spellings [LAW:one-source-of-truth]. It is one
 * value of an OPEN label space the feed grows (presence, chat, settlement join the
 * same spine), never a closed enum this client owns [LAW:no-mode-explosion].
 */
export const EFFECT_FIRED_EVENT = 'effect-fired';

/**
 * The open event-type label a chat line carries on the wire — chat joining the same
 * spine as fired effects, one more value flowing through the one `LiveFeed`, not a
 * second real-time channel [LAW:no-mode-explosion]. Minted into a `LiveEventType` by
 * the publish edge from this very string, so publish and consume cannot drift apart
 * [LAW:one-source-of-truth], exactly as {@link EFFECT_FIRED_EVENT} is.
 */
export const CHAT_MESSAGE_EVENT = 'chat-message';

/**
 * The open event-type label a live viewer count carries on the wire — presence
 * joining the same spine as fired effects and chat, one more value flowing through
 * the one `LiveFeed`, never a second real-time channel [LAW:no-mode-explosion].
 * Minted into a `LiveEventType` by the publish edge from this very string, so publish
 * and consume cannot drift apart [LAW:one-source-of-truth]. The frame carries the
 * count the presence registry has ALREADY derived — the feed surfaces the number, it
 * is never the tally.
 */
export const PRESENCE_EVENT = 'presence-count';

/**
 * The open event-type label a settlement moment carries on the wire — settlement joining
 * the same spine as fired effects, chat, and presence, one more value through the one
 * `LiveFeed`, never a second real-time channel [LAW:no-mode-explosion]. Minted into a
 * `LiveEventType` by the publish edge from this very string, so publish and consume
 * cannot drift apart [LAW:one-source-of-truth]. The frame is a NUDGE, not the record:
 * the durable money story is the ledger's, re-read through the settlement-feed
 * projection on every nudge, so a missed frame leaves a watcher a beat stale until the
 * next nudge or reload — never wrong [LAW:one-source-of-truth].
 */
export const SETTLEMENT_EVENT = 'settlement';

/**
 * The open event-type label a stream-lifecycle moment carries on the wire — the
 * builder's go-live and end joining the same spine as effects, chat, presence, and
 * settlement, one more value through the one `LiveFeed`, never a second real-time
 * channel [LAW:no-mode-explosion]. Minted into a `LiveEventType` by the publish edge
 * from this very string, so publish and consume cannot drift apart
 * [LAW:one-source-of-truth]. The frame is a NUDGE, not the authority: liveness truth
 * stays the ingest broker's room state, read server-side at every page render — this
 * frame only lets a watcher already on the page see the badge flip the moment it
 * happens instead of at their next reload [LAW:one-source-of-truth].
 */
export const STREAM_LIFECYCLE_EVENT = 'stream-lifecycle';

/**
 * The open event-type label a builder's overlay restyle carries on the wire — the
 * overlay joining the same spine as effects, chat, presence, settlement, and
 * lifecycle, one more value through the one `LiveFeed`, never a second real-time
 * channel [LAW:no-mode-explosion]. Minted into a `LiveEventType` by the publish edge
 * from this very string, so publish and consume cannot drift apart
 * [LAW:one-source-of-truth]. The frame carries the authored style WHOLE (presence's
 * shape: each frame is again the full truth, so a missed one leaves a watcher a beat
 * stale, never accumulating drift) — but the style's authority is the overlay store
 * the watch surface re-reads on every subscription (re)open, never this feed
 * [LAW:one-source-of-truth].
 */
export const OVERLAY_STYLE_EVENT = 'overlay-style';

/**
 * A fired effect as the watch surface renders it: the open effect kind the builder
 * authored (`shoutout`, `poll-vote`, `bounty-pool`, …), carried as data and shown
 * verbatim, never branched on [LAW:dataflow-not-control-flow]. `effectKind` is the
 * always-present, type-honest field of the live payload. `display` is the builder's
 * own words for the offer, read from the wire's open `params` when they carry the
 * CrowdShip display shape — honest optionality, not a guard: an effect fired from a
 * foreign params shape is still a fired effect, it just brings no display text and
 * the overlay shows its kind instead [LAW:dataflow-not-control-flow].
 */
export interface FiredEffect {
  readonly effectKind: string;
  readonly display?: OfferDisplay;
}

/**
 * A chat line as it arrives off the wire: the public author the line was broadcast
 * under (decided once at the publish edge, the same for every watcher) and the text.
 * Both are always present and non-empty by the parse below — a line with no author
 * or no text is not a chat line [LAW:dataflow-not-control-flow].
 */
export interface ChatLine {
  readonly author: string;
  readonly text: string;
}

/**
 * The live viewer count as it arrives off the wire: how many people are watching this
 * build right now, derived at the publish edge from the presence registry and carried
 * here whole. A non-negative integer always — a fractional, negative, or NaN count is
 * not a viewer count [LAW:dataflow-not-control-flow], so the parse below rejects it to
 * `null` rather than rendering a number that cannot be a number of people.
 */
export interface ViewerPresence {
  readonly count: number;
}

/**
 * A settlement moment as it arrives off the wire: which pool's money moved (so the
 * watcher re-reads that channel's settlement feed — the frame nudges, the ledger
 * answers [LAW:one-source-of-truth]), and, when the movement SETTLED the pool, the one
 * broadcast line the audience sees the instant it happens. A pool settles exactly one
 * way — FORWARD to the builder (`shipped`, carrying the recorded release and cut legs)
 * or BACK to its backers (`refunded`, carrying the recorded total returned) — so the
 * two are one discriminated arm, never two optional blocks whose illegal both-present
 * frame would be representable [LAW:types-are-the-program]. `settled` itself is honest
 * optionality [LAW:dataflow-not-control-flow]: a contribution nudges the feed but
 * settles nothing, so it carries no arm. Every figure is a real ledger leg carried
 * whole; this frame derives nothing.
 */
export type SettledMoment =
  | { readonly kind: 'shipped'; readonly releasedCoins: number; readonly cutCoins: number }
  | { readonly kind: 'refunded'; readonly refundedCoins: number };

export interface SettlementMoment {
  readonly poolTitle: string;
  readonly settled?: SettledMoment;
}

/**
 * A stream-lifecycle moment as it arrives off the wire: the builder's session either
 * just went live or just ended. Exactly two values, a closed union rather than a
 * boolean — the wire says which TRANSITION happened, and a phase this build does not
 * know is a frame it does not claim, never a coerced true/false
 * [LAW:types-are-the-program].
 */
export interface StreamLifecycleMoment {
  readonly phase: 'live' | 'ended';
}

/** A record we can index after proving the parsed value is a non-null object. */
type Frame = { readonly [key: string]: unknown };

const isObject = (v: unknown): v is Frame => typeof v === 'object' && v !== null;

/**
 * Decode one raw SSE `data:` frame into its `type` label and `payload`, or `null`
 * when the bytes are not even a JSON object. The single home of the wire's outer
 * shape, so every event parser below reads the trust boundary the same way and a
 * garbled frame fails to `null` in exactly one place [LAW:single-enforcer]. The
 * `type`/`payload` it surrenders are still `unknown` — each parser proves its own
 * payload shape.
 */
const decodeFrame = (raw: string): { readonly type: unknown; readonly payload: unknown } | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed frame from the wire is "not an event", not a crash of our code.
    return null;
  }
  if (!isObject(parsed)) return null;
  return { type: parsed.type, payload: parsed.payload };
};

/**
 * Parse one raw SSE `data:` frame into a {@link FiredEffect}, or `null` when the
 * frame is not one. The SSE wire is a trust boundary (network input), so a garbled
 * frame, a future event type this build does not render, or a payload missing its
 * kind all resolve to `null` — honest optionality the caller handles, NOT a
 * swallowed failure of our own code [LAW:no-silent-failure]: there is genuinely no
 * fired effect to show, so there is nothing to fail loudly about.
 */
export function parseFiredEffect(raw: string): FiredEffect | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== EFFECT_FIRED_EVENT) return null;
  if (!isObject(frame.payload)) return null;

  const kind = frame.payload.effectKind;
  if (typeof kind !== 'string' || kind.length === 0) return null;

  // The builder's words, when the open params carry the CrowdShip display shape —
  // judged by the one reader that owns that shape [LAW:single-enforcer]. A foreign
  // shape is an effect with no display text, not a rejected frame.
  const display = offerDisplayIn(frame.payload.params);
  return display === null ? { effectKind: kind } : { effectKind: kind, display };
}

/**
 * Parse one raw SSE `data:` frame into a {@link ChatLine}, or `null` when the frame
 * is not one — the sibling of {@link parseFiredEffect}, reading the same wire trust
 * boundary the same way. A fired-effect frame, a future event type, or a payload
 * missing its author or text all resolve to `null`: not this build's chat line,
 * never a swallowed error [LAW:no-silent-failure]. The author and text are both
 * required and non-blank because a line the audience could not attribute or could
 * not read is not a line worth showing.
 */
export function parseChatMessage(raw: string): ChatLine | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== CHAT_MESSAGE_EVENT) return null;
  if (!isObject(frame.payload)) return null;

  const { author, text } = frame.payload;
  if (typeof author !== 'string' || author.length === 0) return null;
  if (typeof text !== 'string' || text.length === 0) return null;

  return { author, text };
}

/**
 * Parse one raw SSE `data:` frame into a {@link ViewerPresence}, or `null` when the
 * frame is not one — the sibling of {@link parseFiredEffect} and {@link parseChatMessage},
 * reading the same wire trust boundary the same way. A fired-effect or chat frame, a
 * future event type, or a payload whose count is not a non-negative integer all
 * resolve to `null`: not this build's viewer count, never a swallowed error
 * [LAW:no-silent-failure]. The count must be a whole, non-negative number because a
 * count of people is exactly that — anything else off the wire is a garbled frame, not
 * a smaller or larger audience.
 */
export function parseViewerPresence(raw: string): ViewerPresence | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== PRESENCE_EVENT) return null;
  if (!isObject(frame.payload)) return null;

  const { count } = frame.payload;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;

  return { count };
}

/** A positive whole coin figure off the wire, or null — a released share, a cut, or a
 *  refunded total is always at least one coin (the engines never post a zero leg), so
 *  anything else in a settled frame is a garbled frame, not a smaller settlement. */
const parseCoinFigure = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

/** The settled arm of a settlement frame, proven from `unknown` — one place decides
 *  which discriminants exist on this wire, exhaustively [LAW:single-enforcer]. A block
 *  with an unknown kind or a non-coin figure is a garbled frame, resolved to `null`. */
const parseSettledMoment = (settled: unknown): SettledMoment | null => {
  if (!isObject(settled)) return null;
  if (settled.kind === 'shipped') {
    const releasedCoins = parseCoinFigure(settled.releasedCoins);
    const cutCoins = parseCoinFigure(settled.cutCoins);
    if (releasedCoins === null || cutCoins === null) return null;
    return { kind: 'shipped', releasedCoins, cutCoins };
  }
  if (settled.kind === 'refunded') {
    const refundedCoins = parseCoinFigure(settled.refundedCoins);
    if (refundedCoins === null) return null;
    return { kind: 'refunded', refundedCoins };
  }
  return null;
};

/**
 * Parse one raw SSE `data:` frame into a {@link SettlementMoment}, or `null` when the
 * frame is not one — the sibling of the parsers above, reading the same wire trust
 * boundary the same way. A frame of another type, a payload missing its pool title, or
 * a `settled` block that is not a well-formed shipped/refunded arm all resolve to
 * `null`: not this build's settlement moment, never a swallowed error
 * [LAW:no-silent-failure]. A well-formed frame WITHOUT `settled` is a real moment — a
 * contribution nudging the watcher to re-read the durable feed.
 */
export function parseSettlement(raw: string): SettlementMoment | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== SETTLEMENT_EVENT) return null;
  if (!isObject(frame.payload)) return null;

  const { poolTitle, settled } = frame.payload;
  if (typeof poolTitle !== 'string' || poolTitle.length === 0) return null;
  if (settled === undefined) return { poolTitle };

  const moment = parseSettledMoment(settled);
  if (moment === null) return null;
  return { poolTitle, settled: moment };
}

/**
 * Parse one raw SSE `data:` frame into a {@link StreamLifecycleMoment}, or `null` when
 * the frame is not one — the sibling of the parsers above, reading the same wire trust
 * boundary the same way. A frame of another type, or a payload whose phase is not one
 * of the two transitions this build renders, resolves to `null`: not this build's
 * lifecycle moment, never a swallowed error [LAW:no-silent-failure].
 */
export function parseStreamLifecycle(raw: string): StreamLifecycleMoment | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== STREAM_LIFECYCLE_EVENT) return null;
  if (!isObject(frame.payload)) return null;

  const { phase } = frame.payload;
  if (phase !== 'live' && phase !== 'ended') return null;

  return { phase };
}

/**
 * Parse one raw SSE `data:` frame into the builder's restyled {@link OverlayStyle},
 * or `null` when the frame is not one — the sibling of the parsers above, reading the
 * same wire trust boundary the same way. The payload's legality is judged by the ONE
 * style validator every boundary shares — the same line the authoring edge and the
 * durable store draw — so the wire cannot admit a style the app would refuse to
 * author [LAW:single-enforcer]. A frame of another type or an out-of-bounds style
 * resolves to `null`: not this build's overlay style, never a swallowed error
 * [LAW:no-silent-failure].
 */
export function parseOverlayStyle(raw: string): OverlayStyle | null {
  const frame = decodeFrame(raw);
  if (frame === null || frame.type !== OVERLAY_STYLE_EVENT) return null;
  return overlayStyleFrom(frame.payload);
}
