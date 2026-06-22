import type { Ledger, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  AccountId,
  IdempotencyKey,
  TransactionReason,
  TransferError,
} from '@crowdship/ledger-kernel';
import { idempotencyKey, transfer } from '@crowdship/ledger-kernel';
import type {
  Condition,
  DeliverableId,
  Escrowed,
  GoalId,
  Observation,
  PledgeId,
  Released,
} from '@crowdship/settlement';
import { isMet, meetCondition, observeDeliverable, observeGoal, observePool, release } from '@crowdship/settlement';
import type { Clock, CoinAmount } from '@crowdship/std';
import { coinAmount } from '@crowdship/std';

import type { ReleaseLog } from './release-log.js';

/**
 * The concrete obligation terms the release engine requires a pledge to carry. The
 * pledge state machine is GENERIC over its terms and never reads them
 * [LAW:decomposition]; this is the one concrete shape the engine maps onto ledger
 * accounts at its boundary. A pledge whose terms satisfy this shape can be released;
 * the rest of a builder's terms (themes, copy, whatever) ride alongside untouched.
 *
 *  - `escrowAccount` — where the coins are held until release. Its BALANCE is the gross
 *    that releases: the engine drains exactly what the ledger says is held, never a
 *    notional pledged amount that could disagree with reality [LAW:one-source-of-truth].
 *    For a pool-target condition that same balance is the pooled total judged against the
 *    target, so a builder takes the whole pool and many backers funding one escrow needs
 *    no new release path — the pool's identity is positional (this account), not a second
 *    field [LAW:locality-or-seam].
 *  - `builderAccount` — who is paid on release (their share after the cut).
 *  - `condition` — the criterion, stored as data, that the engine observes and judges.
 */
export interface Obligation {
  readonly escrowAccount: AccountId;
  readonly builderAccount: AccountId;
  readonly condition: Condition;
}

/**
 * How a released obligation's gross amount divides: the builder's share and the
 * platform's cut, which MUST sum to the gross — the engine enforces that conservation
 * before any coin moves (below). Both are `CoinAmount` (strictly positive), so a
 * released obligation always pays the builder something AND skims a non-zero cut; a
 * zero-cut or all-cut obligation is a different split shape and a later, additive
 * concern, not a mode this one carries [LAW:no-mode-explosion].
 */
export interface Split {
  readonly builderShare: CoinAmount;
  readonly platformCut: CoinAmount;
}

/**
 * How the platform's cut is taken from a released obligation's gross. The exact rate
 * is the business model — "the spread is the business model" — a knob the platform
 * owns, so it is injected as policy and never hardcoded in the engine
 * [LAW:no-mode-explosion]. Swapping the cut is swapping this value, not editing the
 * release path [LAW:carrying-cost].
 */
export type CutPolicy = (gross: CoinAmount) => Split;

/**
 * The non-coin facts the engine observes to judge a condition: whether a named
 * deliverable has been accepted, whether a goal has resolved. The pool-target fact is
 * deliberately NOT here — its single authority is the ledger's pooled balance
 * [LAW:one-source-of-truth], which the engine already holds, so duplicating it as a
 * method would mint a second authority that could drift. An in-memory fake stands in
 * now; a real deliverable-acceptance / goal-resolution source slots in behind this
 * same seam with no change to the engine [LAW:locality-or-seam].
 */
export interface ObligationFacts {
  accepted(deliverable: DeliverableId): Promise<boolean>;
  resolved(goal: GoalId): Promise<boolean>;
}

/**
 * Every way a release attempt resolves, as one closed union the caller destructures —
 * never a bare boolean or a thrown error for a routine outcome [LAW:dataflow-not-control-flow].
 * The arms differ in the one fact that governs what the caller does next: did the
 * obligation settle, and if not, why?
 *
 *  - `released` — the condition was met on THIS call, coins moved (escrow → builder +
 *    escrow → platform), and the pledge advanced to its terminal `released` phase, all as
 *    one unit. Carries the settled pledge and the ledger receipt proving the money moved.
 *  - `already-released` — this pledge had already released on a prior call; the recorded
 *    result is replayed unchanged (no second observation, no second movement). The same
 *    shape as `released`, kept a distinct arm so a caller that acts on a release — the
 *    stream's event feed — fires once and not again on a faithful retry.
 *  - `pending` — the condition was observed and is not yet met. No coins moved, the
 *    pledge is unchanged; the caller polls again later. Carries the `observation` so
 *    the caller (and the stream) can see WHY — e.g. a pool at 300 of 500.
 *  - `nothing-to-settle` — the condition was met but escrow holds no coins, so there is
 *    nothing to release. Surfaced as its own outcome rather than silently skipped: a met
 *    obligation over an empty escrow is a funding error the caller must see, not a no-op to
 *    swallow [LAW:no-silent-failure]. (A pool can never reach this — being met means its
 *    balance cleared a positive target — so it is the deliverable/goal funding gap.)
 *  - `release-refused` — the ledger refused the coin movement (an account was never opened,
 *    the key was reused for a different movement). No coins moved; the pledge did not
 *    advance. The loud reconciliation case [LAW:no-silent-failure].
 *  - `invalid-routing` — escrow and a payee are the same account, so no movement can even
 *    be formed. A misconfiguration of the obligation's terms; no coins moved.
 */
