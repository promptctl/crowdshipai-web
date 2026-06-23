/**
 * The watch surface's side of the live event channel: the wire label the stream
 * publishes under, and the parse of an SSE frame into the one thing this client
 * build renders — a fired effect. The serializable cross-network model, a sibling
 * of {@link import('./buy-result')} (a server action's reply) — both carry only
 * primitives across the boundary, never a service handle.
 *
 * It is LIVE, not history: a watcher receives only events published after it
 * connects, and the feed stores nothing. So nothing here reconciles against a
 * durable record — the ledger and settlement feed are that record, never this
 * channel [LAW:one-source-of-truth]. A missed frame is not a money error; the
 * purchase already committed and is recorded regardless of who was watching.
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
 * A fired effect as the watch surface renders it: the open effect kind the builder
 * authored (`shoutout`, `poll-vote`, `bounty-pool`, …), carried as data and shown
 * verbatim, never branched on [LAW:dataflow-not-control-flow]. `effectKind` is the
 * always-present, type-honest field of the live payload; the richer `params` stay
 * on the wire for a future overlay to read, but the chat line needs only the kind.
 */
export interface FiredEffect {
  readonly effectKind: string;
}

/** A record we can index after proving the parsed value is a non-null object. */
type Frame = { readonly [key: string]: unknown };

const isObject = (v: unknown): v is Frame => typeof v === 'object' && v !== null;

/**
 * Parse one raw SSE `data:` frame into a {@link FiredEffect}, or `null` when the
 * frame is not one. The SSE wire is a trust boundary (network input), so a garbled
 * frame, a future event type this build does not render, or a payload missing its
 * kind all resolve to `null` — honest optionality the caller handles, NOT a
 * swallowed failure of our own code [LAW:no-silent-failure]: there is genuinely no
 * fired effect to show, so there is nothing to fail loudly about.
 */
export function parseFiredEffect(raw: string): FiredEffect | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed frame from the wire is "not an event", not a crash of our code.
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.type !== EFFECT_FIRED_EVENT) return null;

  const payload = parsed.payload;
  if (!isObject(payload)) return null;

  const kind = payload.effectKind;
  if (typeof kind !== 'string' || kind.length === 0) return null;

  return { effectKind: kind };
}
