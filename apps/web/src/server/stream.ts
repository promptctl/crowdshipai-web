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

/**
 * The single place the web app decides which {@link IngestBroker} it runs against
 * [LAW:one-source-of-truth] — the stream twin of `getAuthService()` and `getCatalog()`.
 * Every route and action that opens a builder's ingest reaches it through
 * `getIngestBroker()`, so swapping today's in-memory stand-in for a real media
 * provider (LiveKit / Mux / Cloudflare Stream / IVS) is a change HERE and nowhere
 * else [LAW:single-enforcer][LAW:locality-or-seam].
 *
 * Today this is the in-memory broker — the honest walking-skeleton stand-in, exactly
 * as `createInMemoryPaymentGateway` is the current PSP until the Stripe secret is
 * wired. It is not silent about being a fake: no media actually flows yet, the
 * provider binding is a follow-up, and the credentials it mints point at a local
 * dev ingest. Going live = bind a real provider behind this same accessor, no caller
 * change [LAW:no-silent-failure].
 */

// The base each protocol's ingest endpoint is hosted under, overridable per
// deployment. Held as a value keyed by protocol — a lookup, not a branch — so adding
// a protocol is one entry, never a new code path [LAW:dataflow-not-control-flow].
const INGEST_BASES: Readonly<Record<IngestProtocol, string>> = {
  whip: process.env.STREAM_WHIP_BASE_URL ?? 'http://localhost:8080/whip',
  rtmp: process.env.STREAM_RTMP_BASE_URL ?? 'rtmp://localhost:1935/live',
};

const endpointFor = (_channel: ChannelRef, protocol: IngestProtocol): IngestEndpoint => {
  // The endpoint is the provider's ingest address for the protocol; the builder's
  // bearer IngestKey — handed back on the ticket — is what authorizes and identifies
  // the push, so the opaque internal ChannelRef never leaks into an encoder-facing
  // URL [LAW:one-source-of-truth]. This is also the only shape correct for BOTH
  // protocols: an RTMP app URL and a WHIP endpoint are each addressed by base + a
  // bearer credential, not by a channel path segment. A real provider may mint a
  // per-session URL behind this same seam; the walking-skeleton stand-in points
  // every push at the local dev base for the protocol.
  const built = ingestEndpoint(INGEST_BASES[protocol]);
  // The base is a non-blank constant/env value; a blank here is a broken invariant,
  // so it halts loudly rather than minting a blank endpoint [LAW:no-silent-failure].
  if (!built.ok) throw new Error(`stream: built a blank ingest endpoint for protocol ${protocol}`);
  return built.value;
};

const build = (): IngestBroker =>
  createInMemoryIngestBroker({
    clock: new SystemClock(),
    // An id need only be unique → a UUID. A key guards the push, so it is drawn from
    // a CSPRNG with real entropy — a distinct seam precisely so that requirement is
    // never lost by reusing the id generator [LAW:decomposition].
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
  });

// One broker per process, the single owner of the in-memory ingest sessions
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR, which
// re-evaluates modules, reuses the live sessions instead of dropping every builder
// offline on each edit — the same pattern the identity service uses.
const globalForIngest = globalThis as unknown as { __crowdshipIngest?: IngestBroker };
const ingestBroker: IngestBroker = globalForIngest.__crowdshipIngest ?? build();
if (process.env.NODE_ENV !== 'production') globalForIngest.__crowdshipIngest = ingestBroker;

export const getIngestBroker = (): IngestBroker => ingestBroker;
