import type { Clock, Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

import type { ChannelRef, IngestEndpoint, IngestKey, StreamId } from './ids.js';
import type { IngestBroker, IngestProtocol, IngestSession, IngestTicket, OpenIngestError } from './ingest.js';

/**
 * The effects the in-memory broker needs supplied from its boundary — never reached
 * for ambiently [LAW:effects-at-boundaries]. Minting an id and minting a bearer key
 * are deliberately SEPARATE seams: an id need only be unique, a key must be
 * unguessable, and fusing them risks drawing a key from a non-CSPRNG id generator
 * [LAW:decomposition] — the same split identity draws between `IdMint` and `SecretMint`.
 * `endpointFor` is where the real provider's ingest URL would be computed; the fake
 * lets the boundary decide what it looks like. `unavailable` is the one test knob —
 * the analogue of the payment fake's `DeclinePolicy` — so the retryable
 * `provider-unavailable` arm is exercisable without a real, flaky network.
 */
export interface IngestBrokerDeps {
  readonly clock: Clock;
  newStreamId(): StreamId;
  newIngestKey(): IngestKey;
  endpointFor(channel: ChannelRef, protocol: IngestProtocol): IngestEndpoint;
  readonly unavailable?: (channel: ChannelRef, protocol: IngestProtocol) => boolean;
}

/**
 * The in-memory ingest broker: a fake media provider correct for a single process
 * and for tests, mirroring `createInMemoryPaymentGateway` and `createInMemoryLedger`
 * — the dev/test stand-in behind the {@link IngestBroker} seam that a real provider
 * binding replaces with no caller change [LAW:locality-or-seam].
 *
 * It models the one rule the boundary owns: a channel holds at most one open ingest
 * at a time. The session map is the single source of truth for "who is live"
 * [LAW:one-source-of-truth]; `open` consults it to refuse a double-open, and `close`
 * removes from it. The bearer key is minted, handed back once on the ticket, and NOT
 * retained — the fake holds no secret it would have to protect, exactly as identity
 * keeps no raw token; a real provider is the authority that validates the push.
 */
export const createInMemoryIngestBroker = (deps: IngestBrokerDeps): IngestBroker => {
  const sessions = new Map<StreamId, IngestSession>();

  const findByChannel = (channel: ChannelRef): IngestSession | null => {
    for (const session of sessions.values()) if (session.channel === channel) return session;
    return null;
  };

  const open = (
    channel: ChannelRef,
    protocol: IngestProtocol,
  ): Promise<Result<IngestTicket, OpenIngestError>> => {
    if (deps.unavailable?.(channel, protocol) === true) {
      return Promise.resolve(err({ kind: 'provider-unavailable' }));
    }
    const existing = findByChannel(channel);
    if (existing !== null) return Promise.resolve(err({ kind: 'already-live', streamId: existing.id }));

    const session: IngestSession = {
      id: deps.newStreamId(),
      channel,
      protocol,
      endpoint: deps.endpointFor(channel, protocol),
      openedAt: deps.clock.now(),
    };
    sessions.set(session.id, session);
    return Promise.resolve(ok({ session, key: deps.newIngestKey() }));
  };

  return {
    open,
    resolve: (stream) => Promise.resolve(sessions.get(stream) ?? null),
    forChannel: (channel) => Promise.resolve(findByChannel(channel)),
    close: (stream) => {
      sessions.delete(stream);
      return Promise.resolve();
    },
  };
};
