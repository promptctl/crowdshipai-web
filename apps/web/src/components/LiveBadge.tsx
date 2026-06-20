/** Compact viewer/live indicator. A single component renders both states; "live"
 * vs "offline" is a value it carries, not two separate components
 * [LAW:one-type-per-behavior]. */
export function LiveBadge({ isLive, viewerCount }: { readonly isLive: boolean; readonly viewerCount: number }) {
  if (!isLive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fog">
        offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-live/15 px-2 py-0.5 text-[11px] font-semibold text-live">
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
      LIVE
      <span className="tabular-nums text-chalk/80">{formatCount(viewerCount)}</span>
    </span>
  );
}

const formatCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
