import { randomBytes, randomUUID } from 'node:crypto';

import { SystemClock } from '@crowdship/identity-node';
import {
  createInMemoryIngestBroker,
  ingestEndpoint,
  ingestKey,
  streamId,
  type ChannelRef,
  type IngestBroker,
  type IngestEndpoint,
  type IngestProtocol,
} from '@crowdship/stream';
import {
  createLiveKitIngestBroker,
  liveKitRooms,
  liveKitTokenSigner,
  mintSubscribeToken,
} from '@crowdship/stream-livekit';

/**
 * The single place the web app decides which {@link IngestBroker} it runs against
 * [LAW:one-source-of-truth] — the stream twin of `getAuthService()` and `getCatalog()`.
 * Every route and action that opens a builder's ingest reaches it through
 * `getIngestBroker()`, and every viewer mints its subscribe credential through
 * `mintViewerToken()`; both are resolved HERE, so the choice of media provider is a
 * change in this one file and nowhere else [LAW:single-enforcer][LAW:locality-or-seam].
 *
 * The provider is chosen by environment, not a code edit: with the `LIVEKIT_*`
 * credentials present this binds the real LiveKit SFU; with none present it falls back
 * to the in-memory fake — the honest walking-skeleton stand-in that is loud about
 * carrying no real media. A PARTIAL LiveKit configuration is neither, so it halts
 * loudly rather than silently degrading to the fake when a deploy expected to be live
 * [LAW:no-silent-failure].
 *
 * Publish (a builder going live) and subscribe (a viewer watching) share ONE signer
 * here, so the API secret is read once, server-side, and authorizes both through a
 * single enforcer — never two [LAW:single-enforcer][LAW:effects-at-boundaries].
 */

// Token and room lifetimes. A publish token spans a long building session; a subscribe
// token is short and re-minted per viewer load. The timeouts are how long LiveKit keeps
// an idle room before reaping it — long enough to survive a brief builder reconnect.
const PUBLISH_TTL_SECONDS = 12 * 60 * 60;
const SUBSCRIBE_TTL_SECONDS = 60 * 60;
const EMPTY_TIMEOUT_SECONDS = 5 * 60;
const DEPARTURE_TIMEOUT_SECONDS = 2 * 60;

/**
 * One media provider the app resolves to: the ingest broker a builder opens through and
 * the viewer-token mint a watcher reuses. Bundling them makes the shared-auth guarantee
 * structural — both come from the same construction, so they cannot drift onto different
 * credentials [LAW:single-enforcer]. `mintViewerToken` is `null` when no real SFU backs
 * the app (the in-memory fake), an honest absence the viewer transport handles as data
 * rather than a fabricated token [LAW:no-silent-failure].
 */
interface StreamProvider {
  readonly broker: IngestBroker;
  mintViewerToken(channel: ChannelRef, viewerIdentity: string): Promise<string | null>;
}

interface LiveKitConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

// The three LiveKit vars travel together: all set → live, none set → fake, some set →
// a misconfiguration surfaced loudly, never papered over [LAW:no-silent-failure].
const resolveLiveKitConfig = (): LiveKitConfig | null => {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const set = [url, apiKey, apiSecret].filter((v) => v !== undefined && v !== '');
  if (set.length === 0) return null;
  if (set.length !== 3 || url === undefined || apiKey === undefined || apiSecret === undefined) {
    throw new Error('stream: LIVEKIT_* is partially configured — set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET together, or none');
  }
  return { url, apiKey, apiSecret };
};

