import type { BlankError, Brand, CoinAmount, Result, Timestamp } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/** Identity of a single obligation — opaque, minted once at escrow time. */
export type PledgeId = Brand<string, 'PledgeId'>;

/**
 * A pledge id is a non-blank, verbatim key — taken exactly as given, since
 * normalization would silently change identity [LAW:no-silent-failure]. Same one
 * foundation mechanism as every other non-blank brand on the platform.
 */
export const pledgeId = (raw: string): Result<PledgeId, BlankError> => nonBlank<'PledgeId'>('pledgeId', raw);

/**
 * Why escrow was returned to the backer rather than released to the builder. An
 * OPEN label the caller authors, never a platform-closed enum [LAW:no-mode-explosion]:
 * "deliverable rejected", "pool expired", "dispute upheld" are values, not a union the
 * lifecycle enumerates. Money never moves silently, so a refund always carries its
 * reason [LAW:no-silent-failure]; the policy that *chooses* the reason is the dispute
 * ticket's, not this state machine's.
 */
export type RefundReason = Brand<string, 'RefundReason'>;

export const refundReason = (raw: string): Result<RefundReason, BlankError> =>
  nonBlank<'RefundReason'>('refundReason', raw);

/**
 * The facts a pledge carries through its whole life but never itself interprets:
 * who pledged, who is owed, and the condition that releases it. The lifecycle is
 * deliberately GENERIC over them [LAW:decomposition] — settlement is a core that may
 * depend only on foundation, so the ledger's account type and the condition type those
 * later tickets introduce are out of its reach; it carries them opaquely and the
 * composing service supplies the concrete terms. This is the seam that lets
 * conditions-as-data and the auto-release engine land without rewriting the state
 * machine [LAW:locality-or-seam].
 *
 * The escrow timestamp lives here because there is no pledge that was never escrowed —
 * it is intrinsic to every phase, not to one arm.
 */
export interface PledgeBase<Terms> {
  readonly id: PledgeId;
  readonly amount: CoinAmount;
  readonly terms: Terms;
  readonly escrowedAt: Timestamp;
}

/**
 * The pledge as a discriminated union over its lifecycle phase. Each arm carries
 * EXACTLY what is known once that phase is reached and not one field more, so the
 * data shape is the proof of how far the obligation has progressed — a met timestamp
 * cannot exist before the condition was met, a release timestamp cannot exist before
 * release [LAW:types-are-the-program] [FRAMING:representation]. The phase is named ONCE,
 * in the discriminant; the lifecycle transitions own ordering between phases, which is
 * never reconstructed from incidental execution order [LAW:no-ambient-temporal-coupling].
 */

/** Coins are held; the condition has not yet resolved. The only phase from which a
 *  pledge may still be refunded — once the condition is met, the builder is owed. */
export interface Escrowed<Terms> extends PledgeBase<Terms> {
  readonly status: 'escrowed';
}

/** The condition resolved in the builder's favor; release is now owed. The only forward
 *  move from here is release. */
export interface ConditionMet<Terms> extends PledgeBase<Terms> {
  readonly status: 'condition-met';
  readonly metAt: Timestamp;
}

/** Settled to the builder. Terminal. A released pledge always passed through
 *  condition-met, so it carries that earlier instant alongside when it released. The
 *  coin movement and the platform cut are the auto-release engine's concern, not this
 *  state's. */
export interface Released<Terms> extends PledgeBase<Terms> {
  readonly status: 'released';
  readonly metAt: Timestamp;
  readonly releasedAt: Timestamp;
}

/** Settled back to the backer. Terminal. In this lifecycle a refund only reaches an
 *  unmet pledge, so it never carries a met instant — the absence is the type telling the
 *  truth about the path taken. Carries why it refunded. */
export interface Refunded<Terms> extends PledgeBase<Terms> {
  readonly status: 'refunded';
  readonly refundedAt: Timestamp;
  readonly reason: RefundReason;
}

/** A pledge in any phase of its life — what a store holds and a reader destructures. */
export type Pledge<Terms> = Escrowed<Terms> | ConditionMet<Terms> | Released<Terms> | Refunded<Terms>;

/** A pledge whose obligation has resolved one way or the other — no further transition
 *  exists. The grouping the settlement engine and the stream's event feed care about. */
export type SettledPledge<Terms> = Released<Terms> | Refunded<Terms>;
