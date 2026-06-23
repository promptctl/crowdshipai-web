/**
 * Shared node-runtime primitives the durable adapters stand on: the `node:sqlite`
 * engine loaded once past bundler static analysis, the trust-boundary readers over the
 * rows it returns, and the unwrap-or-halt helper for constructions that cannot
 * legitimately fail. These idioms were each duplicated across the identity, ledger, and
 * moderation node adapters; an adapter may not depend on a sibling adapter
 * [LAW:one-way-deps], so their one correct home is this node-runtime package, below the
 * adapters and above the framework-free cores.
 */
export { DatabaseSync } from './sqlite.js';
export type { StatementSync } from './sqlite.js';
export { reqStr, reqInt, reqBytes } from './rows.js';
export { orThrow } from './result.js';
