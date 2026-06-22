/**
 * The builder priced-offer substrate — the rail, not the shop. One `PricedOffer`
 * type whose variety lives entirely in its values, so a shoutout, a vote, and a
 * feature bounty are instances, never subtypes [LAW:one-type-per-behavior].
 */
export type { JsonValue } from './json.js';

export type { Effect, EffectKind } from './effect.js';
export { effectKind } from './effect.js';

export type { OfferId, PricedOffer } from './offer.js';
export { offerId } from './offer.js';

// The effect is carried as data; the edge performs it [LAW:effects-at-boundaries].
// The performer is one method that takes any effect — never one per kind — and a
// data-driven dispatcher composes it from per-kind handlers the builder registers.
export type { EffectHandler, EffectPerformer, EffectReceipt, PerformError } from './performer.js';
export { dispatchingPerformer } from './performer.js';

// The construction error every menu validator returns; its home is foundation,
// re-exported here so a consumer has the package's whole surface in one import.
export type { BlankError } from '@crowdship/std';
