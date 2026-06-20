import type { PricedOffer } from '@/data/types';

/**
 * The builder's menu. Renders ANY priced offer the same way — label, price,
 * what-fires summary, a spend button — and never branches on `effect.kind`
 * [LAW:dataflow-not-control-flow]. That is the whole point: the platform owns
 * the rail (a priced thing that fires), the builder owns the shop (what the
 * thing is). New offer kinds need zero code here.
 *
 * Pure presentational: it reports a spend intent upward via `onSpend` and holds
 * no state — the wallet and the fired-effect log live with the one owner
 * [LAW:effects-at-boundaries].
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
          ◎ {balance.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        {offers.map((offer) => {
          const affordable = balance >= offer.priceCoins;
          return (
            <div key={offer.id} className="rounded-md border border-edge bg-surface-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-chalk">{offer.label}</h4>
                <span className="shrink-0 text-xs font-semibold text-accent tabular-nums">◎{offer.priceCoins}</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-fog">{offer.effect.summary}</p>
              <button
                type="button"
                disabled={!affordable}
                onClick={() => onSpend(offer)}
                className="mt-2.5 w-full rounded-sm border border-accent-dim bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-ink disabled:cursor-not-allowed disabled:border-edge disabled:bg-transparent disabled:text-fog"
              >
                {affordable ? `spend ◎${offer.priceCoins}` : 'not enough coins'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
