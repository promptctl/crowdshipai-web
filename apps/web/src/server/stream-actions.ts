'use server';

import { randomUUID } from 'node:crypto';

import { SystemClock } from '@crowdship/identity-node';
import { conductAction, type ConductAction } from '@crowdship/moderation';
import { show } from '@crowdship/std';

import type { LiveKitConnection } from '../data/live-connection';
import type { GoLiveResult } from '../data/go-live-result';
import { actorRefFor } from './actor-ref';
import { getAuditTrail } from './audit-trail';
import { getChannelService } from './channels';
import { performGoLive } from './go-live-core';
import { announceStreamLifecycle } from './live-feed';
import { getPolicyBoundary } from './policy';
import { currentPrincipal } from './principal';
import { conductStandingFor } from './sanctions';
import { performScreen } from './screen-core';
import { isChannelLive, publishConnectionFor, viewerConnectionFor } from './stream';
import { endLiveFor } from './stream-lifecycle';

// The one conduct action this edge screens. Minted once from a literal, so a blank can
// only be a programming error, surfaced loudly at module load [LAW:no-silent-failure].
const GO_LIVE_ACTION: ConductAction = (() => {
  const action = conductAction('go-live');
  if (!action.ok) throw new Error(`stream-actions: invalid conduct action: ${show(action.error)}`);
  return action.value;
})();

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
 * Is this channel live right now? — the watch surface's re-read of the ONE liveness
 * authority (the ingest broker's room state) [LAW:one-source-of-truth]. The live-feed
 * spine is ephemeral by contract: a lifecycle frame published while a watcher's
 * subscription was still attaching (or during an EventSource auto-reconnect) is gone
 * forever, so the surface re-reads THIS on every subscription (re)open and converges on
 * the truth instead of trusting it missed nothing [LAW:no-ambient-temporal-coupling].
 */
export async function channelLive(slug: string): Promise<boolean> {
  return isChannelLive(slug);
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
  let liveSlug: string | null = null;
  const result = await performGoLive({
    principal: await currentPrincipal(),
    // The conduct gate before the ingest ever opens: the actor's standing (their
    // governing sanction collapsed against now) is screened through the ONE policy
    // boundary, and a deny is ALREADY recorded to the durable trail by the screen —
    // this edge only refuses; deciding and recording live behind their own seams
    // [LAW:single-enforcer] [LAW:effects-at-boundaries].
    screenConduct: async (actor) =>
      performScreen(
        { boundary: getPolicyBoundary(), audit: getAuditTrail() },
        {
          kind: 'actor-conduct',
          actor: actorRefFor(actor),
          action: GO_LIVE_ACTION,
          standing: await conductStandingFor(actor.id, new SystemClock()),
        },
      ),
    ownChannelSlug: async (accountId) => {
      const channel = await getChannelService().channelByOwner(accountId);
      return channel === undefined ? null : channel.handle;
    },
    openPublish: async (slug) => {
      const handoff = await publishConnectionFor(slug);
      // Remember which channel actually opened, so the announcement below mirrors the
      // broker's own transition — the room state stays the liveness authority; the
      // frame only spares watchers the wait for a reload [LAW:one-source-of-truth].
      if (handoff.kind === 'ready') liveSlug = slug;
      return handoff;
    },
  });
  if (liveSlug !== null) await announceStreamLifecycle(liveSlug, { phase: 'live' });
  return result;
}

/**
 * End this builder's live ingest — the explicit teardown the control fires on "end", on
 * the browser's stop-sharing, and on a remote disconnect. The whole of what ending
 * means (only your OWN stream; close the ingest; tell the watchers) lives in the one
 * shared end path, which the closing tab's beacon route also rides — the action is
 * just its `'use server'` face [LAW:one-source-of-truth] [LAW:single-enforcer].
 */
export async function endLive(): Promise<void> {
  await endLiveFor(await currentPrincipal());
}
