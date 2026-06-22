/**
 * The node/SQLite adapter for moderation — the durable side of the {@link AuditTrail}
 * seam, the moderation twin of `@crowdship/identity-node`. Moderation is a node-free
 * core; this package binds it to a real durable store so moderation history survives a
 * restart, with no change above the seam: `getAuditTrail()` builds a
 * {@link createSqliteAuditTrail} over an {@link openModerationDb} handle exactly where
 * it built the in-memory fake [LAW:locality-or-seam].
 */
export { openModerationDb } from './moderation-db.js';
export { createSqliteAuditTrail } from './sqlite-audit-trail.js';
