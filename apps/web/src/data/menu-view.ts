import type { Menu } from '@crowdship/menu';

import { offerDisplayOf } from './offer-display';
import type { PricedOffer } from './types';

/**
 * Project a builder's authoritative domain {@link Menu} onto the view-model the watch
 * surface renders [LAW:decomposition]. The SAME stored menu feeds both this display
 * projection and the buy path's `purchasable` lookup, so the price a backer sees and
 * the price the ledger charges are read from one source and cannot drift
 * [LAW:one-source-of-truth]: `priceCoins` is the domain offer's branded `CoinAmount`
 * surfaced as a number, the same `price` `findOffer` returns to the purchase pipeline.
 *
 * The human label and summary come from the offer's params — the builder-authored
 * display payload {@link offerDisplayOf} reads — and the open effect `kind` is carried
 * verbatim, never branched on [LAW:dataflow-not-control-flow]. The operation is the
 * same for every offer; an empty menu maps to an empty list, not a special case.
 */
export const toMenuView = (menu: Menu): PricedOffer[] =>
  menu.offers.map((offer) => {
    const display = offerDisplayOf(offer.effect.params);
    return {
      id: offer.id,
      label: display.label,
      priceCoins: Number(offer.price),
      effect: { kind: offer.effect.kind, summary: display.summary },
    };
  });
