import type { CoinAmount, Timestamp } from '@crowdship/std';

import type { ConditionMet, Escrowed, PledgeId, Refunded, Released, RefundReason } from './pledge.js';

/**
 * The lifecycle: the one and only owner of how a pledge moves between phases
 * [LAW:single-enforcer]. There is no other way to change a pledge's status, so
 * ordering lives in these functions as explicit transitions rather than as folklore
 * about which mutation may run when [LAW:no-ambient-temporal-coupling].
 *
 * Each transition accepts ONLY the phase it legally starts from and returns the next
 * phase — so an illegal move (release before the condition is met, advancing a settled
 * pledge, refunding after the builder is owed) is not a runtime error to guard against
 * but a call that does not typecheck [LAW:types-are-the-program]. The functions are
 * total and pure: same inputs, same output, no branch on the current state and no
 * touch of the world — the clock is owned at the boundary and the instant is passed in
 * [LAW:effects-at-boundaries] [LAW:dataflow-not-control-flow]. Moving the coins and
 * skimming the cut are the auto-release engine's job; here `release` only advances the
 * state — the obligation that a release *describes* is performed downstream.
 */

/** Open a pledge: coins go into escrow against opaque terms, as of the given instant.
 *  The lifecycle's entry point — the blessed path to any later phase runs escrow then
 *  transition, rather than hand-building a state the transitions never produced. */
export const escrow = <Terms>(
  id: PledgeId,
  amount: CoinAmount,
  terms: Terms,
  at: Timestamp,
): Escrowed<Terms> => ({ status: 'escrowed', id, amount, terms, escrowedAt: at });

/** The condition resolved in the builder's favor; the pledge becomes owed. */
export const meetCondition = <Terms>(pledge: Escrowed<Terms>, at: Timestamp): ConditionMet<Terms> => ({
  ...pledge,
  status: 'condition-met',
  metAt: at,
});

/** Settle to the builder. Accepts only a condition-met pledge, so escrow can never
 *  release before its condition is met. */
export const release = <Terms>(pledge: ConditionMet<Terms>, at: Timestamp): Released<Terms> => ({
  ...pledge,
  status: 'released',
  releasedAt: at,
});

/** Settle back to the backer, carrying why. Accepts only an escrowed pledge — once the
 *  condition is met the builder is owed, so a met or settled pledge cannot refund
 *  through this path. */
export const refund = <Terms>(
  pledge: Escrowed<Terms>,
  at: Timestamp,
  reason: RefundReason,
): Refunded<Terms> => ({ ...pledge, status: 'refunded', refundedAt: at, reason });
