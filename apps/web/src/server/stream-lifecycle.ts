import type { Principal } from '@crowdship/identity';

import { getChannelService } from './channels';
import { announceStreamLifecycle } from './live-feed';
import { endPublishFor } from './stream';

/**
 * The ONE end-of-stream path [LAW:single-enforcer]. Every way a live session ends
 * server-side — the builder's explicit "end stream" action, the browser's stop-sharing
 * routed through the same action, and the pagehide beacon a closing tab fires — lands
 * HERE, so "what happens when a stream ends" (close the ingest, tell the watchers) has
 * exactly one answer and the two edges cannot drift apart [LAW:one-source-of-truth].
 *
 * Like the go-live edge, it identifies the channel from the SERVER's own read of the
 * acting principal — a builder can only ever end their OWN stream, and the beacon
 * route gets that guarantee by construction rather than by re-implementing it
 * [LAW:single-enforcer]. An unauthenticated or channel-less caller has no live ingest
 * of their own to close, so there is honestly nothing to do — an empty obligation, not
 * a swallowed failure [LAW:no-silent-failure].
 *
 * The "ended" announcement rides ONLY a real transition: `endPublishFor` reports
 * whether a live session was actually closed, and an end fired at an already-offline
 * channel broadcasts nothing — watchers never see a phantom ending
 * [LAW:no-silent-failure]. The announcement is the ephemeral nudge that flips a
 * watching badge the moment it happens; the broker's room state stays the single
 * liveness authority every render reads [LAW:one-source-of-truth].
 */
export const endLiveFor = async (principal: Principal | null): Promise<void> => {
  if (principal === null) return;
  const channel = await getChannelService().channelByOwner(principal.id);
  if (channel === undefined) return;
  const closed = await endPublishFor(channel.handle);
  if (closed) await announceStreamLifecycle(channel.handle, { phase: 'ended' });
};
