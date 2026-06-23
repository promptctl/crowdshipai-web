import Link from 'next/link';

import type { StreamSummary } from '@/data/types';

import { BuilderAvatar } from './BuilderAvatar';

/**
 * One candidate in the recruiter lens. Where {@link StreamCard} sells the show,
 * this reads as a resume line: the person first, the thing they are building as
 * their headline, and the stack they reach for. The whole card links to the
 * builder's channel — their full resume of stream, menu, and identity — because in
 * CrowdShip the stream is the resume; a recruiter reviews it by watching them think.
 */
export function TalentCard({ candidate }: { readonly candidate: StreamSummary }) {
  return (
    <Link
      href={`/c/${candidate.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4 transition-colors hover:border-accent-dim"
    >
      <div className="flex items-center gap-3">
        <BuilderAvatar accentHue={candidate.accentHue} className="h-10 w-10" />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-chalk group-hover:text-accent">
            {candidate.builderName}
          </h3>
          {/* Live is the whole pitch of the lens: a recruiter can watch this one think
              right now. Offline builders stay candidates — their channel is the resume. */}
          {candidate.isLive ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              live now — watch them think
            </span>
          ) : (
            <span className="text-[11px] text-fog">offline — review the channel</span>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-chalk/90">{candidate.title}</p>

      <div className="mt-auto flex flex-wrap gap-1">
        {candidate.tags.map((tag) => (
          <span key={tag} className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] text-fog">
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
