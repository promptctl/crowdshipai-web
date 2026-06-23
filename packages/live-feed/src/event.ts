import type { Brand, BlankError, Result, Timestamp } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

import type { JsonValue } from './json.js';

/**
 * What KIND of live thing this is — an OPEN label, never a platform-closed enum.
 * "an effect fired", "a viewer joined", "a settlement released" — these are the
 * variety the product grows, not a union the feed enumerates and must extend for
 * every new thing that can appear on a stream [LAW:no-mode-explosion]. The feed
 * never branches on it; it carries it to the watcher, whose overlay gives it
 * meaning [LAW:dataflow-not-control-flow]. This is the exact stance `EffectKind`
 * and `TransactionReason` take — an open label, so a brand over a non-blank string.
 */
export type LiveEventType = Brand<string, 'LiveEventType'>;

/**
 * One thing that happened on a live feed, delivered to whoever is watching right
 * now. It carries its open kind, when it happened, and a builder-and-feature-shaped
 * `JsonValue` payload — everything a watcher's overlay needs and nothing the feed
 * itself reads. `at` is stamped by the publisher (which owns the clock), not the
 * feed [LAW:effects-at-boundaries]: the feed is a dumb pipe, the caller owns the
 * event's content. Every field is serializable so the whole event survives the
 * trip to a viewer's browser unchanged.
 */
export interface LiveEvent {
  readonly type: LiveEventType;
  readonly at: Timestamp;
  readonly payload: JsonValue;
}

/**
 * Mint an event type from a raw label at the one trust boundary where a string
 * becomes a type, blank rejected once [LAW:single-enforcer]. The non-blank-brand
 * behavior lives once in foundation; this is its `LiveEventType` instance.
 */
export const liveEventType = (raw: string): Result<LiveEventType, BlankError> =>
  nonBlank<'LiveEventType'>('liveEventType', raw);
