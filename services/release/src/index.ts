/**
 * Auto-release: the dataflow spine that settles a self-paying obligation. Given an
 * escrowed pledge, the engine observes the world — the pooled balance through the
 * `Ledger`, a deliverable's acceptance or a goal's resolution through the
 * `ObligationFacts` seam — and the instant the condition is met it settles the escrow to
 * the builder and skims the platform's cut through the `SettlementRail` [LAW:single-enforcer].
 * No human in the loop, no platform sitting on the money asking to be trusted: the
 * obligation pays itself out, atomically and idempotently.
 *
 * The rail is the seam that makes "custodial now, on-chain later" a choice of instance,
 * not a rewrite [LAW:locality-or-seam]: the engine names it and nothing under it, so a
 * trustless on-chain settlement lands behind the same interface with zero change to this
 * spine. It owns the one fact that must not split across stores — moving the coins and
 * recording that it happened — so a crash can never leave a pooled pledge believing it
 * never paid [LAW:one-source-of-truth].
 *
 * This is a service: it composes the settlement core (the pure pledge state machine and
 * the `isMet` predicate) with the ledger adapter (the coin movement), which may not
 * depend on each other, and the product surface drives it [LAW:one-way-deps]. The pure
 * judgment lives in the core; this layer only gathers the facts and performs the
 * consequence [LAW:effects-at-boundaries].
 */
export type {
  CutPolicy,
  Obligation,
  ObligationFacts,
  ReleaseEngine,
  ReleaseEngineDeps,
  ReleaseOutcome,
  Split,
} from './release.js';
export { createReleaseEngine } from './release.js';

export type { SettlementRail, SettleRequest } from './rail.js';
export { createCustodialRail } from './rail.js';
