import type { ChannelId } from '@crowdship/identity';
import type { Menu } from '@crowdship/menu';

/**
 * The single read the catalog needs of a builder's authored menu: the authoritative
 * domain {@link Menu} for one channel, or `undefined` when that builder has authored
 * none yet [LAW:locality-or-seam]. Keyed by the stable {@link ChannelId}, never the
 * handle — a builder may rename their handle, but their menu follows the channel
 * identity, so a rename never orphans the offers [LAW:one-source-of-truth].
 *
 * This is exactly the slice discovery depends on and nothing of the authoring/write
 * lifecycle [LAW:decomposition]: the real catalog reads through this port, while the
 * builder's authoring path writes through the wider `MenuStore` that extends it. A
 * fresh channel with no menu is an honest `undefined`, which the catalog reports as an
 * empty menu and "nothing purchasable", never a fabricated offer [LAW:no-silent-failure].
 */
export interface MenuReader {
  menuOf(channelId: ChannelId): Promise<Menu | undefined>;
}
