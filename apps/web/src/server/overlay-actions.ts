'use server';

import { handle } from '@crowdship/identity';

import type { OverlayAuthorResult } from '../data/overlay-result';
import { DEFAULT_OVERLAY_STYLE, type OverlayStyle } from '../data/overlay-style';
import { getChannelService } from './channels';
import { announceOverlayStyle } from './live-feed';
import { performSetOverlay } from './overlay-author-core';
import { getOverlayStore } from './overlays';
import { currentPrincipal } from './principal';

/**
 * The overlay-restyle server action the studio's overlay form calls — the
 * `'use server'` edge over {@link performSetOverlay}, the overlay twin of
 * `setMenuAction`. WHO is restyling is decided HERE: the acting principal is resolved
 * from the session, and the channel the style binds to is that principal's own —
 * never a value the form supplies [LAW:single-enforcer]. The save and announce
 * capabilities are bound to the composition roots, so the style lands in the single
 * durable store every watcher reads back, and the nudge rides the one live spine
 * [LAW:one-source-of-truth].
 */
export async function setOverlayAction(
  _prev: OverlayAuthorResult | null,
  formData: FormData,
): Promise<OverlayAuthorResult> {
  return performSetOverlay(
    {
      principal: await currentPrincipal(),
      channelOf: (ownerId) => getChannelService().channelByOwner(ownerId),
      saveStyle: (channelId, style) => getOverlayStore().setStyle(channelId, style),
      announceStyle: (slug, style) => announceOverlayStyle(slug, style),
    },
    {
      placement: String(formData.get('placement') ?? ''),
      accentHue: String(formData.get('accentHue') ?? ''),
      durationSeconds: String(formData.get('durationSeconds') ?? ''),
    },
  );
}

/**
 * The authoritative overlay style of one channel — what the watch surface reads at
 * first paint and RE-READS on every live-subscription (re)open, so a style frame
 * missed during an attach gap can never leave a watcher on a stale look forever:
 * nudge over the feed, truth from this source [LAW:one-source-of-truth]. This read
 * edge is the ONE place storage absence resolves to the named default — a channel
 * whose builder never restyled, or a slug that names no channel (nothing will render
 * over it anyway), shows the baseline look, so no reader ever meets a missing style
 * [LAW:single-enforcer][LAW:no-defensive-null-guards].
 */
export async function overlayStyleOf(slug: string): Promise<OverlayStyle> {
  // The slug arrives from an untrusted URL, so it crosses the handle trust boundary
  // here, exactly as the catalog's channel read does.
  const h = handle(slug);
  if (!h.ok) return DEFAULT_OVERLAY_STYLE;
  const channel = await getChannelService().channelByHandle(h.value);
  if (channel === undefined) return DEFAULT_OVERLAY_STYLE;
  return (await getOverlayStore().styleOf(channel.id)) ?? DEFAULT_OVERLAY_STYLE;
}
