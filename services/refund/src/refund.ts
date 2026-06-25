import type { AccountMovement, LedgerQuery, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  AccountId,
  Timestamp as LedgerTimestamp,
  TransactionId,
  Transfer,
} from '@crowdship/ledger-kernel';
import { transactionReason, transfer } from '@crowdship/ledger-kernel';
import type { Escrowed, RefundReason, Refunded } from '@crowdship/settlement';
import { refund } from '@crowdship/settlement';
import type { SettlementRail } from '@crowdship/settlement-rail';
import type { Timestamp } from '@crowdship/std';
import { coinAmount, timestamp } from '@crowdship/std';

/**
 * The concrete terms the refund engine requires a pledge to carry. Like the release engine's
 * `Obligation`, the pledge state machine is GENERIC over its terms and never reads them
 * [LAW:decomposition]; this is the one field the refund maps onto the ledger. A refund needs
 * far less than a release: no builder, no platform, no condition — only the escrow whose coins
 * go back. WHO they go back to is not a field here, because it is not the pledge's to assert:
 * the backers and their shares are read from the ledger's recorded escrow history (every
 * contribution is a credit leg), the single source of truth that the pool deliberately keeps
 * no second copy of [LAW:one-source-of-truth]. A pool's `PoolTerms` and a release `Obligation`
 * both structurally satisfy this, so either can be refunded with no new bridge.
 */
export interface Refundable {
  readonly escrowAccount: AccountId;
}

/**
 * Every way a refund attempt resolves, as one closed union the caller destructures — never a
 * bare boolean or a thrown error for a routine outcome [LAW:dataflow-not-control-flow]. The
 * arms mirror the release engine's so the two settlement directions read as one shape.
 *
 *  - `refunded` — the escrow's coins went back to its backers on THIS call (escrow → each
 *    backer their net contribution), as one atomic movement, and the pledge advanced to its
 *    terminal `refunded` phase carrying the reason. Carries the settled pledge and the ledger
 *    receipt proving the coins moved.
 *  - `already-refunded` — this pledge had already refunded on a prior call; the verdict is
 *    replayed from the rail's record of the refunding movement (no second history read, no
 *    second movement). It carries the reconstructed terminal pledge and the `transactionId`
 *    of that movement. The durable, crash- and process-surviving replay: the rail reads
 *    "refunded?" from the money itself.
 *  - `nothing-to-refund` — the escrow holds no coins owed back to a backer (an empty or
 *    fully-drained escrow). Surfaced as its own outcome rather than silently skipped: a refund
 *    asked of an empty escrow is a caller error to see, not a no-op to swallow [LAW:no-silent-failure].
 *  - `refund-refused` — the rail refused the coin movement: most really because the escrow can
 *    no longer cover the refund (it was drained meanwhile — e.g. a release already paid the
 *    builder), which the ledger refuses as a would-overdraft and a corrected retry must
 *    reconcile; or, defensively, a payee the ledger never opened (which, unlike a release to a
 *    fresh builder wallet, cannot arise for a refund — every payee is a prior contributor, and
 *    a contributor necessarily has an open wallet — but the engine inherits the recoverable,
 *    non-poisoning treatment of that case from the ledger contract regardless). No coins moved;
 *    the pledge did not advance. The loud reconciliation case [LAW:no-silent-failure].
 *
 * There is deliberately NO `invalid-routing` arm, unlike the release engine. A release routes
 * to a caller-supplied `builderAccount` that could be misconfigured to the escrow itself; a
 * refund's payees are the escrow's own credit counterparties, which the ledger guarantees are
 * distinct from the escrow (it never recorded an escrow→escrow leg). So a same-account refund
 * leg is not a reachable domain outcome but a corrupt ledger history — halted loudly, never
 * downgraded to a routine value [LAW:types-are-the-program] [LAW:no-silent-failure].
 */
export type RefundOutcome<Terms> =
  | { readonly kind: 'refunded'; readonly pledge: Refunded<Terms>; readonly receipt: PostReceipt }
  | { readonly kind: 'already-refunded'; readonly pledge: Refunded<Terms>; readonly transactionId: TransactionId }
  | { readonly kind: 'nothing-to-refund'; readonly escrowAccount: AccountId }
  | { readonly kind: 'refund-refused'; readonly error: PostError };

