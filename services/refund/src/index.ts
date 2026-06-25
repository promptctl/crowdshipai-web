/**
 * Refund — the failure mode of a self-paying obligation, designed like the success path. When
 * a condition is not met or is contested, the escrow does not just sit; it returns to the
 * backers who funded it by an explicit, auditable path, our cut never taken on coins that were
 * never earned. The mirror of `@crowdship/release`: release settles a met obligation FORWARD
 * to the builder, this settles an unmet or disputed one BACK to its backers.
 *
 * The engine is a thin dataflow spine over two seams: the ledger's read/audit surface
 * (`LedgerQuery`) — whose recorded escrow history IS the contributor ledger, so the refund
 * needs no second list of who-funded-what [LAW:one-source-of-truth] — and the `SettlementRail`
 * it shares with the release engine, under the `refund` purpose so the two directions never
 * collide [LAW:one-way-deps]. The judgment of WHETHER to refund is the dispute/expiry policy's;
 * this layer only performs the consequence, atomically and idempotently [LAW:effects-at-boundaries].
 */
export type {
  RefundEngine,
  RefundEngineDeps,
  RefundOutcome,
  Refundable,
} from './refund.js';
export { createRefundEngine } from './refund.js';
