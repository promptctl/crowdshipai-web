import type { BlankError, Brand, CoinAmount, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/**
 * A condition is the criterion a backer's escrow releases on, stored as DATA inside the
 * pledge's opaque `Terms` and evaluated at the boundary — never branched on by the state
 * machine [LAW:dataflow-not-control-flow]. Pool-target-reached, deliverable-accepted, and
 * goal-resolved are instances of ONE condition type, not three condition systems
 * [LAW:one-type-per-behavior]: each arm carries exactly the criterion its phase needs and
 * nothing more, so the shape of the value names which fact must be observed.
 *
 * Unlike the menu's `EffectKind` — an OPEN label the rail never interprets — this union is
 * deliberately CLOSED: the settlement engine must evaluate it, and a fact it cannot read is
 * a release it cannot judge. A new condition kind is a new observable fact the world must
 * report, so it lands here, behind the exhaustive evaluator, never as free-form data
 * [LAW:no-mode-explosion]. The cap is "facts the platform can observe"; the exit is that
 * builder-authored, uninterpreted variety already has its home in the menu's effects.
 */
export type Condition = PoolTargetReached | DeliverableAccepted | GoalResolved;

/** Coins pooled against the obligation have reached the target. The criterion is the
 *  threshold; the live total is observed at evaluation time. Identity of the pool is the
 *  obligation's own — positional, not named here. */
export interface PoolTargetReached {
  readonly kind: 'pool-target-reached';
  readonly target: CoinAmount;
}

/** A named deliverable has been accepted. The criterion is which deliverable; whether it
 *  was accepted is the observed fact. */
export interface DeliverableAccepted {
  readonly kind: 'deliverable-accepted';
  readonly deliverable: DeliverableId;
}

/** A builder's goal has resolved in the backer's favor. The criterion is which goal; the
 *  resolution is the observed fact. */
export interface GoalResolved {
  readonly kind: 'goal-resolved';
  readonly goal: GoalId;
}

/** Identity of the deliverable whose acceptance a condition watches — a non-blank, verbatim
 *  brand, the same one foundation mechanism as every other identity on the platform. */
export type DeliverableId = Brand<string, 'DeliverableId'>;

export const deliverableId = (raw: string): Result<DeliverableId, BlankError> =>
  nonBlank<'DeliverableId'>('deliverableId', raw);

/** Identity of the goal whose resolution a condition watches. */
export type GoalId = Brand<string, 'GoalId'>;

export const goalId = (raw: string): Result<GoalId, BlankError> => nonBlank<'GoalId'>('goalId', raw);
