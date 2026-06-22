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

// Authoring: the boundary that turns a builder's raw, untrusted drafts into a
// validated Menu — every field branded at its trust boundary, every fault reported
// at once, each id identifying exactly one offer. This is "the menu belongs to the
// builder" made into a type: they wire up, price, and arrange; we validate the rail.
export type {
  Menu,
  MenuProblem,
  MenuProblems,
  OfferDraft,
  OfferProblem,
  OfferProblems,
} from './authoring.js';
export { authorMenu, authorOffer, findOffer } from './authoring.js';

// Guardrails: limits that protect the rail without constraining the shop. The
// policy is a value `authorMenu` applies, so changing the bounds swaps the value,
// not the code; a new guardrail is one more field here plus one more
// `MenuProblem`/`OfferProblem` arm. The cap is a branded count minted at one boundary.
export type { MaxOffers, MaxOffersError, MenuPolicy } from './policy.js';
export { DEFAULT_MENU_POLICY, maxOffers } from './policy.js';

// The effect is carried as data; the edge performs it [LAW:effects-at-boundaries].
// The performer is one method that takes any effect — never one per kind — and a
// data-driven dispatcher composes it from per-kind handlers the builder registers.
export type { EffectHandler, EffectPerformer, EffectReceipt, PerformError } from './performer.js';
export { dispatchingPerformer } from './performer.js';

// The construction error every menu validator returns; its home is foundation,
// re-exported here so a consumer has the package's whole surface in one import.
export type { BlankError } from '@crowdship/std';