export type ReleaseOutcome<Terms> =
  | { readonly kind: 'released'; readonly pledge: Released<Terms>; readonly receipt: PostReceipt }
  | { readonly kind: 'already-released'; readonly pledge: Released<Terms>; readonly receipt: PostReceipt }
  | { readonly kind: 'pending'; readonly observation: Observation }
  | { readonly kind: 'nothing-to-settle'; readonly escrowAccount: AccountId }
  | { readonly kind: 'release-refused'; readonly error: PostError }
  | { readonly kind: 'invalid-routing'; readonly error: TransferError };

/**
 * The auto-release engine: given an escrowed pledge whose terms name the accounts and
 * the condition, observe the world, and the instant the condition is met, release the
 * escrow to the builder and skim the platform's cut — no human in the loop. The pledge
 * type only admits an `Escrowed` pledge, so re-releasing a settled obligation is not a
 * runtime guard but a call that does not typecheck [LAW:types-are-the-program].
 */
export interface ReleaseEngine {
  tryRelease<Terms extends Obligation>(pledge: Escrowed<Terms>): Promise<ReleaseOutcome<Terms>>;
}

/** The dependencies the engine composes. Grouped into one record so the wiring is read
 *  at a glance and a new dependency is an additive field, not a shifted positional arg. */
export interface ReleaseEngineDeps {
  /** The single boundary every coin movement passes through — owner of balances, the
   *  no-overdraft rule, and charge idempotency [LAW:single-enforcer]. */
  readonly ledger: Ledger;
  /** The source of the non-coin facts a deliverable or goal condition is judged by. */
  readonly facts: ObligationFacts;
  /** The account the platform's cut is paid into. One account for the engine, not a
   *  per-pledge field — the cut is enforced in one place [LAW:single-enforcer]. */
  readonly platformAccount: AccountId;
  /** How the gross splits into the builder's share and the platform's cut. */
  readonly cut: CutPolicy;
  /** The boundary's clock — the engine owns "now", never reaches for it ambiently
   *  [LAW:no-ambient-temporal-coupling]. */
  readonly clock: Clock;
  /** The audit reason stamped on every release movement in the ledger's history. */
  readonly reason: TransactionReason;
  /** The authority for "has this pledge already released?" — consulted before observing,
   *  so a released pool replays its verdict instead of re-reading its drained balance. */
  readonly log: ReleaseLog;
}

/** The idempotency key for a pledge's release, derived from its id so a retry posts the
 *  IDENTICAL movement and the ledger replays it (no double-spend) rather than recording
 *  a second one. A pledge id is non-blank, so the prefixed key is never blank; a failure
 *  here would be corruption, not a routine outcome, so it halts loudly [LAW:no-silent-failure]. */
const releaseKey = (id: PledgeId): IdempotencyKey => {
  const key = idempotencyKey(`release:${id}`);
  if (!key.ok) throw new Error(`release idempotency key could not be formed from pledge ${id}`);
  return key.value;
};

/** The single enforcer of value conservation across the cut: the builder's share plus
 *  the platform's cut must equal the gross, exactly, in integer coins [LAW:single-enforcer].
 *  A cut policy that fails this would create or destroy coins, so it is corruption that
 *  halts the release loudly — money never moves on a movement that does not balance
 *  [LAW:no-silent-failure]. */
const conserve = (split: Split, gross: CoinAmount): void => {
  const sum: bigint = split.builderShare + split.platformCut;
  if (sum !== (gross as bigint)) {
    throw new Error(
      `cut policy did not conserve value: ${split.builderShare} + ${split.platformCut} != ${gross}`,
    );
  }
};

/**
 * Serializes a pledge's release critical section per id while letting distinct pledges run
 * fully concurrently, so two retries of the SAME pledge cannot both read "not yet released"
 * and both report a fresh `released` [LAW:no-ambient-temporal-coupling]. The coins are safe
 * either way (the ledger's idempotency key), but the caller-visible `released` vs
 * `already-released` signal is not — this owns that ordering rather than leaving it to
 * incidental interleaving. Entries delete themselves once drained, so the map cannot grow
 * without bound. (This closes the in-process race; a cross-process race is closed by a
 * durable log with an atomic claim behind the same seam — purchase's identical machinery.)
 */
class KeyedSerializer {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return run;
  }
}

