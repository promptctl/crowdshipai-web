/**
 * Transparent settlement events — the release happens in view of the stream. Settlement is
 * spectacle: everyone watching sees the escrow fill, the builder paid, and the cut skimmed.
 * Visibility is a feature, not a side effect.
 *
 * This service holds no record of its own. The feed is a pure projection of the ledger's
 * own recorded history of an obligation's escrow account [LAW:one-source-of-truth]: each
 * credit is a backer's contribution (carrying the running pooled total — the live ticker),
 * each debit the builder's release share or the platform's cut. So the audience watches the
 * very money facts the ledger settled, never a parallel tally that could drift from them.
 *
 * It composes the ledger's read/audit seam (`LedgerQuery`) and nothing else; the pool that
 * fills the escrow and the engine that releases it are upstream services the product surface
 * drives, never imported here [LAW:one-way-deps]. The release engine's once-per-release
 * signal is the natural nudge for a live re-render, but the feed itself stays a projection —
 * idempotent, replayable, with no exactly-once effect of its own [LAW:effects-at-boundaries].
 *
 * The feed is the MONEY's story for ONE obligation: it is read per-escrow, so its identity is
 * the caller's — the surface already holds which pool it queried, and merging several pools'
 * feeds into one channel timeline is a caller-side tag, not a field minted here [LAW:decomposition].
 * The obligation's LIFECYCLE (when it was escrowed, met, released) is the pledge's story, a
 * different part the release outcome already carries; it is deliberately not re-derived into the
 * money feed, which speaks only in the instants its movements were actually recorded.
 */
export type { SettlementEvent, SettlementRoles } from './feed.js';
export { projectSettlement, settlementFeed } from './feed.js';
