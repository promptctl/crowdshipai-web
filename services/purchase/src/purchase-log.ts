import type { PostReceipt } from '@crowdship/ledger';
import type { IdempotencyKey } from '@crowdship/ledger-kernel';
import type { EffectReceipt } from '@crowdship/menu';

/**
 * The record of a purchase that ran to completion under its idempotency key: the
 * coins moved AND the effect fired. It carries both receipts so a replay of the
 * same purchase returns the identical result the first call produced.
 */
export interface CompletedPurchase {
  readonly receipt: PostReceipt;
  readonly effect: EffectReceipt;
}

/**
 * The authority for the one question the ledger cannot answer: *has this purchase's
 * effect already been delivered?* The ledger knows only whether the coins moved —
 * its idempotency makes the charge replay-safe — but a charge can replay with the
 * effect still unfired (the first attempt's effect failed, or the process died
 * between charge and effect). Conflating "coins moved before" with "effect fired
 * before" is how a paid effect gets silently dropped on retry [LAW:no-silent-failure],
 * so the fact lives here, in its own single authority [LAW:one-source-of-truth],
 * never inferred from the ledger's replay flag.
 *
 * Only *successful* completions are recorded: a key with no record is a purchase
 * whose effect still needs firing (never attempted, or last attempt failed), so a
 * retry re-fires it; a key with a record already fired, so a retry returns the
 * recorded result and never fires twice. This is the menu epic's `Ledger`-style
 * seam: an in-memory implementation now, a durable one behind the same interface
 * for crash-recovery across processes later [LAW:locality-or-seam].
 */
export interface PurchaseLog {
  /** The completed record for a key, or `undefined` if this purchase's effect has
   *  not yet fired (so a retry must attempt it). */
  completed(key: IdempotencyKey): Promise<CompletedPurchase | undefined>;
  /** Record that a key's purchase fully completed — coins moved and effect fired.
   *  Recording the same completion again is harmless; only success is ever recorded. */
  record(key: IdempotencyKey, completed: CompletedPurchase): Promise<void>;
}

/**
 * The in-memory purchase log: correct for a single process and for tests, holding
 * exactly the completions recorded so far. A durable, shared implementation — the
 * one that lets a *different* process or a post-crash retry see what already fired —
 * slots in behind this same seam with no caller change, exactly as the ledger's
 * in-memory fake gives way to TigerBeetle [LAW:locality-or-seam].
 */
export const createInMemoryPurchaseLog = (): PurchaseLog => {
  const done = new Map<IdempotencyKey, CompletedPurchase>();
  return {
    completed: (key) => Promise.resolve(done.get(key)),
    record: (key, completed) => {
      done.set(key, completed);
      return Promise.resolve();
    },
  };
};
