/**
 * Settlement — obligations that pay themselves out. This package is the typed pledge
 * state machine and nothing more: the phases an obligation moves through and the one
 * owner of those moves. A pledge sits in escrow; when its condition resolves it becomes
 * owed, then releases to the builder — or, unmet, refunds to the backer.
 *
 * The variety lives in values, never in shape: who pledged, who is owed, and what the
 * condition is are carried as opaque `Terms` the lifecycle never interprets, so this
 * core depends only on foundation and the composing service supplies the concrete terms
 * [LAW:decomposition] [LAW:one-way-deps]. Conditions-as-data, the auto-release engine
 * that moves coins and skims the cut, pooled obligations, transparent settlement
 * events, the custodial/on-chain rail, and dispute paths are each their own ticket —
 * this is the spine they hang on, kept minimal so they land additively [LAW:carrying-cost].
 */
export type {
  Escrowed,
  ConditionMet,
  Released,
  Refunded,
  Pledge,
  PledgeBase,
  PledgeId,
  RefundReason,
  SettledPledge,
} from './pledge.js';
export { pledgeId, refundReason } from './pledge.js';

// The lifecycle: the single owner of how a pledge moves between phases.
export { escrow, meetCondition, release, refund } from './lifecycle.js';

// Conditions: the closed, evaluable criteria a pledge releases on — data the composing
// service embeds in its concrete Terms, judged by a pure predicate at the engine's boundary.
export type {
  Condition,
  PoolTargetReached,
  DeliverableAccepted,
  GoalResolved,
  DeliverableId,
  GoalId,
} from './condition.js';
export { deliverableId, goalId } from './condition.js';
export type {
  Observation,
  PoolObservation,
  DeliverableObservation,
  GoalObservation,
} from './evaluate.js';
export { observePool, observeDeliverable, observeGoal, isMet } from './evaluate.js';
