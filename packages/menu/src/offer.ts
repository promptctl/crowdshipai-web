import type { BlankError, Brand, CoinAmount, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

import type { Effect } from './effect.js';

/** Identity of a single offer on a builder's menu — opaque, builder-scoped. */
export type OfferId = Brand<string, 'OfferId'>;

/**
 * The whole substrate, in one type: a priced thing that fires an effect when a
 * backer buys it. There is no subclass per action and no `kind` discriminator —
 * a shoutout offer and a feature-bounty offer are the SAME type with different
 * values, because the variety lives in the values, never in the shape
 * [LAW:one-type-per-behavior]. This is the rail, not the shop: the platform
 * owns "priced thing fires effect"; the builder owns what the price and effect
 * actually are.
 *
 * Every field is a value that has already passed its own trust boundary — a
 * positive `CoinAmount`, a non-blank `OfferId`, an `Effect` with a non-blank
 * kind — so an offer is valid by construction and nothing downstream re-checks
 * it [LAW:types-are-the-program]. Performing the effect and posting the coins
 * are deliberately NOT here: the effect is carried as data and performed at the
 * edge (its own ticket), and purchase-to-fire wires it to the ledger (another).
 */
export interface PricedOffer {
  readonly id: OfferId;
  readonly price: CoinAmount;
  readonly effect: Effect;
}

/**
 * An offer id is a non-blank, verbatim key — taken exactly as given, since
 * normalization would silently change identity [LAW:no-silent-failure]. Same
 * one foundation mechanism as every other non-blank brand.
 */
export const offerId = (raw: string): Result<OfferId, BlankError> =>
  nonBlank<'OfferId'>('offerId', raw);
