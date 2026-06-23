'use client';

import { useState } from 'react';

import { surfaceTalent } from '@/data/talent';
import type { StreamSummary } from '@/data/types';

import { TalentCard } from './TalentCard';

/**
 * The recruiter's board. The active skill is local interactive state — the
 * recruiter pivots between crafts with no round-trip — so the lens runs right here
 * in the browser: {@link surfaceTalent} is pure and framework-free, recomputed each
 * render from the roster and the current pivot [LAW:dataflow-not-control-flow]. The
 * server hands down the roster once; all the recruiter's filtering is a value
 * flowing through that one pure function, never a branch in this component.
 */
export function TalentBoard({ roster }: { readonly roster: readonly StreamSummary[] }) {
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const view = surfaceTalent(roster, activeSkill);

  // Clicking the active skill clears it; clicking another switches to it. One pivot
  // at a time keeps the lens simple to read and cheap to extend to multi-select later.
  const pivot = (skill: string) => setActiveSkill((current) => (current === skill ? null : skill));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveSkill(null)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            activeSkill === null
              ? 'bg-accent text-ink'
              : 'bg-surface-2 text-fog hover:bg-edge hover:text-chalk'
          }`}
        >
          all crafts
        </button>
        {view.skills.map((facet) => (
          <button
            key={facet.skill}
            type="button"
            onClick={() => pivot(facet.skill)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activeSkill === facet.skill
                ? 'bg-accent text-ink'
                : 'bg-surface-2 text-fog hover:bg-edge hover:text-chalk'
            }`}
          >
            {facet.skill} <span className="opacity-60">{facet.count}</span>
          </button>
        ))}
      </div>

      {view.candidates.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface px-4 py-8 text-center text-sm text-fog">
          {activeSkill === null ? (
            'no builders to surface yet.'
          ) : (
            <>
              no one is building with <span className="font-semibold text-chalk">{activeSkill}</span> yet. pivot
              to another craft.
            </>
          )}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view.candidates.map((candidate) => (
            <TalentCard key={candidate.slug} candidate={candidate} />
          ))}
        </div>
      )}
    </div>
  );
}
