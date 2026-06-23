import type { StreamSummary } from './types';

/**
 * The recruiter lens, as a pure projection (discovery-41w.5). The third side of
 * the market: a recruiter trolls the streams for talent, and "the stream is the
 * resume — you get to watch someone think." This module holds the WHOLE meaning of
 * that lens as one deterministic function over the existing roster; the route and
 * the board component that render it are thin edges with nothing to decide
 * [LAW:effects-at-boundaries].
 *
 * It invents no new data. A recruiter's signal is already in {@link StreamSummary}:
 * who the builder is, what they are building (`title`), the stack they reach for
 * (`tags`), and whether they are live to be watched thinking right now. The lens is
 * a different VIEW of the same candidates — organized by craft, ordered for hiring —
 * not a new source of truth [LAW:one-source-of-truth] [LAW:carrying-cost].
 */

/** One skill the recruiter can pivot the board on, with how many candidates list
 *  it — a tag drawn straight from builders' own words, never a closed taxonomy we
 *  own [LAW:one-type-per-behavior]. The variety is the builders'. */
export interface SkillFacet {
  readonly skill: string;
  readonly count: number;
}

/**
 * The recruiter's view of the roster: the skill rail to pivot on, and the
 * candidates ordered for hiring. `activeSkill` is the lens currently applied —
 * `null` when the recruiter is surveying everyone, a tag when they have narrowed to
 * one craft — carried in the view so the board renders it without re-deriving
 * [LAW:dataflow-not-control-flow].
 */
export interface TalentView {
  readonly skills: readonly SkillFacet[];
  readonly candidates: readonly StreamSummary[];
  readonly activeSkill: string | null;
}

/** Order candidates the way a recruiter reads them: those live NOW first, because
 *  the whole pitch is watching someone think in real time; then by audience as an
 *  engagement proxy; then by name so the order is stable and never flickers between
 *  reads [LAW:no-ambient-temporal-coupling]. A total order — every tiebreak resolved. */
const forRecruiter = (a: StreamSummary, b: StreamSummary): number =>
  Number(b.isLive) - Number(a.isLive) ||
  b.viewerCount - a.viewerCount ||
  a.builderName.localeCompare(b.builderName);

/** The skill rail, derived from the FULL roster so it stays stable as the recruiter
 *  filters — counting how many candidates list each tag, most-common craft first,
 *  ties broken alphabetically for a deterministic rail. */
const skillFacets = (roster: readonly StreamSummary[]): readonly SkillFacet[] => {
  const counts = new Map<string, number>();
  for (const candidate of roster) {
    for (const tag of candidate.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([skill, count]): SkillFacet => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
};

/**
 * Project the roster through the recruiter lens. The skill rail is always the full
 * set of crafts on the platform; the candidate list is every builder when
 * `activeSkill` is null, or only those who list that craft when it is set. A skill
 * no candidate lists yields an empty candidate list, never an error — an honest
 * "no one here works in that" the board can show [LAW:no-silent-failure].
 *
 * Pure and total: the same roster and lens always yield the same view, with no read
 * of clock, network, or ambient state — so the recruiter's point of view is a
 * tested contract, not behavior hidden in a component.
 */
export const surfaceTalent = (
  roster: readonly StreamSummary[],
  activeSkill: string | null,
): TalentView => {
  const matched = activeSkill === null ? roster : roster.filter((c) => c.tags.includes(activeSkill));
  return {
    skills: skillFacets(roster),
    candidates: [...matched].sort(forRecruiter),
    activeSkill,
  };
};
