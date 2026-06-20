import type { PricedOffer } from '@/data/types';

import { OfferCard } from './OfferCard';

/**
 * The builder's menu. Renders ANY priced offer the same way and never branches
 * on what the offer *is* [LAW:dataflow-not-control-flow] — the platform owns the
 * rail (a priced thing that fires), the builder owns the shop. New offer kinds
 * need zero code here.
 *
 * Pure presentational: it reports a spend intent upward and holds no state — the
 * wallet and the fired-effect log live with the one owner [LAW:effects-at-boundaries].
 */
export function Menu({
  offers,
  balance,
  onSpend,
}: {
  readonly offers: readonly PricedOffer[];
  readonly balance: number;
  readonly onSpend: (offer: PricedOffer) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-fog">menu</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent tabular-nums">
          ◎ {formatCoins(balance)}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        {offers.map((offer) => {
          const affordable = balance >= offer.priceCoins;
          return (
            <OfferCard
              key={offer.id}
              offer={offer}
              action={
                <button
                  type="button"
                  disabled={!affordable}
                  onClick={() => onSpend(offer)}
                  className="w-full rounded-sm border border-accent-dim bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-ink disabled:cursor-not-allowed disabled:border-edge disabled:bg-transparent disabled:text-fog"
                >
                  {affordable ? `spend ◎${offer.priceCoins}` : 'not enough coins'}
                </button>
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** A fixed locale so the server's render and the client's hydration agree —
 * Number.toLocaleString() defaults to the host locale, which differs between the
 * two and would tear hydration [LAW:no-ambient-temporal-coupling]. */
const formatCoins = (n: number): string => n.toLocaleString('en-US');
