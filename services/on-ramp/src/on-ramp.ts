import type { Ledger, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  AccountId,
  CoinAmount,
  IdempotencyKey,
  TransactionReason,
  TransferError,
} from '@crowdship/ledger-kernel';
import { transfer } from '@crowdship/ledger-kernel';
import type {
  ChargeDeclined,
  ChargeReceipt,
  FiatCharge,
  PaymentGateway,
} from '@crowdship/payments';

/**
 * What a backer asks for when they buy coins: the `charge` to take in fiat, the
 * `coins` to credit and the `wallet` to credit them to, plus the `reason` and
 * `idempotencyKey` that make the coin post auditable and replay-safe. The fiat
 * `key` lives inside the charge and the coin `idempotencyKey` is separate — two
 * movements on two engines, each with its own idempotency, correlated here by the
 * one purchase that drives both [LAW:one-source-of-truth].
 *
 * How many coins a given charge buys — the buy rate, the spread — is deliberately
 * NOT computed here: `coins` and `charge` arrive already paired by the pricing
 * policy that owns that knob (its own ticket), so this on-ramp stays the pure
 * "fiat in, coins out" movement and the rate can change without touching it
 * [LAW:decomposition]. The mint the coins are drawn from is platform infrastructure,
 * fixed at construction, never a per-request choice.
 */
export interface OnRampRequest {
  readonly wallet: AccountId;
  readonly coins: CoinAmount;
  readonly charge: FiatCharge;
  readonly reason: TransactionReason;
  readonly idempotencyKey: IdempotencyKey;
}

/**
 * Every way buying coins can resolve, as one closed union the caller destructures
 * — never a bare boolean or a thrown error [LAW:dataflow-not-control-flow]. The
 * arms differ in the one fact that governs what the caller must do next: *was
 * fiat taken, and were coins credited?*
 *
 * - `purchased` — fiat was charged and the coins were posted to the wallet. The
 *   whole point, end to end; carries both receipts. A faithful retry of a
 *   completed purchase returns `purchased` again with the identical receipts —
 *   the charge replays at the PSP and the post replays at the ledger, so neither
 *   the card nor the mint is touched twice.
 * - `charge-declined` — the PSP refused the fiat (or was unreachable). No money
 *   moved and no coins were minted; the charge never even reached the ledger.
 * - `credit-refused` — fiat WAS charged but the ledger refused the mint (an
 *   unknown wallet, a reused key). The loud reconciliation case: the backer paid
 *   and holds no coins, so it carries the `charge` receipt proving the money is in
 *   [LAW:no-silent-failure]. How it recovers turns on WHY the post was refused: an
 *   unknown wallet spends no post key (the ledger judges it before any balance is
 *   touched), so opening the wallet and retrying — the SAME charge key, so the fiat
 *   is not taken again — lets the mint post under that very same key. That is the
 *   on-ramp's realistic refusal, since its mint can never overdraft. A genuine key
 *   conflict (a key already spent on a different movement) is terminal under that
 *   key, recovered with a fresh post key reusing the same charge, or a refund. The
 *   loss is surfaced, never silent.
 * - `invalid-routing` — the mint and the wallet are the same account, so no mint
 *   movement can be formed. Caught BEFORE any charge, so no money is taken for a
 *   credit that could never land.
 */
export type OnRampOutcome =
  | { readonly kind: 'purchased'; readonly charge: ChargeReceipt; readonly receipt: PostReceipt }
  | { readonly kind: 'charge-declined'; readonly error: ChargeDeclined }
  | { readonly kind: 'credit-refused'; readonly charge: ChargeReceipt; readonly error: PostError }
  | { readonly kind: 'invalid-routing'; readonly error: TransferError };

/**
 * The on-ramp: a backer buys coins, fiat moves in, coins are posted out. One path
 * every purchase runs, every time — the variety lives in the request's values (how
 * much fiat, how many coins, which wallet), never in a branch per kind of purchase
 * [LAW:dataflow-not-control-flow].
 */
export interface CoinOnRamp {
  buy(request: OnRampRequest): Promise<OnRampOutcome>;
}

/** The seams the on-ramp composes and the one platform account it draws coins
 *  from. The `mint` is the negative-allowed account whose balance IS the coins in
 *  circulation; crediting a wallet is a transfer out of it. It is fixed platform
 *  infrastructure, so it is configured once here, not passed per request. */
export interface OnRampDeps {
  readonly ledger: Ledger;
  readonly gateway: PaymentGateway;
  readonly mint: AccountId;
}

/**
 * Compose the on-ramp from the two seams it orchestrates: the `PaymentGateway`
 * that takes the fiat and the `Ledger` that mints the coins. This service computes
 * the *outcome*; it touches neither the PSP nor the money store itself, only
 * sequences the seams that do [LAW:effects-at-boundaries].
 *
 * The sequence is the whole basis of the money guarantee, and it is the mirror of
 * the spend path's: the spend posts coins first because the effect is recoverable,
 * but the on-ramp charges fiat FIRST because minting before the money is real would
 * create coins from nothing — the one thing the platform must never do. So: form
 * the mint movement (pure — a same-account routing error is caught here, before any
 * charge); take the fiat; only once the money is in, post the coins.
 *
 * Idempotency falls out of the two key-guarded seams, so there is NO completion log
 * here, unlike the spend-to-fire path: that path pairs a coin movement with a
 * *non-idempotent* effect (a shoutout fires once) and needs a log to gate it at most
 * once, whereas here both movements are idempotent under their own keys, so the unit
 * is idempotent by construction and a log would be a second authority over a fact the
 * seams already own [LAW:one-source-of-truth]. A faithful retry of a *completed*
 * purchase replays both receipts — charging the card and moving the mint exactly once;
 * a crash *before* the post runs heals the same way, since the post key is still unspent.
 *
 * The asymmetry the ledger draws: a post refused on a *money rule* spends its key, but
 * the on-ramp's mint can never overdraft, so its realistic refusal is an unopened wallet
 * — which spends no key. A `credit-refused` from a missing wallet therefore recovers
 * under the SAME post key once the wallet is opened, reusing the same charge key so the
 * fiat is not taken twice; only a genuine key conflict needs a fresh post key or a refund.
 * Either way the paid-but-uncredited backer is reconciled loudly, never a silent loss.
 */
export const createCoinOnRamp = ({ ledger, gateway, mint }: OnRampDeps): CoinOnRamp => {
  const buy = async (request: OnRampRequest): Promise<OnRampOutcome> => {
    // Pure, and before any charge: no fiat may be taken for a credit that could
    // never be formed (mint equals wallet) [LAW:no-silent-failure].
    const leg = transfer(mint, request.wallet, request.coins);
    if (!leg.ok) return { kind: 'invalid-routing', error: leg.error };

    const charged = await gateway.charge(request.charge);
    if (!charged.ok) return { kind: 'charge-declined', error: charged.error };

    const posted = await ledger.post({
      transfers: [leg.value],
      reason: request.reason,
      idempotencyKey: request.idempotencyKey,
    });
    // Carry the charge receipt so a paid-but-uncredited backer is reconcilable or
    // refundable, never a silent loss [LAW:no-silent-failure].
    if (!posted.ok) return { kind: 'credit-refused', charge: charged.value, error: posted.error };

    return { kind: 'purchased', charge: charged.value, receipt: posted.value };
  };

  return { buy };
};
