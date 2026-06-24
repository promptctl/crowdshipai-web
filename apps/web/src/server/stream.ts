import { randomBytes, randomUUID } from 'node:crypto';

import { SystemClock } from '@crowdship/identity-node';
import {
  channelRef,
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

import type { LiveKitConnection } from '../data/live-connection';
import type { PublishHandoff } from '../data/go-live-result';

/**
 * The single place the web app decides which {@link IngestBroker} it runs against
 * [LAW:one-source-of-truth] — the stream twin of `getAuthService()` and `getCatalog()`.
 * Every route and action that opens a builder's ingest reaches it through
 * `getIngestBroker()`, and every viewer mints its subscribe credential through
 * `viewerConnectionFor()`; both are resolved HERE, so the choice of media provider is a
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
 * credentials [LAW:single-enforcer]. `viewerConnection` is `null` when no real SFU backs
 * the app (the in-memory fake), an honest absence the viewer transport handles as data
 * rather than a fabricated token [LAW:no-silent-failure].
 */
interface StreamProvider {
  readonly broker: IngestBroker;
  viewerConnection(channel: ChannelRef, viewerIdentity: string): Promise<LiveKitConnection | null>;
  /**
   * Open a builder's ingest and surrender the credential to publish with — the
   * publish-side twin of {@link viewerConnection}. The provider is the one thing that
   * knows whether a real SFU backs the app, so the `no-sfu` arm of the honest outcome
   * set is decided HERE, the same place the viewer's `null` is [LAW:single-enforcer].
   */
  publishConnection(channel: ChannelRef, protocol: IngestProtocol): Promise<PublishHandoff>;
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
    // The viewer subscribes over the SAME public wss URL the builder publishes to, with
    // a token from the SAME signer the broker's `open` uses — publish and subscribe are
    // two values of one auth, never two systems that could drift [LAW:single-enforcer].
    viewerConnection: async (channel, viewerIdentity) => ({
      url: cfg.url,
      token: await mintSubscribeToken(sign, channel, viewerIdentity, SUBSCRIBE_TTL_SECONDS),
    }),
    // Going live is `broker.open` translated to what the browser publishes with: the
    // ticket's endpoint is the public wss URL and its key is the publish access-token
    // JWT, so the credential the builder receives is `{ endpoint, key }` and nothing
    // more — the API secret stays in the signer [LAW:effects-at-boundaries]. The
    // broker's two failure arms map straight across to the handoff's, never collapsed
    // into one "it didn't work" [LAW:no-silent-failure].
    publishConnection: async (channel, protocol) => {
      const opened = await broker.open(channel, protocol);
      if (opened.ok) {
        const { session, key } = opened.value;
        return { kind: 'ready', connection: { url: session.endpoint, token: key } };
      }
      switch (opened.error.kind) {
        case 'already-live':
          return { kind: 'already-live' };
        case 'provider-unavailable':
          return { kind: 'provider-unavailable' };
      }
    },
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
  // The fake has no SFU, so there is no real connection to hand a viewer — an honest
  // null, not a url paired with a fabricated token [LAW:no-silent-failure].
  viewerConnection: () => Promise.resolve(null),
  // ...and nothing real to publish TO either: the fake broker mints a bearer key for a
  // placeholder WHIP endpoint, not a LiveKit token for a wss room, so handing it to
  // livekit-client would be a lie. `no-sfu` is that honest absence, the publish twin of
  // the viewer's `null` [LAW:no-silent-failure].
  publishConnection: () => Promise.resolve({ kind: 'no-sfu' }),
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
 * The ONE mapping from a channel's public URL slug to the opaque stream `ChannelRef`
 * that names its LiveKit room [LAW:one-source-of-truth]. A viewer derives the builder's
 * room from the slug here, and the builder's go-live flow (evf.1.2) MUST mint the same
 * ref the same way, so both name the identical room without re-deriving it. The slug is
 * already a URL-safe, non-blank handle — a fitting room name — so a blank ref can only
 * be a programming error and is surfaced loudly, never papered over [LAW:no-silent-failure].
 *
 * Exported so the builder's go-live flow routes through THIS derivation rather than
 * minting a second: viewer and builder must name the identical room or the builder
 * publishes where no one is watching [LAW:one-source-of-truth].
 */
export const channelRefForSlug = (slug: string): ChannelRef => {
  const ref = channelRef(slug);
  if (!ref.ok) throw new Error('stream: cannot derive a channel ref from blank slug');
  return ref.value;
};

/**
 * The viewer-subscribe seam the watch surface (evf.2.1) consumes: everything a browser
 * needs to subscribe to a builder's live room, addressed by the channel's public slug.
 * Returns `null` when the app runs on the in-memory fake (no real media to subscribe to)
 * — an honest absence the player renders as the not-live placeholder, never a fabricated
 * credential [LAW:no-silent-failure]. The viewer identity is unique per call so many
 * viewers of one builder coexist under LiveKit's one-connection-per-identity rule.
 */
export const viewerConnectionFor = (slug: string, viewerIdentity: string): Promise<LiveKitConnection | null> =>
  provider.viewerConnection(channelRefForSlug(slug), viewerIdentity);

/**
 * The builder-publish seam the go-live control (evf.1.2) consumes: open the ingest for
 * the channel named by `slug` and surrender the credential to publish with, routing the
 * slug through the SAME {@link channelRefForSlug} the viewer uses so builder and viewer
 * name one room [LAW:one-source-of-truth]. The browser screen-capture path is WHIP
 * (WebRTC-over-HTTP), passed explicitly rather than buried as a mode. Returns the closed
 * {@link PublishHandoff} — `no-sfu` on the in-memory fake, the broker's failure arms, or
 * `ready` with the credential — never a fabricated token [LAW:no-silent-failure]. WHO
 * may publish is the caller's authorization at the edge; this seam trusts the slug it is
 * handed names the authorized channel [LAW:single-enforcer].
 */
export const publishConnectionFor = (slug: string): Promise<PublishHandoff> =>
  provider.publishConnection(channelRefForSlug(slug), 'whip');

/**
 * Tear a builder's live ingest down through the broker — the explicit other half of the
 * publish lifecycle [LAW:no-ambient-temporal-coupling]. It resolves the channel's open
 * session and closes it; closing an already-closed or never-opened channel is success,
 * not an error (the broker's `close` is idempotent), so this is safe whether the builder
 * truly went live or never did — on the fake there was no session to begin with.
 */
export const endPublishFor = async (slug: string): Promise<void> => {
  const session = await provider.broker.forChannel(channelRefForSlug(slug));
  if (session !== null) await provider.broker.close(session.id);
};
