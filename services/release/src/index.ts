/**
 * Auto-release: the dataflow spine that settles a self-paying obligation. Given an
 * escrowed pledge, the engine observes the world — the pooled balance through the
 * `Ledger`, a deliverable's acceptance or a goal's resolution through the
 * `ObligationFacts` seam — and the instant the condition is met it releases the escrow
 * to the builder and skims the platform's cut through that same single `Ledger`
 * boundary [LAW:single-enforcer]. No human in the loop, no platform sitting on the money
 * asking to be trusted: the obligation pays itself out, atomically and idempotently.
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

export type { ReleaseLog, ReleaseRecord } from './release-log.js';
export { createInMemoryReleaseLog } from './release-log.js';
