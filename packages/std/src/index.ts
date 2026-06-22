/**
 * Cross-cutting primitives with one home [LAW:one-source-of-truth]: the nominal
 * `Brand` and the `Result` of a fallible operation. They belong to no domain —
 * identity, ledger, menu, and settlement all stand on them — so they live here
 * rather than in any one domain package, and nothing here may import a domain
 * [LAW:one-way-deps].
 *
 * NOTE: `@crowdship/ledger-kernel` predates this package and carries its own
 * copies of `Brand`, `Result`, and `Timestamp`. That duplication is a known,
 * transitional divergence: ledger-kernel should re-export these from here. The
 * engine decision it once waited on is settled (the ledger runs on TigerBeetle),
 * so the remaining blocker is gone — this is now a small, safe cleanup left for a
 * focused pass rather than smuggled into the engine adoption.
 */
export type { Brand } from './brand.js';
export type { Result } from './result.js';
export { err, ok } from './result.js';
export type { Clock, Timestamp, TimestampError } from './time.js';
export { timestamp } from './time.js';
