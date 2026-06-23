import type { Result, Timestamp } from '@crowdship/std';
import { err, ok, timestamp } from '@crowdship/std';
import {
  channelRef,
  ingestKey,
  ingestProtocol,
  streamId,
  type ChannelRef,
  type IngestBroker,
  type IngestEndpoint,
  type IngestProtocol,
  type IngestSession,
  type IngestTicket,
  type OpenIngestError,
  type StreamId,
} from '@crowdship/stream';
import type { Room } from 'livekit-server-sdk';
import { RoomServiceClient, TwirpError } from 'livekit-server-sdk';

import type { LiveKitTokenSigner } from './access.js';

/**
 * The slice of LiveKit's `RoomServiceClient` this adapter actually calls — exactly as
 * wide as the IngestBroker port needs and no wider [LAW:decomposition]. A real
 * `RoomServiceClient` satisfies this structurally, so the app passes one straight in;
 * a test passes a stub with the same shape. Typing it against the SDK's own `Room`
 * means the compiler checks this translation against LiveKit's real surface
 * [LAW:types-are-the-program].
 */
export interface LiveKitRooms {
  createRoom(options: {
    name: string;
    metadata?: string;
    emptyTimeout?: number;
    departureTimeout?: number;
  }): Promise<Room>;
  listRooms(names?: string[]): Promise<Room[]>;
  updateRoomMetadata(room: string, metadata: string): Promise<Room>;
  deleteRoom(room: string): Promise<void>;
}

/**
 * Construct the real LiveKit room service from the project's https host and API
 * credentials. The vendor SDK is imported only here, inside the adapter, so the app
 * composition root depends on this seam and never on livekit-server-sdk directly
 * [LAW:one-way-deps]. The host is the project's https endpoint (the wss URL with its
 * scheme swapped); the secret is server-only and arrives from env at the boundary
 * [LAW:effects-at-boundaries].
 */
export const liveKitRooms = (httpUrl: string, apiKey: string, apiSecret: string): LiveKitRooms =>
  new RoomServiceClient(httpUrl, apiKey, apiSecret);

/**
 * Everything the LiveKit broker needs supplied from its boundary [LAW:effects-at-boundaries].
 * `rooms` and `sign` are the two LiveKit capabilities (query/teardown rooms, mint
 * tokens); `url` is the address livekit-client connects to (the provider's wss URL),
 * handed to the builder verbatim as the ingest endpoint. `publisherIdentity` is the
 * builder's stable participant identity for a channel — deterministic on purpose, so a
 * re-open evicts the prior CONNECTION under LiveKit's one-connection-per-identity rule.
 * Note the bound: that rule guarantees at most one live PUBLISHER, not at most one open
 * ticket — `open`'s `already-live` refusal is a best-effort read-then-create (LiveKit's
 * `createRoom` is idempotent, not exclusive, so concurrent opens can both succeed), and
 * the provider is the final authority on who is actually broadcasting [LAW:single-enforcer].
 * The timeouts are how long LiveKit keeps an idle room.
 */
export interface LiveKitIngestDeps {
  readonly rooms: LiveKitRooms;
  readonly sign: LiveKitTokenSigner;
  readonly url: IngestEndpoint;
  readonly ttlSeconds: number;
  readonly emptyTimeoutSeconds?: number;
  readonly departureTimeoutSeconds?: number;
  publisherIdentity(channel: ChannelRef): string;
}

/**
 * The room a channel publishes into and viewers subscribe to. The opaque `ChannelRef` is
 * used VERBATIM as the room name — no second mapping is invented, so the room name has one
 * source of truth [LAW:one-source-of-truth] and `readSession` can reconstruct the channel
 * from `room.name` exactly. This makes room-name-safety a REQUIREMENT on the ChannelRef
 * (a LiveKit room name is embedded in bearer tokens): the caller that mints a ChannelRef
 * from a builder principal — the ingest-open flow, evf.1.2 — owns keeping it safe, the same
 * composition point the `ChannelRef` doc names. Exported so the viewer transport (evf.2.1)
 * names the SAME room the builder publishes to without re-deriving it.
 */
export const roomNameOf = (channel: ChannelRef): string => channel;

