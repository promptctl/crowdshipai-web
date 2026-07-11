import { getIdentityDb } from './identity';
import type { OverlayStore } from './overlay-store';
import { SqliteOverlayStore } from './sqlite-overlay-store';

/**
 * The single place the web app composes the {@link OverlayStore}
 * [LAW:single-enforcer] — the overlay twin of `getMenuStore()`. It runs over the SAME
 * identity DB handle, so a builder's channel, menu, and overlay style live in one
 * store keyed by one channel id, never two that could disagree about whose look this
 * is [LAW:one-source-of-truth]. The overlay table's schema is owned by the durable
 * store itself, not identity's schema, so this sharing is of a connection, not of a
 * concern [LAW:decomposition].
 */
const build = (): OverlayStore => new SqliteOverlayStore(getIdentityDb());

// One overlay store per process, over the shared identity handle. Cached on
// globalThis so Next.js dev HMR reuses it, the same discipline getMenuStore follows.
const globalForOverlays = globalThis as unknown as { __crowdshipOverlays?: OverlayStore };
const overlayStore: OverlayStore = globalForOverlays.__crowdshipOverlays ?? build();
if (process.env.NODE_ENV !== 'production') globalForOverlays.__crowdshipOverlays = overlayStore;

export const getOverlayStore = (): OverlayStore => overlayStore;
