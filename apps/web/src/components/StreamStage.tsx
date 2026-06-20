import { LiveBadge } from './LiveBadge';

/**
 * The placeholder for the video itself — the atomic primitive of the whole
 * product, standing in until real ingest/playback (the stream epic) lands behind
 * this same box. The builder's `accentHue` drives a per-channel gradient and a
 * faux editor frame so the grid reads as many distinct live builds, not one
 * template. `size` is a value the one component varies on, not a second
 * component [LAW:one-type-per-behavior].
 */
export function StreamStage({
  accentHue,
  isLive,
  viewerCount,
  size = 'card',
}: {
  readonly accentHue: number;
  readonly isLive: boolean;
  readonly viewerCount: number;
  readonly size?: 'card' | 'stage';
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
      <div className="absolute left-2.5 top-2.5">
        <LiveBadge isLive={isLive} viewerCount={viewerCount} />
      </div>
      {!isLive && (
        <div className="absolute inset-0 grid place-items-center bg-ink/55 text-xs text-fog">
          back later
        </div>
      )}
    </div>
  );
}

const FAKE_LINES = [62, 41, 78, 33, 55, 70, 28, 48];
