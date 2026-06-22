import type { Brand, BlankError, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/**
 * The opaque internal identity of one ingest session — one builder's open channel
 * into the platform. Minted, never parsed; transport (evf.2), presence (evf.3),
 * and the lifecycle owner (evf.6) all reference a stream by this id, so its meaning
 * never leaks into them [LAW:carrying-cost].
 */
export type StreamId = Brand<string, 'StreamId'>;

/**
 * The broadcasting party as far as the ingest boundary cares — an opaque reference
 * to "whose stream this is". The stream domain is core and cannot depend on identity
 * (a sibling core), so it deliberately knows nothing of an identity `ChannelId` or
 * `AccountId` [LAW:one-way-deps]; the app maps its principal onto this ref at the
 * one composition point [LAW:decomposition]. Opaque, minted upstream, never parsed.
 */
export type ChannelRef = Brand<string, 'ChannelRef'>;

/**
 * Where the builder's encoder pushes video — the address the ingest provider hosts
 * for this session. Opaque to the domain: it is handed to the builder verbatim and
 * never inspected here. A media server (an SFU, a managed ingest service) owns what
 * a real one looks like; the domain only carries it [LAW:effects-at-boundaries].
 */
export type IngestEndpoint = Brand<string, 'IngestEndpoint'>;

/**
 * The bearer secret that authorizes the push to {@link IngestEndpoint} — a stream
 * key. Like a session token it MUST be high-entropy and is carried opaquely; the
 * domain never inspects, stores, or derives meaning from it [LAW:effects-at-boundaries].
 * It is surfaced exactly once, in the {@link IngestTicket} `open` returns, and never
 * read back — the secret has one authoritative home, never a second copy [LAW:one-source-of-truth].
 */
export type IngestKey = Brand<string, 'IngestKey'>;

export const streamId = (raw: string): Result<StreamId, BlankError> => nonBlank<'StreamId'>('streamId', raw);
export const channelRef = (raw: string): Result<ChannelRef, BlankError> => nonBlank<'ChannelRef'>('channelRef', raw);
export const ingestEndpoint = (raw: string): Result<IngestEndpoint, BlankError> =>
  nonBlank<'IngestEndpoint'>('ingestEndpoint', raw);
export const ingestKey = (raw: string): Result<IngestKey, BlankError> => nonBlank<'IngestKey'>('ingestKey', raw);
