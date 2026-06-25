import { isChannelLive } from '../server/stream';
import { createFakeCatalog } from './fake-catalog';
import type { CrowdCatalog } from './types';

/**
 * The single place the app decides which CrowdCatalog it runs against
 * [LAW:one-source-of-truth]. Every page reads through `getCatalog()`, so
 * swapping the in-memory fake for real services is a one-line change here and
 * nowhere else [LAW:single-enforcer].
 *
 * The catalog's static seed knows a builder's identity, title, and menu, but NOT
 * whether they are live — liveness is the stream provider's truth, not the
 * catalog's. So this composition root injects {@link isChannelLive} (backed by the
 * LiveKit room, the single authority) and the fake assembles each {@link StreamSummary}'s
 * `isLive` from it, never from a hand-set flag that could disagree with reality
 * [LAW:one-source-of-truth]. A real catalog backed by real services swaps in here the
 * same way, and not one page changes [LAW:locality-or-seam].
 */
const catalog: CrowdCatalog = createFakeCatalog(isChannelLive);

export const getCatalog = (): CrowdCatalog => catalog;