/**
 * The refund engine: given an escrowed pledge whose terms name the escrow account, return the
 * escrow's coins to the backers who funded it — each their net recorded contribution — and
 * advance the pledge to its terminal `refunded` phase carrying why. The mirror image of the
 * auto-release engine: where release settles a met obligation FORWARD to the builder, refund
 * settles an unmet or disputed one BACK to its backers, the failure mode designed like the
 * success path.
 *
 * The pledge type admits ONLY an `Escrowed` pledge, so refunding an obligation whose condition
 * is already met (the builder is owed) or one already settled is not a runtime guard but a call
 * that does not typecheck [LAW:types-are-the-program]. WHETHER a given escrowed obligation
 * should refund — a pool expired, a dispute upheld — is the policy's decision, supplied as the
 * `RefundReason`; the engine performs the refund the policy ordered, it does not re-judge the
 * condition [LAW:decomposition]. (If a release and a refund race the same pledge, the ledger's
 * no-overdraft rule is the single enforcer that decides: whichever drains the escrow first
 * wins, the loser is refused loudly — the coins are never double-spent [LAW:single-enforcer].)
 */
export interface RefundEngine {
  tryRefund<Terms extends Refundable>(
    pledge: Escrowed<Terms>,
    reason: RefundReason,
  ): Promise<RefundOutcome<Terms>>;
}

/** The dependencies the engine composes. Grouped into one record so the wiring is read at a
 *  glance and a new dependency is an additive field, not a shifted positional arg. */
export interface RefundEngineDeps {
  /** The ledger's read/audit seam: the escrow's recorded history, whose credit legs ARE the
   *  contributor ledger the refund shares are computed from [LAW:one-source-of-truth]. The
   *  engine reads who funded what through here and *settles* the return through the rail; it
   *  never posts the refund movement directly. */
  readonly query: LedgerQuery;
  /** The seam every refund settles through: move the coins and commit that it refunded, as one
   *  atomic unit under the `refund` purpose, and answer whether a pledge has already refunded.
   *  Custodial now, on-chain later — a different instance, never a change here
   *  [LAW:locality-or-seam]. The engine has no clock: a refund happens at the instant the
   *  rail's movement is recorded, so the refund instant is the money's own [LAW:one-source-of-truth]. */
  readonly rail: SettlementRail;
}

/** The money's recorded instant, re-branded into the settlement domain's `Timestamp`. The
 *  ledger and the pledge state machine each brand epoch-millis in their own package, and the
 *  two brands are nominally distinct, so the one instant that crosses between them — a refund
 *  happens when the rail's movement is recorded — is re-branded here. A recorded instant is a
 *  valid epoch millis, so a failure is corruption, halted loudly rather than swallowed
 *  [LAW:no-silent-failure]. (The std/ledger-kernel `Timestamp` split is a known duplication to
 *  be unified at the root, not papered over with a shared helper.) */
const asInstant = (occurredAt: LedgerTimestamp): Timestamp => {
  const at = timestamp(occurredAt);
  if (!at.ok) throw new Error(`ledger recorded an invalid occurred-at instant: ${occurredAt}`);
  return at.value;
};

/**
 * Each backer's net contribution to the escrow, read straight from its recorded history: a
 * credit (coins INTO escrow) is what a backer put in, a debit (coins OUT) is what already went
 * back to them. The fold over the history — oldest first, the ledger's contract — yields, per
 * counterparty, the coins still owed back. This is the whole reason the refund needs no second
 * contributor list: the escrow's own legs are the list [LAW:one-source-of-truth]. A counterparty
 * whose net is zero (fully refunded) or negative (a payout leg, e.g. a builder on a release —
 * not a state a refundable pledge reaches, but read honestly if present) is simply not owed a
 * refund, and the caller filters those out.
 */
const netContributions = (history: readonly AccountMovement[]): ReadonlyMap<AccountId, bigint> => {
  const net = new Map<AccountId, bigint>();
  for (const movement of history) {
    const signed = movement.direction === 'credit' ? (movement.amount as bigint) : -(movement.amount as bigint);
    net.set(movement.counterparty, (net.get(movement.counterparty) ?? 0n) + signed);
  }
  return net;
};

