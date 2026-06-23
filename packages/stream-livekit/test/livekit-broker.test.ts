import type { Result } from '@crowdship/std';
import {
  channelRef,
  ingestEndpoint,
  streamId,
  type ChannelRef,
  type IngestEndpoint,
} from '@crowdship/stream';
import type { Room } from 'livekit-server-sdk';
import { TwirpError } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';

import {
  createLiveKitIngestBroker,
  grantFor,
  mintSubscribeToken,
  type LiveKitIngestDeps,
  type LiveKitRooms,
  type LiveKitTokenClaims,
  type LiveKitTokenSigner,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank test input is a broken test,
 *  never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const URL_VALUE: IngestEndpoint = must(ingestEndpoint('wss://test.livekit.cloud'));
const ALICE: ChannelRef = must(channelRef('alice'));

/**
 * A minimal LiveKit `Room` for stubs to return. The broker reads only a handful of
 * fields; the rest of the protobuf message's large shape is irrelevant to this
 * translation, so it is filled by the cast rather than spelled out — scaffolding
 * confined to the test, never the production path.
 */
const room = (over: Partial<Room>): Room =>
  ({
    name: 'alice',
    sid: 'RM_test',
    metadata: JSON.stringify({ protocol: 'whip' }),
    creationTimeMs: 1_700_000_000_000n,
    numParticipants: 0,
    numPublishers: 0,
    ...over,
  }) as unknown as Room;

interface Created {
  readonly name: string;
  readonly metadata?: string;
}

/** A stub RoomService that records what the broker SENT and answers via the supplied
 *  behaviours, so a test can both assert the translation and control LiveKit's reply. */
const stubRooms = (cfg: {
  list?: (names?: string[]) => Promise<Room[]>;
  create?: (name: string) => Promise<Room>;
  del?: (room: string) => Promise<void>;
}): { rooms: LiveKitRooms; created: Created[]; deleted: string[] } => {
  const created: Created[] = [];
  const deleted: string[] = [];
  const rooms: LiveKitRooms = {
    listRooms: (names) => (cfg.list ?? (() => Promise.resolve([])))(names),
    createRoom: (opts) => {
      created.push({ name: opts.name, ...(opts.metadata === undefined ? {} : { metadata: opts.metadata }) });
      return (cfg.create ?? ((n: string) => Promise.resolve(room({ name: n }))))(opts.name);
    },
    deleteRoom: (r) => {
      deleted.push(r);
      return (cfg.del ?? (() => Promise.resolve()))(r);
    },
  };
  return { rooms, created, deleted };
};

/** A stub signer that records every claim and returns a deterministic fake token, so a
 *  test asserts both WHAT was authorized and that the broker forwards the minted token. */
const stubSigner = (): { sign: LiveKitTokenSigner; calls: LiveKitTokenClaims[] } => {
  const calls: LiveKitTokenClaims[] = [];
  return {
    calls,
    sign: (c) => {
      calls.push(c);
      return Promise.resolve(`jwt:${c.access}:${c.room}:${c.identity}`);
    },
  };
};

const broker = (rooms: LiveKitRooms, sign: LiveKitTokenSigner, over?: Partial<LiveKitIngestDeps>) =>
  createLiveKitIngestBroker({
    rooms,
    sign,
    url: URL_VALUE,
    ttlSeconds: 3600,
    publisherIdentity: (ch) => `builder:${ch}`,
    ...over,
  });

describe('grantFor — the single auth enforcer', () => {
  it('publish authorizes sending media and nothing else', () => {
    expect(grantFor('publish', 'alice')).toEqual({
      roomJoin: true,
      room: 'alice',
      canPublish: true,
      canPublishData: true,
      canSubscribe: false,
    });
  });

  it('subscribe authorizes receiving media and nothing else', () => {
    expect(grantFor('subscribe', 'alice')).toEqual({
      roomJoin: true,
      room: 'alice',
      canPublish: false,
      canPublishData: false,
      canSubscribe: true,
    });
  });
});

describe('open', () => {
  it('creates the room with the protocol in metadata and mints a publish token', async () => {
    const { rooms, created } = stubRooms({ list: () => Promise.resolve([]) });
    const { sign, calls } = stubSigner();
    const result = await broker(rooms, sign).open(ALICE, 'whip');

    expect(result.ok).toBe(true);
    const ticket = must(result);
    expect(ticket.session.id).toBe(must(streamId('alice')));
    expect(ticket.session.channel).toBe(ALICE);
    expect(ticket.session.protocol).toBe('whip');
    expect(ticket.session.endpoint).toBe(URL_VALUE);
    // The builder pushes with the minted access token as bearer, to the provider's URL.
    expect(ticket.key).toBe('jwt:publish:alice:builder:alice');

    expect(created).toEqual([{ name: 'alice', metadata: JSON.stringify({ protocol: 'whip' }) }]);
    expect(calls).toEqual([
      { room: 'alice', identity: 'builder:alice', access: 'publish', ttlSeconds: 3600 },
    ]);
  });

  it('refuses a second open while the channel is already provisioned (already-live)', async () => {
    const { rooms, created } = stubRooms({ list: () => Promise.resolve([room({ name: 'alice' })]) });
    const { sign } = stubSigner();
    const result = await broker(rooms, sign).open(ALICE, 'whip');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'already-live', streamId: must(streamId('alice')) });
    // It refused without creating a second room.
    expect(created).toEqual([]);
  });

  it('maps an unreachable provider to the retryable provider-unavailable arm', async () => {
    const { rooms } = stubRooms({ list: () => Promise.reject(new TwirpError('Unavailable', 'down', 503)) });
    const { sign } = stubSigner();
    const result = await broker(rooms, sign).open(ALICE, 'whip');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'provider-unavailable' });
  });

  it('rethrows a bug-class provider error (bad credentials) rather than disguising it', async () => {
    const { rooms } = stubRooms({ list: () => Promise.reject(new TwirpError('Unauthenticated', 'bad key', 401)) });
    const { sign } = stubSigner();
    await expect(broker(rooms, sign).open(ALICE, 'whip')).rejects.toThrow(/bad key/);
  });
});

