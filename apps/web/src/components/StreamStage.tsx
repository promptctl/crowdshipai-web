import type { ReactNode } from 'react';

import { LiveBadge } from './LiveBadge';

/**
 * The placeholder for the video itself — the atomic primitive of the whole
 * product. On the browse grid it stands alone (a per-channel gradient + faux
 * editor frame so the grid reads as many distinct live builds, not one template);
 * on the watch surface the real player binds behind this SAME box via `overlay`,
 * so the placeholder was always the seam the live video layers over and nothing
 * else on the surface moves [LAW:locality-or-seam]. `size` and `overlay` are
 * values the one component varies on, not second components [LAW:one-type-per-behavior].
 *
 * Layering, painted back-to-front: the faux editor and the "back later" curtain
 * sit at the base; `overlay` (the live `<video>`) covers them when it carries a
 * track and reveals them when it does not; the live badge paints last, always on
 * top of the video. An absent `overlay` is the honest grid case — no live layer at
 * all — not a guard [LAW:no-defensive-null-guards].
 */
export function StreamStage({
  accentHue,
  isLive,
  viewerCount,
  size = 'card',
  overlay,
}: {
  readonly accentHue: number;
  readonly isLive: boolean;
  readonly viewerCount: number;
  readonly size?: 'card' | 'stage';
  /** The live video layer to bind behind this box on the watch surface; absent on
   *  the grid, where the placeholder stands alone. */
  readonly overlay?: ReactNode;
}) {
  const isStage = size === 'stage';
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-edge"
      style={{
        aspectRatio: '16 / 9',
        background: `radial-gradient(120% 120% at 18% 0%, hsl(${accentHue} 70% 22% / 0.55), var(--color-surface) 60%)`,
      }}
    >
      {/* faux code shimmer so the tile reads as "someone is building right now" */}
      <div className="absolute inset-0 flex flex-col gap-1.5 p-4 opacity-40" aria-hidden>
        {FAKE_LINES.slice(0, isStage ? FAKE_LINES.length : 5).map((w, i) => (
          <div
            key={i}
            className="h-2 rounded-full"
            style={{ width: `${w}%`, background: `hsl(${accentHue} 60% ${isStage ? 55 : 45}% / 0.5)` }}
          />
        ))}
      </div>
      {!isLive && (
        <div className="absolute inset-0 grid place-items-center bg-ink/55 text-xs text-fog">
          back later
        </div>
      )}
      {overlay}
      <div className="absolute left-2.5 top-2.5">
        <LiveBadge isLive={isLive} viewerCount={viewerCount} />
      </div>
    </div>
  );
}

const FAKE_LINES = [62, 41, 78, 33, 55, 70, 28, 48];