/**
 * Mint a subscribe-only token for a viewer of `channel` — the shared-auth seam evf.2.1
 * reuses. It routes through the SAME signer the broker's `open` uses, so publish and
 * subscribe share ONE auth enforcer, never two that could drift [LAW:single-enforcer].
 * The viewer identity is unique per viewer (many viewers coexist), unlike the builder's
 * stable identity; both name the same room via {@link roomNameOf}.
 */
export const mintSubscribeToken = (
  sign: LiveKitTokenSigner,
  channel: ChannelRef,
  viewerIdentity: string,
  ttlSeconds: number,
): Promise<string> =>
  sign({ room: roomNameOf(channel), identity: viewerIdentity, access: 'subscribe', ttlSeconds });

const must = <T>(result: Result<T, unknown>, what: string): T => {
  if (!result.ok) throw new Error(`livekit: ${what}`);
  return result.value;
};

// The room's creation time is the provider's, so the session's openedAt is read back
// from it rather than re-stamped — the provider is the single source of truth for when
// the ingest opened [LAW:one-source-of-truth]. A creation time LiveKit cannot express
// as a safe epoch-ms is a broken provider invariant, surfaced loudly, never papered
// over with "now" [LAW:no-silent-failure].
const openedAtOf = (room: Room): Timestamp => {
  const at = timestamp(Number(room.creationTimeMs));
  if (!at.ok) throw new Error(`livekit: room ${room.name} reported an invalid creation time ${room.creationTimeMs}`);
  return at.value;
};

// The retryable arm — the provider was unreachable or erroring on its side, the mirror of
// Stripe's gateway-unavailable — is a CLOSED set: a TwirpError the provider itself marks
// retryable, or a network-level failure to reach it at all. Everything else (a bad key, a
// malformed request, a programming bug like a TypeError) is NOT a transient outage and must
// surface loudly rather than masquerade as one and retry forever — the same rethrow-the-
// unrecognized discipline the Stripe binding uses, not an assume-transient default [LAW:no-silent-failure].
const isProviderUnreachable = (cause: unknown): boolean => {
  if (cause instanceof TwirpError) return cause.status >= 500 || cause.code === 'unavailable';
  // A fetch that never reached the provider: undici throws a TypeError whose `cause` carries
  // a Node system error code (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, EAI_AGAIN, …); an aborted
  // or timed-out request throws a DOMException named AbortError/TimeoutError.
  if (cause instanceof Error) {
    if (cause.name === 'AbortError' || cause.name === 'TimeoutError') return true;
    const sysCode = (cause as { cause?: { code?: unknown } }).cause?.code;
    if (typeof sysCode === 'string' && sysCode.startsWith('E')) return true;
    if (cause.message.includes('fetch failed')) return true;
  }
  return false;
};

const isNotFound = (cause: unknown): boolean =>
  cause instanceof TwirpError && (cause.status === 404 || cause.code === 'not_found');

const classifyOpen = (cause: unknown): OpenIngestError => {
  if (isProviderUnreachable(cause)) return { kind: 'provider-unavailable' };
  throw cause;
};

/**
 * The production ingest broker: a thin adapter binding LiveKit behind the
 * {@link IngestBroker} seam [LAW:locality-or-seam] — what `createStripePaymentGateway`
 * is to the in-memory payment fake and `TigerBeetleLedger` is to the in-memory ledger,
 * a different INSTANCE of one type swapped in with no caller change [LAW:one-type-per-behavior].
 * It only translates the domain operation into LiveKit's vocabulary and LiveKit's answer
 * back; LiveKit, not us, is the single source of truth for whether a room exists and
 * validates every token [LAW:single-enforcer].
 *
 * The mapping mirrors the in-memory broker exactly — "a session exists in the map"
 * becomes "a room exists carrying our ingest metadata":
 *   open    -> refuse if the channel's room already exists (already-live), else create
 *              it and mint a publish token; the room IS the session.
 *   resolve / forChannel -> read the room back; a room provisioned by us is a session,
 *              a room never opened (or auto-created by an early viewer, hence carrying no
 *              metadata) is honestly `null`.
 *   close   -> delete the room; deleting an already-gone room is idempotent success.
 *
 * The returned endpoint is the provider's wss URL livekit-client publishes to (the v1
 * browser screen-capture path, evf.1.2); WHIP/RTMP *encoder* ingress maps to LiveKit's
 * Ingress API and is a follow-up that resolves a per-protocol endpoint behind this same
 * seam — the requested protocol is recorded truthfully on the session and in room
 * metadata, never silently ignored [LAW:no-silent-failure].
 */
