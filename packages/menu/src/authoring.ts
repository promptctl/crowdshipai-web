import type { Brand, CoinAmountError, BlankError, Result } from '@crowdship/std';
import { coinAmount, err, ok } from '@crowdship/std';

import { effectKind } from './effect.js';
import type { JsonValue } from './json.js';
import { offerId } from './offer.js';
import type { OfferId, PricedOffer } from './offer.js';

/**
 * One offer as a builder types it into their authoring surface, before any of it
 * is trusted: the id, price, and effect kind are still bare primitives that have
 * NOT passed their trust boundaries, and the effect params are already the open
 * `JsonValue` the platform never interprets. It is `PricedOffer`-shaped on
 * purpose — authoring's whole job is to brand the three raw fields and leave the
 * params untouched, so the draft and its authored result line up field for field
 * [LAW:types-are-the-program].
 */
export interface OfferDraft {
  readonly id: string;
  readonly price: bigint;
  readonly effect: { readonly kind: string; readonly params: JsonValue };
}

/**
 * What is wrong with one field of one drafted offer — each arm is one field's
 * trust boundary rejecting its raw input, carrying that boundary's own error so
 * the surface can say exactly what to fix [LAW:no-silent-failure]. The id and the
 * effect kind reject the same way (blank), the price rejects as non-positive; the
 * `field` tag is what tells a form which input to flag.
 */
export type OfferProblem =
  | { readonly field: 'id'; readonly error: BlankError }
  | { readonly field: 'price'; readonly error: CoinAmountError }
  | { readonly field: 'effect-kind'; readonly error: BlankError };

/**
 * Authoring failure is a SET of problems, never just the first one — every
 * invalid field is reported at once so a builder fixes the whole offer in one
 * pass instead of resubmitting to discover the next fault [LAW:no-silent-failure].
 * The list is non-empty by construction: an `err` is returned only when at least
 * one field failed, so "a failure with zero problems" is unrepresentable
 * [LAW:types-are-the-program]. New checks (o8q.5 guardrails) append arms here and
 * problems to this list without touching a single caller [LAW:carrying-cost].
 */
export type OfferProblems = readonly [OfferProblem, ...OfferProblem[]];

/**
 * Turn one untrusted draft into a valid `PricedOffer`, or report everything wrong
 * with it. Every field is validated on every call — the operations are
 * unconditional and the variability lives in which problems the list carries, not
 * in whether a check runs [LAW:dataflow-not-control-flow]. The per-field boundaries
 * (`offerId`, `coinAmount`, `effectKind`) are reused verbatim, never re-derived:
 * this part only composes them and collects their failures [LAW:single-enforcer].
 * `params` is carried through opaque — authoring never reads or branches on the
 * effect, so a kind the platform never anticipated authors exactly like a shoutout.
 */
export const authorOffer = (draft: OfferDraft): Result<PricedOffer, OfferProblems> => {
  const id = offerId(draft.id);
  const price = coinAmount(draft.price);
  const kind = effectKind(draft.effect.kind);

  const problems: OfferProblem[] = [];
  if (!id.ok) problems.push({ field: 'id', error: id.error });
  if (!price.ok) problems.push({ field: 'price', error: price.error });
  if (!kind.ok) problems.push({ field: 'effect-kind', error: kind.error });

  // When this is false, all three narrow to ok; when true, `problems` is non-empty
  // by exactly the same condition — the checked cast mints `OfferProblems` at the
  // one boundary that establishes its invariant, the same idiom `coinAmount` uses.
  if (!id.ok || !price.ok || !kind.ok) {
    return err(problems as unknown as OfferProblems);
  }
  return ok({ id: id.value, price: price.value, effect: { kind: kind.value, params: draft.effect.params } });
};

/**
 * A builder's whole menu: their offers in the order they arranged them, with each
 * id identifying exactly one offer. Constructed ONLY by `authorMenu`, so a menu
 * carrying a blank, mispriced, or duplicate id is unrepresentable
 * [LAW:types-are-the-program]. Plain serializable data behind a phantom brand — no
 * methods — so it crosses any seam unchanged and a consumer reads `offers`
 * directly. The "which builder owns this" association lives upstream where slugs
 * map to menus; a menu is just the offers [LAW:decomposition].
 */
export type Menu = Brand<{ readonly offers: readonly PricedOffer[] }, 'Menu'>;

/**
 * What is wrong with a drafted menu. Either a field in one offer rejected (located
 * by the offer's position, since the id may be the very thing that's blank), or
 * two or more offers claim the same id — a duplicate that would make `findOffer`
 * ambiguous and let a backer buy one offer and get another, a money-adjacent lie
 * the type forbids at construction [LAW:one-source-of-truth]. Duplicate detection
 * runs over the offers that authored cleanly, so a blank-id offer is an `offer`
 * problem, never a phantom duplicate.
 */
export type MenuProblem =
  | { readonly kind: 'offer'; readonly at: number; readonly problem: OfferProblem }
  | { readonly kind: 'duplicate-id'; readonly id: OfferId; readonly at: readonly number[] };

/** Non-empty for the same reason `OfferProblems` is: a menu failure always names
 * at least one fault [LAW:types-are-the-program]. */
export type MenuProblems = readonly [MenuProblem, ...MenuProblem[]];

/**
 * Author a builder's whole menu from their drafts, in order. Every draft is
 * authored — field faults are collected and located by position — and the
 * cleanly-authored offers are then checked for duplicate ids. A menu is minted
 * only when nothing is wrong; otherwise every fault across every offer is reported
 * at once [LAW:no-silent-failure]. An empty menu is valid: a builder with no
 * offers yet is a well-formed menu of none, not an error.
 */
export const authorMenu = (drafts: readonly OfferDraft[]): Result<Menu, MenuProblems> => {
  const problems: MenuProblem[] = [];
  const authored: { readonly offer: PricedOffer; readonly at: number }[] = [];
  drafts.forEach((draft, at) => {
    const result = authorOffer(draft);
    if (result.ok) {
      authored.push({ offer: result.value, at });
    } else {
      for (const problem of result.error) problems.push({ kind: 'offer', at, problem });
    }
  });

  // Only cleanly-authored offers carry an id, so a collision is found among them
  // alone — a blank-id offer is already an `offer` problem, never a phantom
  // duplicate. Positions accrue in draft order, so the builder sees which collide.
  const positionsById = new Map<OfferId, number[]>();
  for (const { offer, at } of authored) {
    const positions = positionsById.get(offer.id) ?? [];
    positions.push(at);
    positionsById.set(offer.id, positions);
  }
  for (const [id, at] of positionsById) {
    if (at.length > 1) problems.push({ kind: 'duplicate-id', id, at });
  }

  // The menu is minted only with zero problems: every draft authored AND no id
  // collides. The checked cast establishes the brand's invariant at this one site.
  if (problems.length > 0) return err(problems as unknown as MenuProblems);
  return ok({ offers: authored.map((entry) => entry.offer) } as unknown as Menu);
};

/**
 * Resolve the offer a backer chose by its id. Unique-by-construction ids mean the
 * scan returns the one match or nothing — absence is a real typed outcome the
 * caller handles, not a guard hiding a skipped step [LAW:no-defensive-null-guards].
 * A builder's menu is a handful of offers, so a linear find keeps `Menu` plain data
 * rather than trading serializability for an index it does not need [LAW:carrying-cost].
 */
export const findOffer = (menu: Menu, id: OfferId): PricedOffer | undefined =>
  menu.offers.find((offer) => offer.id === id);
