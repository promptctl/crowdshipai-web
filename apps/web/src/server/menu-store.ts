import type { ChannelId } from '@crowdship/identity';
import type { Menu } from '@crowdship/menu';

import type { MenuReader } from '../data/menu-reader';

/**
 * Persistence for a builder's authored menu — the menu twin of identity's
 * `ChannelStore`, and the only axis along which menu storage varies
 * [LAW:locality-or-seam]. It extends the read-only {@link MenuReader} the catalog
 * depends on with the one write the authoring path needs: replace a channel's whole
 * menu. A menu is authored as a whole by the menu domain's `authorMenu` (one
 * validated {@link Menu} per submission), so the store writes a whole menu, never a
 * per-offer mutation that could leave a half-authored set [LAW:single-enforcer].
 *
 * The {@link Menu} handed in is already valid by construction — `authorMenu` is its
 * single trust boundary — so a store only persists and returns it, never re-validates
 * [LAW:types-are-the-program]. An in-memory map and a durable SQLite table are two
 * stores behind this one seam, so the authoring rules cannot drift between them.
 */
export interface MenuStore extends MenuReader {
  /** Replace the channel's menu with the given validated one (insert or overwrite). */
  setMenu(channelId: ChannelId, menu: Menu): Promise<void>;
}

/**
 * The reference {@link MenuStore}: an in-memory map keyed by {@link ChannelId}. The
 * walking-skeleton/test implementation a behavior test wires the real authoring path
 * and real catalog against; the durable {@link SqliteMenuStore} swaps in behind the
 * same seam without touching either [LAW:locality-or-seam]. It holds the authored
 * {@link Menu} by value, so what is read back is exactly what was authored.
 */
export class InMemoryMenuStore implements MenuStore {
  readonly #menus = new Map<ChannelId, Menu>();

  menuOf(channelId: ChannelId): Promise<Menu | undefined> {
    return Promise.resolve(this.#menus.get(channelId));
  }

  setMenu(channelId: ChannelId, menu: Menu): Promise<void> {
    this.#menus.set(channelId, menu);
    return Promise.resolve();
  }
}
