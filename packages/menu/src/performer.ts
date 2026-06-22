import type { Result } from '@crowdship/std';
import { err } from '@crowdship/std';

import type { Effect, EffectKind } from './effect.js';
import type { JsonValue } from './json.js';

/**
 * What performing an effect yields — an open, builder-shaped receipt carried as
 * data exactly like an effect's `params`. The platform never reads it; the edge
 * that performed the effect produces it and whoever asked for the effect (the
 * purchase pipeline, the overlay) consumes it. Open for the same reason `params`
 * is open: the variety comes from builders, not our roadmap
 * [LAW:types-are-the-program].
 */
export type EffectReceipt = JsonValue;

/**
 * Why performing an effect failed — a closed union the caller destructures,
 * never thrown [LAW:dataflow-not-control-flow]. Its two arms are two genuinely
 * different failures with two different owners:
 *
 * - `unknown-effect-kind` is the rail's own failure: nothing at the edge is
 *   registered to perform this kind. Platform-closed because only the platform's
 *   dispatch can raise it, and LOUD — never a silent no-op for an effect a
 *   backer paid for [LAW:no-silent-failure].
 * - `handler-error` is the edge's failure: a handler ran and could not finish
 *   (the overlay was down, a call failed). Its `detail` is builder/edge-shaped
 *   `JsonValue`, as open as the handler that produced it.
 */
export type PerformError =
  | { readonly kind: 'unknown-effect-kind'; readonly effectKind: EffectKind }
  | { readonly kind: 'handler-error'; readonly effectKind: EffectKind; readonly detail: JsonValue };

/**
 * The edge boundary that turns an effect description into something that happens
 * in the world [LAW:effects-at-boundaries]. ONE method that takes the whole
 * `Effect` and performs it — never one method per kind, which would be the
 * dropdown of allowed actions the founding document forbids. The performer is
 * the only place the world is touched; everything upstream stays pure and the
 * `Effect` it consumes is the same data the rail carried, never reshaped
 * [LAW:one-source-of-truth].
 */
export interface EffectPerformer {
  perform(effect: Effect): Promise<Result<EffectReceipt, PerformError>>;
}

/**
 * One kind's behavior at the edge, authored by the builder/app and registered by
 * kind. It receives the whole effect (so it can read `params`) and reports a
 * receipt or an open failure detail. It never sees other kinds and never has to
 * know how dispatch found it, so it composes in isolation [LAW:decomposition].
 */
export type EffectHandler = (effect: Effect) => Promise<Result<EffectReceipt, JsonValue>>;

/**
 * Compose a performer from a registry of per-kind handlers. The rail carries
 * `kind` to a Map lookup and never branches on its value
 * [LAW:dataflow-not-control-flow] — so a builder's brand-new kind is one map
 * entry and zero platform code, which is the whole point of an open `EffectKind`
 * [LAW:no-mode-explosion]. A kind with no registered handler is a loud, typed
 * failure, never a swallowed no-op [LAW:no-silent-failure].
 */
export const dispatchingPerformer = (
  handlers: ReadonlyMap<EffectKind, EffectHandler>,
): EffectPerformer => ({
  async perform(effect) {
    // `Map.get` returns the optionality directly; absence is a real, typed
    // outcome here, not a guard hiding a skipped step [LAW:no-defensive-null-guards].
    const handler = handlers.get(effect.kind);
    if (handler === undefined) {
      return err({ kind: 'unknown-effect-kind', effectKind: effect.kind });
    }
    const outcome = await handler(effect);
    return outcome.ok
      ? outcome
      : err({ kind: 'handler-error', effectKind: effect.kind, detail: outcome.error });
  },
});
