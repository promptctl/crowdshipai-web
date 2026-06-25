import { GENERAL_AUDIENCE } from '@crowdship/moderation';
import { handle, type Channel, type Handle } from '@crowdship/identity';

import { liveFirst } from './roster-order';
import type { ChannelSlug, ChannelView, CrowdCatalog, StreamSummary } from './types';

/**
 * The slice of the channel directory the catalog reads — exactly the two reads
 * discovery needs (the roster, and a lookup by public handle), and nothing of the
 * claim/rename/verify lifecycle [LAW:locality-or-seam]. `StandardChannelService`
 * satisfies this structurally, so the composition root hands the real service in and
 * a test hands the same real service in, neither knowing about a narrower shape.
 */
export interface ChannelDirectory {
  allChannels(): Promise<readonly Channel[]>;
  channelByHandle(handle: Handle): Promise<Channel | undefined>;
}

/**
 * A stable hue (0–360) derived from the handle — the placeholder thumbnail's accent
 * until real video exists. DERIVED, so the same channel always renders the same color
 * and the catalog never stores a hue that could drift from the identity it stands for
 * [LAW:one-source-of-truth]. The exact hash does not matter; that it is a pure function
 * of the handle does.
 */
const hueOf = (h: string): number => {
  let acc = 0;
  for (let i = 0; i < h.length; i += 1) acc = (acc * 31 + h.charCodeAt(i)) % 360;
  return acc;
};

/**
 * Project a claimed {@link Channel} (identity truth) onto the browse view model,
 * composing the one fact identity does not own — liveness — passed in from the stream
 * provider [LAW:one-source-of-truth]. The fields a fresh claim has not authored carry
 * honest "not declared yet" values, never invented ones [LAW:no-silent-failure]: a
 * channel that has not said what it is building has an empty `title`, no `tags`, and no
 * audience; its content rating defaults to the named `GENERAL_AUDIENCE` baseline, the
 * same value the age gate reads, never an absent field a reader must defend against
 * [LAW:no-defensive-null-guards]. Authoring those facts is a separate builder action
 * downstream (the stream's title, the menu); surfacing the claimed identity is this
 * catalog's whole job [LAW:decomposition].
 */
const toSummary = (channel: Channel, isLive: boolean): StreamSummary => ({
  slug: channel.handle,
  builderName: channel.profile.displayName,
  title: '',
  tags: [],
  viewerCount: 0,
  isLive,
  accentHue: hueOf(channel.handle),
  maturity: GENERAL_AUDIENCE,
});

const toView = (channel: Channel, isLive: boolean): ChannelView => ({
  stream: toSummary(channel, isLive),
  bio: channel.profile.bio,
  // A freshly-claimed channel has authored no menu yet — an empty menu, not a missing
  // one [LAW:dataflow-not-control-flow]. The menu-authoring path is downstream (menu
  // epic); until it lands there is nothing purchasable here, which `purchasable` reports
  // honestly rather than fabricating an offer.
  menu: [],
  // Chat is live, carried over the watch surface's event stream, not seeded history.
  chat: [],
});

/**
 * The production {@link CrowdCatalog}: the surfaced world read from REAL claimed
 * channels. It reads the channel directory (identity's single source of truth for which
 * channels exist) and composes each builder's liveness from the stream provider, so the
 * browse grid, channel page, and talent lens render real builders whose handles resolve
 * to owner accounts [LAW:one-source-of-truth]. It is selected at the one composition
 * point in `catalog.ts`, behind the same read seam the fake implements, so not one page
 * changes [LAW:single-enforcer][LAW:locality-or-seam].
 *
 * `purchasable` always resolves to null today: the menu-authoring path that gives a
 * claimed channel offers is a downstream ticket, and an absent menu is an honest "nothing
 * to buy here", never a fabricated offer [LAW:no-silent-failure].
 */
export const createRealCatalog = (
  channels: ChannelDirectory,
  isChannelLive: (slug: ChannelSlug) => Promise<boolean>,
): CrowdCatalog => ({
  roster: async () => {
    const all = await channels.allChannels();
    const summaries = await Promise.all(all.map(async (c) => toSummary(c, await isChannelLive(c.handle))));
    return summaries.sort(liveFirst);
  },

  channel: async (slug) => {
    // The slug arrives from an untrusted URL, so it crosses the handle trust boundary
    // here: a value that is not a well-formed handle names no claimed channel and
    // resolves to null, never a thrown guard [LAW:no-defensive-null-guards]. This is also
    // exactly why a hyphenated fake seed slug can never resolve through the real catalog —
    // it is not a valid handle — so the two namespaces stay disjoint by construction.
    const h = handle(slug);
    if (!h.ok) return null;
    const channel = await channels.channelByHandle(h.value);
    if (channel === undefined) return null;
    return toView(channel, await isChannelLive(slug));
  },

  purchasable: () => Promise.resolve(null),
});
