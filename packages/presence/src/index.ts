/**
 * Stream presence — the source of truth for how many viewers are watching a build
 * right now. One seam between the side that marks a viewer present (the watch
 * connection opening) and the side that reads the count (the overlay), created as an
 * interface so neither reaches into the other [LAW:locality-or-seam]. This is core —
 * vendor- and framework-free, standing only on `@crowdship/std`; a real cross-instance
 * presence backend (a Redis set, a presence service) binds the {@link PresenceRegistry}
 * seam from an adapter later, and the watch surface reads the count off it; they are
 * not it.
 *
 * The count is DERIVED from one authoritative occupancy, never a second tally that
 * could disagree [LAW:one-source-of-truth] — the distinction that keeps a viewer count
 * off the best-effort live feed, where a dropped join/leave would corrupt it. The live
 * feed only CARRIES the already-derived count to watchers; this registry owns it.
 */
export type { PresenceTopic } from './topic.js';
export { presenceTopic } from './topic.js';

export type { PresenceHandle, PresenceRegistry } from './registry.js';

export { createInMemoryPresenceRegistry } from './in-memory-registry.js';
