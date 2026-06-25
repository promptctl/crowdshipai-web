import { getChannelService } from '../server/channels';
import { isChannelLive } from '../server/stream';
import { createRealCatalog } from './real-catalog';
import type { CrowdCatalog } from './types';

/**
 * The single place the app decides which CrowdCatalog it runs against
 * [LAW:one-source-of-truth]. Every page reads through `getCatalog()`, so the choice
 * of source is a change here and nowhere else [LAW:single-enforcer].
 *
 * Production runs against the REAL catalog: it surfaces real claimed channels read
 * from the identity {@link ChannelService} (the single source of truth for which
 * channels exist), composing each builder's liveness from the stream provider — the
 * LiveKit room is the single authority for "is this builder broadcasting", injected
 * here as {@link isChannelLive} so the catalog never carries a flag that could drift
 * from reality [LAW:one-source-of-truth]. A claimed builder's handle therefore resolves
 * through `getCatalog().channel(handle)` so a viewer reaches `/watch/<handle>`, and
 * claimed builders populate the browse grid and the recruiter lens. The in-memory fake
 * (`createFakeCatalog`) stays as the test catalog behind the same seam [LAW:locality-or-seam].
 */
const catalog: CrowdCatalog = createRealCatalog(getChannelService(), isChannelLive);

export const getCatalog = (): CrowdCatalog => catalog;
