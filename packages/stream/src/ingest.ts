import type { Result, Timestamp } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

import type { ChannelRef, IngestEndpoint, IngestKey, StreamId } from './ids.js';

/**
 * How a builder pushes video to the platform. These are the two real-world ingest
 * protocols a media provider speaks — WHIP (WebRTC-over-HTTP, browser-native, low
 * latency) and RTMP (what OBS and every encoder already does). The choice is a
 * VALUE the builder makes per session, not a mode the platform branches on, and a
 * third (SRT, say) is one entry here, not a new code path [LAW:no-mode-explosion].
 * The list is the single source of truth; the type is derived from it so the two
 * can never drift [LAW:one-source-of-truth].
 */
export const INGEST_PROTOCOLS = ['whip', 'rtmp'] as const;
export type IngestProtocol = (typeof INGEST_PROTOCOLS)[number];

export type IngestProtocolError = { readonly kind: 'unknown-protocol'; readonly value: string };

/**
 * Parse an untrusted string into a protocol at the trust boundary — the one place
 * an arbitrary string becomes a known protocol, so no downstream code re-checks
 * [LAW:single-enforcer]. An unrecognized value is surfaced, never coerced to a
 * default that silently changes what the builder asked for [LAW:no-silent-failure].
 */
export const ingestProtocol = (raw: string): Result<IngestProtocol, IngestProtocolError> =>
  (INGEST_PROTOCOLS as readonly string[]).includes(raw)
    ? ok(raw as IngestProtocol)
    : err({ kind: 'unknown-protocol', value: raw });

/**
 * The durable record of one provisioned ingest channel — the front door standing
 * open. It carries everything a later stage needs to reason about the stream
 * (transport wiring, presence, the lifecycle phase) EXCEPT the bearer secret, which
 * lives only on the {@link IngestTicket} — one authoritative home for it [LAW:one-source-of-truth].
 *
 * Note what is deliberately ABSENT: a phase. Whether the builder is live,
 * reconnecting, or has ended is the lifecycle owner's concern (evf.6), not the
 * ingest boundary's — modeling it here would be a second authority on stream state
 * [LAW:decomposition]. An `IngestSession` means only "an ingest channel is
 * provisioned for this builder."
 */
export interface IngestSession {
  readonly id: StreamId;
  readonly channel: ChannelRef;
  readonly protocol: IngestProtocol;
  readonly endpoint: IngestEndpoint;
  readonly openedAt: Timestamp;
}

/**
 * What opening an ingest channel surrenders: the session record plus the
 * {@link IngestKey} the builder needs once to point their encoder at us. The key is
 * present HERE and nowhere else — handed over exactly once and thereafter only the
 * keyless {@link IngestSession} is ever read [LAW:one-source-of-truth], mirroring how
 * a login hands over its token once.
 */
export interface IngestTicket {
  readonly session: IngestSession;
  readonly key: IngestKey;
}

/**
 * Why an ingest channel could not be opened — the honest, closed set of outcomes a
 * caller must handle. `already-live` is a domain rule, not a fault: a builder holds
 * at most one open ingest at a time, so a second `open` is refused and carries the
 * existing stream so the caller can resolve or close it [LAW:one-source-of-truth].
 * `provider-unavailable` is the retryable arm — the media provider was unreachable —
 * the exact mirror of the payment gateway's `gateway-unavailable`.
 */
export type OpenIngestError =
  | { readonly kind: 'already-live'; readonly streamId: StreamId }
  | { readonly kind: 'provider-unavailable' };

/**
 * THE ingest boundary — the single seam every builder's video enters the platform
 * through [LAW:locality-or-seam]. It is to a real media provider (LiveKit, Mux,
 * Cloudflare Stream, IVS — a solved problem we do not rebuild) exactly what the
 * `PaymentGateway` port is to Stripe: one port, an in-memory fake for now, a vendor
 * adapter swapped in behind it later with no caller change [LAW:one-type-per-behavior].
 * The platform owns the SESSION and brokers the credentials; it never carries the
 * media bytes itself [LAW:effects-at-boundaries].
 *
 * Every method is async because every real provider is (a network call to provision
 * or tear down an ingest); modeling it sync now would force a rewrite later, the same
 * reasoning the `Ledger` and `AuthService` seams use.
 */
export interface IngestBroker {
  /**
   * Provision an ingest channel for a builder pushing with `protocol`, returning the
   * ticket they push with. Fails with `already-live` if the channel already holds an
   * open ingest, or `provider-unavailable` if the media provider could not be reached.
   */
  open(channel: ChannelRef, protocol: IngestProtocol): Promise<Result<IngestTicket, OpenIngestError>>;

  /** Resolve a stream to its session, or `null` if no such ingest is open — a genuine absence, modeled as a value. */
  resolve(stream: StreamId): Promise<IngestSession | null>;

  /** The open ingest for a channel, or `null` if the channel is not currently live. */
  forChannel(channel: ChannelRef): Promise<IngestSession | null>;

  /** Tear an ingest channel down. Idempotent: closing an already-closed or unknown stream is success, not an error. */
  close(stream: StreamId): Promise<void>;
}
