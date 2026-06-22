/**
 * Cross-cutting primitives with one home [LAW:one-source-of-truth]: the nominal
 * `Brand`, the `Result` of a fallible operation, and `CoinAmount` — the
 * platform's unit of value. They belong to no domain — identity, ledger, menu,
 * and settlement all stand on them — so they live here rather than in any one
 * domain package, and nothing here may import a domain [LAW:one-way-deps].
 *
 * NOTE: `@crowdship/ledger-kernel` predates this package and carries its own
 * copies of `Brand`, `Result`, `Timestamp`, and the `nonBlank` id constructor.
 * That duplication is a known, transitional divergence: ledger-kernel should
 * source these from here. It cannot adopt `nonBlank` until its `Brand` is the
 * one in this package (its ids are branded with the kernel-local symbol, which
 * `nonBlank` here cannot mint), so the two cleanups are one focused pass — left
 * deliberately for that pass rather than smuggled into unrelated work.
 */
export type { Brand } from './brand.js';
export type { Result } from './result.js';
export { err, ok } from './result.js';
export type { Clock, Timestamp, TimestampError } from './time.js';
export { timestamp } from './time.js';
export type { CoinAmount, CoinAmountError } from './money.js';
export { coinAmount } from './money.js';
export type { BlankError } from './nonblank.js';
export { nonBlank } from './nonblank.js';