const buildLiveKit = (cfg: LiveKitConfig): StreamProvider => {
  // The SDK's RoomService speaks https; livekit-client publishes/subscribes over the
  // wss URL. The endpoint handed to the builder is the wss URL; the room service uses
  // its https twin [LAW:one-source-of-truth].
  const httpUrl = cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const endpoint = ingestEndpoint(cfg.url);
  if (!endpoint.ok) throw new Error('stream: LIVEKIT_URL is blank');

  const sign = liveKitTokenSigner(cfg.apiKey, cfg.apiSecret);
  const broker = createLiveKitIngestBroker({
    rooms: liveKitRooms(httpUrl, cfg.apiKey, cfg.apiSecret),
    sign,
    url: endpoint.value,
    ttlSeconds: PUBLISH_TTL_SECONDS,
    emptyTimeoutSeconds: EMPTY_TIMEOUT_SECONDS,
    departureTimeoutSeconds: DEPARTURE_TIMEOUT_SECONDS,
    // A builder's identity is stable per channel, so a re-open evicts the prior
    // connection under LiveKit's one-connection-per-identity rule [LAW:single-enforcer].
    publisherIdentity: (channel) => `builder:${channel}`,
  });
  return {
    broker,
    mintViewerToken: (channel, viewerIdentity) =>
      mintSubscribeToken(sign, channel, viewerIdentity, SUBSCRIBE_TTL_SECONDS),
  };
};

// The base each protocol's ingest endpoint is hosted under for the in-memory fake,
// overridable per deployment. Held as a value keyed by protocol — a lookup, not a
// branch — so adding a protocol is one entry, never a new code path [LAW:dataflow-not-control-flow].
const INGEST_BASES: Readonly<Record<IngestProtocol, string>> = {
  whip: process.env.STREAM_WHIP_BASE_URL ?? 'http://localhost:8080/whip',
  rtmp: process.env.STREAM_RTMP_BASE_URL ?? 'rtmp://localhost:1935/live',
};

const endpointFor = (_channel: ChannelRef, protocol: IngestProtocol): IngestEndpoint => {
  // The bearer IngestKey on the ticket identifies and authorizes the push, so the opaque
  // ChannelRef never leaks into an encoder-facing URL [LAW:one-source-of-truth].
  const built = ingestEndpoint(INGEST_BASES[protocol]);
  if (!built.ok) throw new Error(`stream: built a blank ingest endpoint for protocol ${protocol}`);
  return built.value;
};

const buildInMemory = (): StreamProvider => ({
  broker: createInMemoryIngestBroker({
    clock: new SystemClock(),
    // An id need only be unique → a UUID. A key guards the push, so it is drawn from a
    // CSPRNG with real entropy — a distinct seam precisely so that requirement is never
    // lost by reusing the id generator [LAW:decomposition].
    newStreamId: () => {
      const id = streamId(`str_${randomUUID()}`);
      if (!id.ok) throw new Error('stream: minted a blank stream id');
      return id.value;
    },
    newIngestKey: () => {
      const key = ingestKey(randomBytes(32).toString('base64url'));
      if (!key.ok) throw new Error('stream: minted a blank ingest key');
      return key.value;
    },
    endpointFor,
  }),
  // The fake has no SFU, so there is no real subscribe token — an honest null, not a
  // fabricated credential [LAW:no-silent-failure].
  mintViewerToken: () => Promise.resolve(null),
});

const build = (): StreamProvider => {
  const cfg = resolveLiveKitConfig();
  return cfg === null ? buildInMemory() : buildLiveKit(cfg);
};

// One provider per process, the single owner of the ingest binding [LAW:no-shared-mutable-globals].
// Cached on globalThis so Next.js dev HMR, which re-evaluates modules, reuses the live
// binding instead of rebuilding it on each edit — the same pattern the identity service uses.
const globalForStream = globalThis as unknown as { __crowdshipStream?: StreamProvider };
const provider: StreamProvider = globalForStream.__crowdshipStream ?? build();
if (process.env.NODE_ENV !== 'production') globalForStream.__crowdshipStream = provider;

export const getIngestBroker = (): IngestBroker => provider.broker;

/**
 * Mint a viewer's subscribe-only credential for a channel — the shared-auth seam the
 * viewer transport (evf.2.1) consumes. Returns `null` when the app runs on the
 * in-memory fake (no real media to subscribe to).
 */
export const mintViewerToken = (channel: ChannelRef, viewerIdentity: string): Promise<string | null> =>
  provider.mintViewerToken(channel, viewerIdentity);
