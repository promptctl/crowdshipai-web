import type { Result } from '@crowdship/std';
import { channelRef, ingestEndpoint, streamId, type ChannelRef } from '@crowdship/stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveKitIngestBroker,
  liveKitRooms,
  liveKitTokenSigner,
  mintSubscribeToken,
  roomNameOf,
  type LiveKitRooms,
  type LiveKitTokenSigner,
} from '../src/index.js';

/**
 * The live counterpart of the stub unit test: it stands the real LiveKit account up and
 * proves the adapter honours the identical IngestBroker contract against the actual SFU —
 * exactly as the TigerBeetle integration suite proves the real ledger honours the
 * in-memory ledger's contract. It is kept OUT of the fast suite (it needs a live account)
 * and runs only under `pnpm test:integration` [LAW:no-silent-failure].
 *
 * Credentials come from the server-side `LIVEKIT_*` env. When they are absent the suite
 * is VISIBLY skipped with a loud notice — a genuinely-absent optional live dependency,
 * announced, never a swallowed failure. The stub unit test still proves the translation
 * logic offline, so a missing account weakens coverage but hides nothing.
 */
const URL_ENV = process.env.LIVEKIT_URL;
const KEY_ENV = process.env.LIVEKIT_API_KEY;
const SECRET_ENV = process.env.LIVEKIT_API_SECRET;
const CREDENTIALED = Boolean(URL_ENV && KEY_ENV && SECRET_ENV);
if (!CREDENTIALED) {
  // eslint-disable-next-line no-console
  console.warn('livekit integration: LIVEKIT_* not set — skipping live round-trip (run with credentials to exercise the real SFU)');
}

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * LiveKit Cloud is eventually consistent: a room create or delete may take a beat to
 * become observable, so a read straight after a write can briefly disagree. An
 * integration test against it must CONVERGE on the expected state rather than assume
 * read-after-write — the provider owns this timing, and the product tolerates it because
 * a viewer only queries a channel long after the builder opened it [distributed-systems].
 */
const eventually = async (assert: () => Promise<void>): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await assert();
      return;
    } catch (failure) {
      if (attempt >= 12) throw failure;
      await sleep(300);
    }
  }
};

// A unique, obviously-disposable channel per run. Unique because LiveKit's delete lags
// several seconds on the cloud, so reusing one name across rapid runs would race a create
// against the prior run's still-dying room; a fresh name sidesteps that and mirrors the
// product, where every builder channel is already distinct. afterAll still deletes it, and
// any empty room self-reaps via emptyTimeout, so the account is never littered.
const CHANNEL: ChannelRef = must(channelRef(`crowdship-evf11-smoke-${Date.now()}`));

// Decode a LiveKit access token's claims without verifying — enough to assert WHAT the
// token authorizes (the provider verifies the signature for real).
const claimsOf = (jwt: string): { video?: { room?: string; canPublish?: boolean; canSubscribe?: boolean } } => {
  const part = jwt.split('.')[1];
  if (part === undefined) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
};

describe.skipIf(!CREDENTIALED)('LiveKit ingest adapter — live round-trip', () => {
  let url: string;
  let rooms: LiveKitRooms;
  let sign: LiveKitTokenSigner;
  let broker: ReturnType<typeof createLiveKitIngestBroker>;

  const disposeRoom = () => broker.close(must(streamId(roomNameOf(CHANNEL))));

  beforeAll(async () => {
    // Assigned here, not at the describe-body top level: vitest still evaluates a skipped
    // describe's factory at collection, so reading the env eagerly would throw before the
    // skip takes effect when credentials are absent.
    url = URL_ENV as string;
    const httpUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    rooms = liveKitRooms(httpUrl, KEY_ENV as string, SECRET_ENV as string);
    sign = liveKitTokenSigner(KEY_ENV as string, SECRET_ENV as string);
    broker = createLiveKitIngestBroker({
      rooms,
      sign,
      url: must(ingestEndpoint(url)),
      ttlSeconds: 3600,
      emptyTimeoutSeconds: 60,
      departureTimeoutSeconds: 30,
      publisherIdentity: (channel) => `builder:${channel}`,
    });
    // Clear any residue from a prior run through the production close path (idempotent
    // against an already-gone room — the very guard this suite verifies), then wait for
    // the delete to converge so the first open starts from a confirmed-clean slate.
    await disposeRoom();
    await eventually(async () => {
      const residue = await rooms.listRooms([roomNameOf(CHANNEL)]);
      if (residue.length !== 0) throw new Error('prior room not yet reaped');
    });
  });

  afterAll(disposeRoom);

  it('opens a real ingest, the room appears on the account, and the publish token authorizes publishing', async () => {
    const opened = await broker.open(CHANNEL, 'whip');
    const ticket = must(opened);

    expect(ticket.session.protocol).toBe('whip');
    expect(String(ticket.session.endpoint)).toBe(url);

    // The minted token is a real JWT carrying a publish grant for this room.
    const claims = claimsOf(String(ticket.key));
    expect(claims.video?.room).toBe(roomNameOf(CHANNEL));
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(false);

    // The room is really live on the account (once the create converges).
    await eventually(async () => {
      const live = await rooms.listRooms([roomNameOf(CHANNEL)]);
      expect(live.map((r) => r.name)).toContain(roomNameOf(CHANNEL));
    });
  });

  it('forChannel and resolve read the live room back as a session', async () => {
    await eventually(async () => {
      const byChannel = await broker.forChannel(CHANNEL);
      expect(byChannel?.protocol).toBe('whip');
    });
    // resolve takes a StreamId; the room name IS the stream id, so this round-trips.
    const byId = await broker.resolve(must(streamId(roomNameOf(CHANNEL))));
    expect(byId?.channel).toBe(CHANNEL);
  });

  it('refuses a second open as already-live', async () => {
    await eventually(async () => {
      const again = await broker.open(CHANNEL, 'whip');
      expect(again.ok).toBe(false);
      if (again.ok) throw new Error('unreachable');
      expect(again.error.kind).toBe('already-live');
    });
  });

  it('mints a viewer subscribe token for the same room, authorizing subscribe only', async () => {
    const token = await mintSubscribeToken(sign, CHANNEL, 'viewer-smoke', 600);
    const claims = claimsOf(token);
    expect(claims.video?.room).toBe(roomNameOf(CHANNEL));
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublish).toBe(false);
  });

  it('close tears the room down; the channel is honestly not live afterward', async () => {
    const session = await broker.forChannel(CHANNEL);
    if (session === null) throw new Error('expected a live session to close');
    await broker.close(session.id);

    await eventually(async () => {
      expect(await broker.forChannel(CHANNEL)).toBeNull();
    });
  });
});