export const createLiveKitIngestBroker = (deps: LiveKitIngestDeps): IngestBroker => {
  // A room provisioned by us carries its protocol in metadata; that is what makes it an
  // ingest session rather than a bare room. Empty metadata means "a room exists but we
  // did not open it as an ingest" -> honestly not a session. Present-but-unreadable
  // metadata is corruption or version skew and is surfaced loudly [LAW:no-silent-failure].
  const readSession = (room: Room): IngestSession | null => {
    if (room.metadata === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(room.metadata);
    } catch {
      throw new Error(`livekit: room ${room.name} carries unparseable ingest metadata`);
    }
    const raw = (parsed as { protocol?: unknown }).protocol;
    if (typeof raw !== 'string') throw new Error(`livekit: room ${room.name} ingest metadata has no protocol`);
    const protocol = ingestProtocol(raw);
    if (!protocol.ok) throw new Error(`livekit: room ${room.name} carries unknown ingest protocol '${raw}'`);
    return {
      id: must(streamId(room.name), `room name '${room.name}' is not a valid stream id`),
      channel: must(channelRef(room.name), `room name '${room.name}' is not a valid channel ref`),
      protocol: protocol.value,
      endpoint: deps.url,
      openedAt: openedAtOf(room),
    };
  };

  const sessionForRoom = async (name: string): Promise<IngestSession | null> => {
    const rooms = await deps.rooms.listRooms([name]);
    const room = rooms.find((r) => r.name === name);
    return room === undefined ? null : readSession(room);
  };

  const open = async (
    channel: ChannelRef,
    protocol: IngestProtocol,
  ): Promise<Result<IngestTicket, OpenIngestError>> => {
    const name = roomNameOf(channel);

    const metadata = JSON.stringify({ protocol });
    let created: Room;
    try {
      const existing = await sessionForRoom(name);
      if (existing !== null) return err({ kind: 'already-live', streamId: existing.id });
      created = await deps.rooms.createRoom({
        name,
        metadata,
        ...(deps.emptyTimeoutSeconds === undefined ? {} : { emptyTimeout: deps.emptyTimeoutSeconds }),
        ...(deps.departureTimeoutSeconds === undefined ? {} : { departureTimeout: deps.departureTimeoutSeconds }),
      });
      // `createRoom` does NOT overwrite the metadata of a room that already exists (e.g. one
      // an early viewer auto-created on join). If our metadata did not take, set it
      // explicitly — otherwise the very next `forChannel` would read empty metadata and lie
      // "not live" about a stream we just opened, and the viewer-join-before-builder-open
      // order would silently corrupt state [LAW:no-ambient-temporal-coupling][LAW:no-silent-failure].
      if (created.metadata !== metadata) created = await deps.rooms.updateRoomMetadata(name, metadata);
    } catch (cause) {
      return err(classifyOpen(cause));
    }

    let jwt: string;
    try {
      jwt = await deps.sign({
        room: name,
        identity: deps.publisherIdentity(channel),
        access: 'publish',
        ttlSeconds: deps.ttlSeconds,
      });
    } catch (cause) {
      return err(classifyOpen(cause));
    }

    const session: IngestSession = {
      id: must(streamId(name), `room name '${name}' is not a valid stream id`),
      channel,
      protocol,
      endpoint: deps.url,
      openedAt: openedAtOf(created),
    };
    return ok({ session, key: must(ingestKey(jwt), 'provider minted a blank access token') });
  };

  return {
    open,
    resolve: (stream: StreamId) => sessionForRoom(String(stream)),
    forChannel: (channel: ChannelRef) => sessionForRoom(roomNameOf(channel)),
    close: async (stream: StreamId) => {
      try {
        await deps.rooms.deleteRoom(String(stream));
      } catch (cause) {
        if (isNotFound(cause)) return;
        throw cause;
      }
    },
  };
};
