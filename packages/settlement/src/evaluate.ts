import type { CoinAmount } from '@crowdship/std';

import type { DeliverableAccepted, GoalResolved, PoolTargetReached } from './condition.js';

/**
 * Evaluating a condition is a pure predicate over observed facts — "is this met?" — kept
 * apart from the engine that gathers the facts [LAW:effects-at-boundaries]. The engine
 * touches the world (queries the pool balance, reads an acceptance) at its boundary; the
 * judgment here only compares values and so is total, deterministic, and testable in
 * isolation.
 *
 * The criterion (a `Condition`, authored once and stored in the pledge) and the live reading
 * are paired into ONE value per kind, so a pool target can never be judged by a goal's
 * resolution — the mismatched pairing is not a runtime guard but a value that cannot be
 * built [LAW:types-are-the-program]. Each arm EXTENDS its condition, so the kind labels are
 * defined once, in `condition.ts`, and cannot drift [LAW:one-source-of-truth].
 */
export interface PoolObservation extends PoolTargetReached {
  /** Coins pooled against the obligation as of this reading. */
  readonly pooled: CoinAmount;
}

export interface DeliverableObservation extends DeliverableAccepted {
  readonly accepted: boolean;
}

export interface GoalObservation extends GoalResolved {
  readonly resolved: boolean;
}

export type Observation = PoolObservation | DeliverableObservation | GoalObservation;

/** Pair a pool-target criterion with the coins observed pooled against it. Each constructor
 *  ties one criterion to the one reading it can be judged by, so a goal's resolution handed
 *  to a pool target does not typecheck — the engine gets the cross-kind mismatch caught for
 *  free where it already branches per kind to observe. */
export const observePool = (condition: PoolTargetReached, pooled: CoinAmount): PoolObservation => ({
  ...condition,
  pooled,
});

export const observeDeliverable = (
  condition: DeliverableAccepted,
  accepted: boolean,
): DeliverableObservation => ({ ...condition, accepted });

export const observeGoal = (condition: GoalResolved, resolved: boolean): GoalObservation => ({
  ...condition,
  resolved,
});

/**
 * The predicate: has this condition been met by what was observed? Exhaustive over the
 * closed union with no `default` arm — a new condition kind makes this stop compiling until
 * its fact is judged, so the platform can never silently treat an unjudged condition as
 * unmet [LAW:no-silent-failure]. The deliverable and goal predicates do not read their
 * criterion id: identity selected WHICH fact to observe upstream; here only the observed
 * fact decides.
 */
export const isMet = (observation: Observation): boolean => {
  switch (observation.kind) {
    case 'pool-target-reached':
      return observation.pooled >= observation.target;
    case 'deliverable-accepted':
      return observation.accepted;
    case 'goal-resolved':
      return observation.resolved;
  }
};
