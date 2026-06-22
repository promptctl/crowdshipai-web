/**
 * The live stream's front door: video ingest from the builder behind one swappable
 * port [LAW:locality-or-seam]. The platform owns the ingest SESSION and brokers the
 * credentials a builder pushes with; the media bytes flow through an adopted provider
 * (an SFU / managed ingest service), never rebuilt here [LAW:effects-at-boundaries].
 * This is core — vendor- and framework-free, standing only on `@crowdship/std`; a
 * real provider binds the {@link IngestBroker} seam from an adapter, and transport
 * (evf.2), presence (evf.3), the live event channel (evf.4), and the lifecycle phase
 * owner (evf.6) build on this boundary; they are not it.
 */
export type { StreamId, ChannelRef, IngestEndpoint, IngestKey } from './ids.js';
export { streamId, channelRef, ingestEndpoint, ingestKey } from './ids.js';

export type {
  IngestProtocol,
  IngestProtocolError,
  IngestSession,
  IngestTicket,
  OpenIngestError,
  IngestBroker,
} from './ingest.js';
export { INGEST_PROTOCOLS, ingestProtocol } from './ingest.js';

export type { IngestBrokerDeps } from './in-memory-broker.js';
export { createInMemoryIngestBroker } from './in-memory-broker.js';
