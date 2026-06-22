import type { Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

import { chargeReference } from './gateway.js';
import type {
  ChargeDeclined,
  ChargeKey,
  ChargeReceipt,
  FiatCharge,
  PaymentGateway,
} from './gateway.js';

/**
 * How a fake PSP decides a charge: return the way it should be declined, or
 * `undefined` to take the money. This is the one knob a test turns to exercise
 * the on-ramp's failure arms — a card refusal, an unreachable gateway — without
 * a real network. The default (no policy) approves every charge.
 */
export type DeclinePolicy = (charge: FiatCharge) => ChargeDeclined | undefined;

/**
 * The in-memory payment gateway: a fake PSP that is correct for a single process
 * and for tests, mirroring `createInMemoryLedger` — the dev/test stand-in behind
 * the `PaymentGateway` seam that the production Stripe binding will later replace
 * with no caller change [LAW:locality-or-seam].
 *
 * It models the one property the on-ramp leans on for its idempotency: a charge
 * is recorded by its `ChargeKey` and *replayed*, never re-run. Re-charging under
 * a spent key reproduces the first outcome — the same receipt for a success, the
 * same refusal for a decline — so a retry of a whole purchase can never take the
 * money twice [LAW:no-silent-failure]. The record-by-key is synchronous, so even
 * concurrent retries of one key resolve to the same stored outcome; the fake
 * needs no lock of its own. A success's reference is derived from the key, so it
 * too is stable across replays.
 */
export const createInMemoryPaymentGateway = (decide?: DeclinePolicy): PaymentGateway => {
  const seen = new Map<ChargeKey, Result<ChargeReceipt, ChargeDeclined>>();

  const settle = (charge: FiatCharge): Result<ChargeReceipt, ChargeDeclined> => {
    const declined = decide?.(charge);
    if (declined !== undefined) return err(declined);

    const reference = chargeReference(`psp-ref:${charge.key}`);
    // The key is a non-blank brand, so the derived reference is non-blank too; a
    // failure here would mean a broken invariant upstream, so it halts loudly
    // rather than being papered over [LAW:no-silent-failure].
    if (!reference.ok) throw new Error(`charge key produced a blank reference: ${charge.key}`);
    return ok({ reference: reference.value, amount: charge.amount, currency: charge.currency });
  };

  return {
    charge: (charge) => {
      const replay = seen.get(charge.key);
      if (replay !== undefined) return Promise.resolve(replay);
      const outcome = settle(charge);
      seen.set(charge.key, outcome);
      return Promise.resolve(outcome);
    },
  };
};
