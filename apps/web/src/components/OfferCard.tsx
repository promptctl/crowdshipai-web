import type { PricedOffer } from '@/data/types';

/** One priced offer, rendered identically wherever a builder's menu appears, so
 * the watch surface and the channel page cannot drift apart [LAW:one-source-of-truth].
 * The optional `action` slot is the only thing that varies: the watch surface
 * passes a spend button, the read-only channel page passes nothing. */
export function OfferCard({ offer, action }: { readonly offer: PricedOffer; readonly action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-edge bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-chalk">{offer.label}</h4>
        <span className="shrink-0 text-xs font-semibold text-accent tabular-nums">◎{offer.priceCoins}</span>
      </div>
      <p className="mt-1 text-xs leading-snug text-fog">{offer.effect.summary}</p>
      {action !== undefined && <div className="mt-2.5">{action}</div>}
    </div>
  );
}
