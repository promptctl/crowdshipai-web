import type { ChannelId } from '@crowdship/identity';

import type { OverlayStyle } from '../data/overlay-style';

/**
 * Persistence for a builder's authored overlay style — the overlay twin of
 * {@link import('./menu-store').MenuStore}, and the only axis along which overlay
 * storage varies [LAW:locality-or-seam]. The style handed in is already valid by
 * construction (it crossed the one style validator at the authoring boundary), so a
 * store only persists and returns it, never re-judges it [LAW:types-are-the-program].
 *
 * `styleOf` returns `undefined` for a channel whose builder has never authored a
 * style — the honest STORAGE absence. Resolving that absence to the named default is
 * the read edge's job, in exactly one place, so no reader ever meets a missing style
 * [LAW:single-enforcer][LAW:no-defensive-null-guards].
 */
export interface OverlayStore {
  styleOf(channelId: ChannelId): Promise<OverlayStyle | undefined>;
  /** Replace the channel's overlay style with the given validated one (insert or overwrite). */
  setStyle(channelId: ChannelId, style: OverlayStyle): Promise<void>;
}

/**
 * The reference {@link OverlayStore}: an in-memory map keyed by {@link ChannelId} —
 * the walking-skeleton/test implementation the behavior tests wire the real authoring
 * path against; the durable {@link import('./sqlite-overlay-store').SqliteOverlayStore}
 * swaps in behind the same seam without touching either [LAW:locality-or-seam].
 */
export class InMemoryOverlayStore implements OverlayStore {
  readonly #styles = new Map<ChannelId, OverlayStyle>();

  styleOf(channelId: ChannelId): Promise<OverlayStyle | undefined> {
    return Promise.resolve(this.#styles.get(channelId));
  }

  setStyle(channelId: ChannelId, style: OverlayStyle): Promise<void> {
    this.#styles.set(channelId, style);
    return Promise.resolve();
  }
}
