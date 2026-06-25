import { getChannelService } from '../server/channels';
import { getMenuStore } from '../server/menus';
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
 * claimed builders populate the browse grid and the recruiter lens. The builder's
 * authored menu is read through the {@link MenuStore} (the single source for which
 * offers a channel sells), so the watch surface's menu and the buy path both read real
 * offers [LAW:one-source-of-truth]. The in-memory fakes stay as the test
 * implementations behind the same seams [LAW:locality-or-seam].
 */
const catalog: CrowdCatalog = createRealCatalog(getChannelService(), getMenuStore(), isChannelLive);

export const getCatalog = (): CrowdCatalog => catalog;
