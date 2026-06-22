import type { Ledger, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  AccountId,
  IdempotencyKey,
  TransactionReason,
  TransferError,
} from '@crowdship/ledger-kernel';
import { transfer } from '@crowdship/ledger-kernel';
import type { EffectPerformer, EffectReceipt, PerformError, PricedOffer } from '@crowdship/menu';

import type { CompletedPurchase, PurchaseLog } from './purchase-log.js';

/**
 * What a backer asks for when they buy an offer: the offer itself (its price and
 * the effect to fire — one source of truth, never re-passed apart), who pays and
 * who is paid, and the idempotency key + reason that make the coin movement
 * replay-safe and auditable. The key identifies this whole purchase: a retry must
 * re-issue the *identical* request under the same key — same payer, payee, price,
 * and reason. A retry that changes any of those is a different movement under a
 * spent key, which the ledger refuses (surfaced as `charge-refused`), never replays.
 *
 * Routing (payer → payee) and the key/reason are the caller's — the checkout
 * surface owns *who* and *why* — while the *amount* is the offer's `price`, taken
 * from the one place it lives [LAW:one-source-of-truth]. The platform cut is not
 * here: it is a later movement shape (more legs) and its own ticket, so this keeps
 * the single-leg case canonical rather than pre-building machinery [LAW:no-mode-explosion].
 */
export interface PurchaseRequest {
  readonly offer: PricedOffer;
  readonly payer: AccountId;
  readonly payee: AccountId;
  readonly idempotencyKey: IdempotencyKey;
  readonly reason: TransactionReason;
}

/**
 * Every way a purchase can resolve, as one closed union the caller destructures —
 * never a bare boolean or a thrown error [LAW:dataflow-not-control-flow]. The arms
 * differ in the one fact that governs what the caller must do next: *did coins
 * move, and did the effect fire?*
 *
 * - `fired` — coins moved and the effect fired on this call. The whole point, end
 *   to end. Carries both receipts.
 * - `already-applied` — this key's purchase already ran to completion on a prior
 *   call: the coins moved AND the effect fired then, so neither happens again and
 *   the original receipts are returned. A faithful retry is an idempotent no-op that
 *   reproduces the first result, never a second charge or a second effect.
 * - `charge-refused` — the ledger refused the movement (overdraft, unknown account,
 *   key reused for a *different* movement). No coins moved; no effect fired.
 * - `invalid-charge` — payer and payee are the same account, so no movement can even
 *   be formed. No coins moved; no effect fired.
 * - `effect-failed` — coins MOVED but the effect did not fire (unknown kind, or the
 *   handler failed). The loud reconciliation case: the backer paid and got nothing,
 *   so it carries the `receipt` proving the money is out [LAW:no-silent-failure]. It
 *   is deliberately NOT recorded as complete, so a faithful retry replays the (single)
 *   charge and *re-fires* the effect — the charge cannot double, but the effect that
 *   never happened still can, which is exactly the recovery a paid backer is owed.
 */
export type PurchaseOutcome =
  | { readonly kind: 'fired'; readonly receipt: PostReceipt; readonly effect: EffectReceipt }
  | { readonly kind: 'already-applied'; readonly receipt: PostReceipt; readonly effect: EffectReceipt }
  | { readonly kind: 'charge-refused'; readonly error: PostError }
  | { readonly kind: 'invalid-charge'; readonly error: TransferError }
  | { readonly kind: 'effect-failed'; readonly receipt: PostReceipt; readonly error: PerformError };

/**
 * The dataflow spine of the product: a backer buys a priced offer, coins move, the
 * effect fires. One path every offer runs, every time — the variety lives entirely
 * in the offer's value (its price and its open-kinded effect), never in a branch per
 * kind of offer [LAW:dataflow-not-control-flow]. A shoutout, a feature vote, and a
 * "summon a dragon" all run this same `buy`.
 */
export interface Purchaser {
  buy(request: PurchaseRequest): Promise<PurchaseOutcome>;
}

/**
 * Serializes the buy critical section per idempotency key while letting distinct
 * keys run fully concurrently, so two retries of the *same* key cannot both read
 * "not yet completed" and both fire the effect [LAW:no-ambient-temporal-coupling].
 * Distinct keys never contend. Entries delete themselves once drained, so the map
 * cannot grow without bound. (This closes the in-process race; a cross-process race
 * is closed by a durable `PurchaseLog` with an atomic claim — the same later seam.)
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
 * Compose the purchase pipeline from the three seams it orchestrates: the `Ledger`
 * that owns the money (balances, no-overdraft, charge-idempotency), the
 * `EffectPerformer` that turns an effect description into something that happens at
 * the edge, and the `PurchaseLog` that owns the one fact the ledger cannot — whether
 * this purchase's effect already fired. This service computes the *outcome*; it
 * performs no effect itself, only sequences the seams that do [LAW:effects-at-boundaries].
 *
 * The sequence is deliberate and the whole basis of "atomically and idempotently":
 * if the log shows this key already completed, return that result unchanged; else
 * post the coins FIRST — money is the thing that must never be wrong — then fire the
 * effect, and record completion only when it fires. A faithful retry of a completed
 * purchase replays the recorded result (no second charge, no second effect); a retry
 * of one whose effect failed replays the charge (the ledger guarantees coins move at
 * most once) and re-fires the effect, because the log never recorded it as done. The
 * effect's at-most-once gate is the log's record, not the ledger's replay — those are
 * two different facts and must not be conflated [LAW:one-source-of-truth].
 */
export const createPurchaser = (
  ledger: Ledger,
  performer: EffectPerformer,
  log: PurchaseLog,
): Purchaser => {
  const serializer = new KeyedSerializer();
  const settle = async (request: PurchaseRequest): Promise<PurchaseOutcome> => {
    const done = await log.completed(request.idempotencyKey);
    if (done) return { kind: 'already-applied', receipt: done.receipt, effect: done.effect };

    // Build the single price movement from the offer's own price. A payer that is
    // also the payee cannot form a movement — a typed outcome, not a thrown error.
    const leg = transfer(request.payer, request.payee, request.offer.price);
    if (!leg.ok) return { kind: 'invalid-charge', error: leg.error };

    const posted = await ledger.post({
      transfers: [leg.value],
      reason: request.reason,
      idempotencyKey: request.idempotencyKey,
    });
    if (!posted.ok) return { kind: 'charge-refused', error: posted.error };

    const fired = await performer.perform(request.offer.effect);
    // A paid-but-unfired effect is left unrecorded on purpose: the money is out, so
    // the outcome carries the receipt to reconcile, and a retry re-fires the effect.
    if (!fired.ok) return { kind: 'effect-failed', receipt: posted.value, error: fired.error };

    const completed: CompletedPurchase = { receipt: posted.value, effect: fired.value };
    await log.record(request.idempotencyKey, completed);
    return { kind: 'fired', receipt: posted.value, effect: fired.value };
  };

  return { buy: (request) => serializer.run(request.idempotencyKey, () => settle(request)) };
};
