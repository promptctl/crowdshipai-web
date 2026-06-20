import Link from 'next/link';

import type { StreamSummary } from '@/data/types';

import { StreamStage } from './StreamStage';

/** One tile in the browse grid. Links into the channel's watch surface. */
export function StreamCard({ stream }: { readonly stream: StreamSummary }) {
  return (
    <Link
      href={`/watch/${stream.slug}`}
      className="group block rounded-lg transition-transform duration-150 hover:-translate-y-0.5"
    >
      <StreamStage accentHue={stream.accentHue} isLive={stream.isLive} viewerCount={stream.viewerCount} />
      <div className="mt-2.5 flex gap-3">
        <span
          className="mt-0.5 h-9 w-9 shrink-0 rounded-full"
          style={{ background: `hsl(${stream.accentHue} 60% 45%)` }}
          aria-hidden
        />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-chalk group-hover:text-accent">{stream.title}</h3>
          <p className="text-xs text-fog">{stream.builderName}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {stream.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] text-fog">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
