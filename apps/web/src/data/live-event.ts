/**
 * The watch surface's side of the live event channel: the wire labels the stream
 * publishes under, and the parses of an SSE frame into the things this client build
 * renders — a fired effect, and a chat line. The serializable cross-network model, a
 * sibling of {@link import('./buy-result')} (a server action's reply) — all carry
 * only primitives across the boundary, never a service handle.
 *
 * It is LIVE, not history: a watcher receives only events published after it
 * connects, and the feed stores nothing. So nothing here reconciles against a
 * durable record — the ledger and settlement feed are that record, never this
 * channel [LAW:one-source-of-truth]. A missed frame is not a money error; the
 * purchase already committed and is recorded regardless of who was watching, and a
 * missed chat line is simply a line a late viewer never saw.
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
 * A fired effect as the watch surface renders it: the open effect kind the builder
 * authored (`shoutout`, `poll-vote`, `bounty-pool`, …), carried as data and shown
 * verbatim, never branched on [LAW:dataflow-not-control-flow]. `effectKind` is the
 * always-present, type-honest field of the live payload; the richer `params` stay
 * on the wire for a future overlay to read, but the chat line needs only the kind.
 */
export interface FiredEffect {
  readonly effectKind: string;
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

  return { effectKind: kind };
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