describe('resolve / forChannel — a room provisioned by us is a session', () => {
  it('forChannel returns the session for a provisioned room', async () => {
    const { rooms } = stubRooms({ list: () => Promise.resolve([room({ name: 'alice' })]) });
    const { sign } = stubSigner();
    const session = await broker(rooms, sign).forChannel(ALICE);
    expect(session?.protocol).toBe('whip');
    expect(session?.id).toBe(must(streamId('alice')));
  });

  it('forChannel is honestly null for a room never opened as an ingest (no metadata)', async () => {
    const { rooms } = stubRooms({ list: () => Promise.resolve([room({ name: 'alice', metadata: '' })]) });
    const { sign } = stubSigner();
    expect(await broker(rooms, sign).forChannel(ALICE)).toBeNull();
  });

  it('forChannel is null when no room exists', async () => {
    const { rooms } = stubRooms({ list: () => Promise.resolve([]) });
    const { sign } = stubSigner();
    expect(await broker(rooms, sign).forChannel(ALICE)).toBeNull();
  });

  it('resolve looks a stream up by its id', async () => {
    const { rooms } = stubRooms({ list: () => Promise.resolve([room({ name: 'alice' })]) });
    const { sign } = stubSigner();
    const session = await broker(rooms, sign).resolve(must(streamId('alice')));
    expect(session?.channel).toBe(ALICE);
  });

  it('surfaces corrupt metadata loudly instead of guessing a protocol', async () => {
    const { rooms } = stubRooms({ list: () => Promise.resolve([room({ name: 'alice', metadata: '{not json' })]) });
    const { sign } = stubSigner();
    await expect(broker(rooms, sign).forChannel(ALICE)).rejects.toThrow(/unparseable/);
  });

  it('surfaces an unknown protocol in metadata loudly', async () => {
    const { rooms } = stubRooms({
      list: () => Promise.resolve([room({ name: 'alice', metadata: JSON.stringify({ protocol: 'srt' }) })]),
    });
    const { sign } = stubSigner();
    await expect(broker(rooms, sign).forChannel(ALICE)).rejects.toThrow(/unknown ingest protocol/);
  });
});

describe('close', () => {
  it('deletes the room', async () => {
    const { rooms, deleted } = stubRooms({});
    const { sign } = stubSigner();
    await broker(rooms, sign).close(must(streamId('alice')));
    expect(deleted).toEqual(['alice']);
  });

  it('is idempotent: deleting an already-gone room is success', async () => {
    const { rooms } = stubRooms({ del: () => Promise.reject(new TwirpError('NotFound', 'gone', 404)) });
    const { sign } = stubSigner();
    await expect(broker(rooms, sign).close(must(streamId('alice')))).resolves.toBeUndefined();
  });

  it('surfaces a non-not-found teardown failure loudly', async () => {
    const { rooms } = stubRooms({ del: () => Promise.reject(new TwirpError('Unavailable', 'down', 503)) });
    const { sign } = stubSigner();
    await expect(broker(rooms, sign).close(must(streamId('alice')))).rejects.toThrow(/down/);
  });
});

describe('mintSubscribeToken — shared auth for the viewer transport', () => {
  it('mints a subscribe-only token for the same room the builder publishes to', async () => {
    const { sign, calls } = stubSigner();
    const token = await mintSubscribeToken(sign, ALICE, 'viewer-1', 600);
    expect(token).toBe('jwt:subscribe:alice:viewer-1');
    expect(calls).toEqual([{ room: 'alice', identity: 'viewer-1', access: 'subscribe', ttlSeconds: 600 }]);
  });
});
