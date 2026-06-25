import { GENERAL_AUDIENCE } from '@crowdship/moderation';
import { handle, type Channel, type Handle } from '@crowdship/identity';
import { findOffer, offerId } from '@crowdship/menu';

import type { MenuReader } from './menu-reader';
import { toMenuView } from './menu-view';
import { liveFirst } from './roster-order';
import type { ChannelSlug, ChannelView, CrowdCatalog, PricedOffer, StreamSummary } from './types';

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

const toView = (channel: Channel, isLive: boolean, menu: readonly PricedOffer[]): ChannelView => ({
  stream: toSummary(channel, isLive),
  bio: channel.profile.bio,
  // The builder's authored menu, projected from their stored domain menu — or an empty
  // menu when they have authored none yet, an honest empty value, never a missing one
  // [LAW:dataflow-not-control-flow]. The same stored menu drives `purchasable`, so what
  // a backer sees and what the ledger charges read from one source [LAW:one-source-of-truth].
  menu,
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
 * `purchasable` reads the builder's authored menu from the {@link MenuReader} and
 * resolves the chosen offer against it — the SAME domain menu the channel view projects
 * for display, so display and charge agree [LAW:one-source-of-truth]. A channel whose
 * builder has authored no menu has nothing to buy: an honest null, never a fabricated
 * offer [LAW:no-silent-failure].
 */
export const createRealCatalog = (
  channels: ChannelDirectory,
  menus: MenuReader,
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
    // The menu follows the stable channel id, not the handle. An absent menu projects to
    // an empty one, never a special-cased branch [LAW:dataflow-not-control-flow].
    const menu = await menus.menuOf(channel.id);
    const view = menu === undefined ? [] : toMenuView(menu);
    return toView(channel, await isChannelLive(slug), view);
  },

  purchasable: async (slug, rawOfferId) => {
    const h = handle(slug);
    if (!h.ok) return null;
    const channel = await channels.channelByHandle(h.value);
    if (channel === undefined) return null;
    const menu = await menus.menuOf(channel.id);
    if (menu === undefined) return null;
    // A blank/malformed offer id from an untrusted request resolves to "no such offer",
    // never a thrown guard [LAW:no-defensive-null-guards]; a valid id resolves to the one
    // offer it names or nothing — findOffer's unique-by-construction contract. The domain
    // offer returned is exactly what the purchase pipeline charges against.
    const id = offerId(rawOfferId);
    if (!id.ok) return null;
    return findOffer(menu, id.value) ?? null;
  },
});