/**
 * Build the release engine from the seams it composes. The engine is the BOUNDARY that
 * touches the world: it reads the ledger and the fact source to observe, and posts the
 * release movement back through the ledger [LAW:effects-at-boundaries]. The judgment of
 * whether a condition is met is the pure `isMet` from the settlement core; this service
 * only gathers the facts and performs the consequence.
 *
 * The sequence is the whole basis of "settles itself, atomically and idempotently". Each
 * pledge's attempt runs in a per-id critical section [LAW:no-ambient-temporal-coupling]:
 *
 *  1. Consult the log FIRST. If this pledge already released, replay the recorded result —
 *     never observe again. This is load-bearing for a pool-target condition, whose release
 *     drains the very balance it observes: re-reading a released pool would see it below
 *     target and wrongly report `pending` [LAW:no-silent-failure].
 *  2. Otherwise observe the condition against the coins held in escrow; if not met, return
 *     `pending` and touch nothing.
 *  3. If met, release exactly the escrow balance — the ledger is the one truth of what is
 *     held [LAW:one-source-of-truth] — splitting it into the builder's share and the
 *     platform's cut. Post the coins FIRST (money is the thing that must never be wrong),
 *     then advance the pledge (pure, infallible) and record the release.
 *
 * The post carries a key derived from the pledge id, so the ledger moves the coins at most
 * once no matter how often this runs. But "coins move once" is not the whole contract: the
 * `released` vs `already-released` distinction is the signal a caller acts on (the stream's
 * event feed must fire once), and that distinction is NOT idempotent under a bare retry —
 * two racers could both miss the log and both report `released`. So, exactly as purchase
 * does for its non-idempotent effect, the attempt is serialized per pledge id, and the
 * second racer observes the log already written and replays `already-released`. A refused
 * post is surfaced, never swallowed, and the pledge never advances without a receipt
 * proving the coins moved [LAW:no-silent-failure]. The one residual window — the process
 * dying after the post but before the record — is the atomic two-phase settlement rail's
 * concern (its own ticket), not silently handled here: a deliverable/goal pledge self-heals
 * on retry (its observable is stable), and a pool pledge in that window is the exact case
 * the durable, atomic log behind this seam closes.
 */
export const createReleaseEngine = (deps: ReleaseEngineDeps): ReleaseEngine => {
  const { ledger, facts, platformAccount, cut, clock, reason, log } = deps;
  const serializer = new KeyedSerializer();

  // Pair the condition with its one live reading into the single Observation value `isMet`
  // judges. The pool's reading is the coins held in escrow — passed in, read once, so the
  // met-decision and the released gross are the same snapshot — while a deliverable/goal
  // reading comes from the fact source. Exhaustive over the closed condition union with no
  // `default`: a new condition kind stops this compiling until its fact has a source, so the
  // engine can never silently treat an unobserved condition as unmet [LAW:no-silent-failure].
  const observe = async (condition: Condition, held: bigint): Promise<Observation> => {
    switch (condition.kind) {
      case 'pool-target-reached':
        return observePool(condition, held);
      case 'deliverable-accepted':
        return observeDeliverable(condition, await facts.accepted(condition.deliverable));
      case 'goal-resolved':
        return observeGoal(condition, await facts.resolved(condition.goal));
    }
  };

  const settle = async <Terms extends Obligation>(
    pledge: Escrowed<Terms>,
  ): Promise<ReleaseOutcome<Terms>> => {
    // Reconstruct the terminal pledge deterministically from the (unchanged) escrowed
    // pledge and the recorded instant — the same value the original release produced.
    const prior = await log.released(pledge.id);
    if (prior) {
      const replayed = release(meetCondition(pledge, prior.at), prior.at);
      return { kind: 'already-released', pledge: replayed, receipt: prior.receipt };
    }

    const { escrowAccount, builderAccount, condition } = pledge.terms;

    const held = await ledger.balanceOf(escrowAccount);
    const observation = await observe(condition, held);
    if (!isMet(observation)) return { kind: 'pending', observation };

    // The gross is what the ledger actually holds, not the pledge's notional amount — a met
    // obligation over an empty escrow has nothing to release, surfaced rather than skipped.
    const gross = coinAmount(held);
    if (!gross.ok) return { kind: 'nothing-to-settle', escrowAccount };

    const split = cut(gross.value);
    conserve(split, gross.value);

    // The balanced release movement: the builder's share and the platform's cut both leave
    // escrow, draining exactly what was held. `transfer` is the single constructor that
    // rejects a same-account leg, so a misrouted obligation is a typed outcome, not a
    // movement the ledger must defend.
    const toBuilder = transfer(escrowAccount, builderAccount, split.builderShare);
    if (!toBuilder.ok) return { kind: 'invalid-routing', error: toBuilder.error };
    const toPlatform = transfer(escrowAccount, platformAccount, split.platformCut);
    if (!toPlatform.ok) return { kind: 'invalid-routing', error: toPlatform.error };

    const posted = await ledger.post({
      transfers: [toBuilder.value, toPlatform.value],
      reason,
      idempotencyKey: releaseKey(pledge.id),
    });
    if (!posted.ok) return { kind: 'release-refused', error: posted.error };

    // Coins have moved. Advance the pledge through its phases to terminal `released` — pure
    // transitions, so this cannot fail after the money moved — and record the release so a
    // later call replays this exact verdict rather than re-observing.
    const at = clock.now();
    const released = release(meetCondition(pledge, at), at);
    await log.record(pledge.id, { receipt: posted.value, at });
    return { kind: 'released', pledge: released, receipt: posted.value };
  };

  return {
    tryRelease: (pledge) => serializer.run(pledge.id, () => settle(pledge)),
  };
};