/**
 * Build the refund engine from the seams it composes. The engine is the BOUNDARY that touches
 * the world: it reads the escrow's history and settles the return through the rail
 * [LAW:effects-at-boundaries]. The sequence is the mirror of the release engine's:
 *
 *  1. Ask the rail FIRST whether this pledge has already refunded. If it has, replay the
 *     verdict from the recorded movement — never re-read the history. This is load-bearing the
 *     same way release's settled-check is: the refund DRAINS the escrow it reads, so a naive
 *     re-run over the grown history would compute every backer's net as zero and report
 *     `nothing-to-refund` instead of the truthful `already-refunded`. Because the rail derives
 *     "refunded?" from the money itself, this heals across a crash and across processes.
 *  2. Otherwise read the escrow's recorded history and fold it into each backer's net
 *     contribution. The refund legs are exactly those still owed coins back — escrow → each
 *     backer their net — formed as ONE atomic movement so all the backers are made whole or
 *     none are. An empty set of legs is `nothing-to-refund`.
 *  3. Settle that movement through the rail under the pledge's `refund` key. The ledger is the
 *     single enforcer of conservation: it will refuse (loudly) any refund the escrow can no
 *     longer cover, so the engine never re-checks the no-overdraft rule the ledger owns
 *     [LAW:single-enforcer]. On success, advance the pledge (pure, infallible) to its terminal
 *     `refunded` phase at the instant the money moved, carrying the policy's reason.
 *
 * Unlike release, the refund owns no per-id serializer. Release pairs its movement with a
 * second, non-idempotent signal — the stream's feed must fire exactly once on `released` — so
 * it serializes racers to keep that signal exact. A refund has no such second effect: the coin
 * movement IS the entire act, the ledger's single-use key already makes it at-most-once, and
 * the refunded pledge is a pure function of the (idempotent) receipt. So two racing retries are
 * both correct with no ordering to own [LAW:no-ambient-temporal-coupling] — the same judgment
 * the pool funder made for a contribution. (The `already-refunded` arm still gives the exact
 * replay across sequential retries and crash recovery, read from the money itself; if a
 * fire-once consumer of `refunded` is ever added, the serializer lands then, as it did for
 * release.) A refused refund is surfaced, never swallowed, and the pledge never advances
 * without a receipt proving the coins moved [LAW:no-silent-failure].
 */
export const createRefundEngine = (deps: RefundEngineDeps): RefundEngine => {
  const { query, rail } = deps;

  const tryRefund = async <Terms extends Refundable>(
    pledge: Escrowed<Terms>,
    reason: RefundReason,
  ): Promise<RefundOutcome<Terms>> => {
    // Reconstruct the terminal pledge deterministically from the (unchanged) escrowed pledge,
    // the policy's reason, and the instant the refunding movement was recorded — the same value
    // the original refund produced.
    const prior = await rail.settlementOf('refund', pledge.id);
    if (prior) {
      const at = asInstant(prior.occurredAt);
      return { kind: 'already-refunded', pledge: refund(pledge, at, reason), transactionId: prior.transactionId };
    }

    const { escrowAccount } = pledge.terms;
    const history = await query.historyOf(escrowAccount);

    // One leg per backer still owed coins, escrow → backer their net contribution. A backer is
    // a credit counterparty of the escrow, which the ledger guarantees is not the escrow itself
    // and whose net (filtered > 0) is a valid coin amount — so a failure from either constructor
    // is a corrupt history, halted loudly rather than downgraded to a routine value
    // [LAW:no-silent-failure].
    const legs: Transfer[] = [];
    for (const [backer, net] of netContributions(history)) {
      if (net <= 0n) continue;
      const amount = coinAmount(net);
      if (!amount.ok) throw new Error(`refund share for ${backer} was not a valid coin amount: ${net}`);
      const leg = transfer(escrowAccount, backer, amount.value);
      if (!leg.ok) throw new Error(`refund leg escrow ${escrowAccount} → backer ${backer} was rejected: ${leg.error.kind}`);
      legs.push(leg.value);
    }

    const [first, ...rest] = legs;
    if (first === undefined) return { kind: 'nothing-to-refund', escrowAccount };

    // The refund's audit reason IS the policy's refund reason — one source of truth for WHY the
    // coins went back, stamped on the movement the transparent feed reads. A `RefundReason` is
    // non-blank, so re-branding it as the movement's reason cannot fail on a routine value; a
    // failure here would be corruption, halted loudly [LAW:no-silent-failure].
    const ledgerReason = transactionReason(String(reason));
    if (!ledgerReason.ok) throw new Error(`refund reason could not be stamped on the movement: ${reason}`);

    const settled = await rail.settle({
      purpose: 'refund',
      pledge: pledge.id,
      transfers: [first, ...rest],
      reason: ledgerReason.value,
    });
    if (!settled.ok) return { kind: 'refund-refused', error: settled.error };

    // Coins have moved and the refund is committed. Advance the pledge to terminal `refunded`
    // — a pure transition, so this cannot fail after the money moved — at the instant the money
    // moved, which the receipt carries [LAW:one-source-of-truth].
    const at = asInstant(settled.value.occurredAt);
    return { kind: 'refunded', pledge: refund(pledge, at, reason), receipt: settled.value };
  };

  return { tryRefund };
};
