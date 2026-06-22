/**
 * Cross-cutting primitives with one home [LAW:one-source-of-truth]: the nominal
 * `Brand` and the `Result` of a fallible operation. They belong to no domain —
 * identity, ledger, menu, and settlement all stand on them — so they live here
 * rather than in any one domain package, and nothing here may import a domain
 * [LAW:one-way-deps].
 *
 * NOTE: `@crowdship/ledger-kernel` predates this package and carries its own
 * copies of `Brand`, `Result`, and `Timestamp`. That duplication is a known, transitional
 * divergence — when the ledger work resumes (it is paused pending the
 * adopt-an-engine decision) ledger-kernel should re-export these from here. It
 * is left alone for now deliberately, not by oversight: churning paused,
 * possibly-to-be-replaced money code to dedup two trivial type aliases would
 * trade real risk for little gain.
 */
export type { Brand } from './brand.js';
export type { Result } from './result.js';
export { err, ok } from './result.js';
export type { Clock, Timestamp, TimestampError } from './time.js';
export { timestamp } from './time.js';
