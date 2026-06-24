'use server';

import { randomUUID } from 'node:crypto';

import type { LiveKitConnection } from '../data/live-connection';
import type { GoLiveResult } from '../data/go-live-result';
import { getChannelService } from './channels';
import { performGoLive } from './go-live-core';
import { currentPrincipal } from './principal';
import { endPublishFor, publishConnectionFor, viewerConnectionFor } from './stream';

/**
 * The server action the watch surface calls to subscribe to a builder's live room.
 * It is the trust boundary where the API secret stays server-side: the browser receives
 * only the public wss URL and a short-lived subscribe-only token, never the signing key
 * [LAW:effects-at-boundaries][LAW:single-enforcer].
 *
 * The viewer's LiveKit identity is minted HERE, randomly, once per call — so any number
 * of viewers of the same builder coexist instead of evicting each other under LiveKit's
 * one-connection-per-identity rule. Randomness is an effect, so it lives at this edge,
 * not in the pure transport [LAW:effects-at-boundaries].
 *
 * Returns `null` when the app runs on the in-memory fake (no SFU) — the player reads that
 * honest absence as "not live yet" and shows the placeholder, never a fabricated token
 * [LAW:no-silent-failure].
 */
export async function viewerConnection(slug: string): Promise<LiveKitConnection | null> {
  return viewerConnectionFor(slug, `viewer:${randomUUID()}`);
}

/**
 * The go-live server action the builder's control calls — the `'use server'` edge over
 * {@link performGoLive}. It is the trust boundary where the API secret stays server-side
 * and where WHO may publish is decided: the acting principal is resolved here, the
 * channel slug is read from the SERVER's own lookup of that principal's channel (never a
 * value the client supplies), and the open-publish capability is bound to the provider
 * [LAW:single-enforcer][LAW:effects-at-boundaries]. The browser receives only the closed
 * {@link GoLiveResult}: a `{url, token}` to publish with, or an honest reason it cannot.
 */
export async function goLive(): Promise<GoLiveResult> {
  return performGoLive({
    principal: await currentPrincipal(),
    ownChannelSlug: async (accountId) => {
      const channel = await getChannelService().channelByOwner(accountId);
      return channel === undefined ? null : channel.handle;
    },
    openPublish: (slug) => publishConnectionFor(slug),
  });
}

/**
 * End this builder's live ingest — the explicit teardown the control fires on "end", on
 * the browser's stop-sharing, and on a remote disconnect. Like go-live it identifies the
 * room from the SERVER's read of the acting principal's channel, so a builder can only
 * end their OWN stream [LAW:single-enforcer]. An unauthenticated or channel-less caller
 * has no live ingest of their own to close, so there is honestly nothing to do — not a
 * swallowed failure but an empty obligation, and the broker's close is idempotent
 * regardless [LAW:no-silent-failure].
 */
export async function endLive(): Promise<void> {
  const principal = await currentPrincipal();
  if (principal === null) return;
  const channel = await getChannelService().channelByOwner(principal.id);
  if (channel === undefined) return;
  await endPublishFor(channel.handle);
}
