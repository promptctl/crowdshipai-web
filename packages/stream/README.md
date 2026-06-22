# @crowdship/stream

The live stream's **front door**: video ingest from the builder, behind one swappable
port. The atomic primitive is a video stream with someone building in front of it; this
package is where that video enters the platform.

It is **core** — vendor- and framework-free, standing only on `@crowdship/std`. It owns
the ingest **session** (who is live, where they push, with what key) and brokers the
credentials a builder needs; it does **not** carry media bytes. A real media provider
(an SFU / managed ingest service — LiveKit, Mux, Cloudflare Stream, IVS) binds the
`IngestBroker` seam from an adapter later, exactly as `@crowdship/payments-stripe` binds
the `PaymentGateway` port. We do not rebuild solved media infrastructure.

## The seam

```ts
interface IngestBroker {
  open(channel: ChannelRef, protocol: IngestProtocol): Promise<Result<IngestTicket, OpenIngestError>>;
  resolve(stream: StreamId): Promise<IngestSession | null>;
  forChannel(channel: ChannelRef): Promise<IngestSession | null>;
  close(stream: StreamId): Promise<void>;
}
```

- `open` returns an `IngestTicket` — the keyless `IngestSession` record plus the bearer
  `IngestKey`, surfaced **once**. A channel holds at most one open ingest; a second
  `open` is refused with `already-live` carrying the existing stream. A media provider
  that is unreachable yields the retryable `provider-unavailable`.
- The session carries **no phase** (live / reconnecting / ended) — that is the stream
  lifecycle owner's concern (evf.6), not the ingest boundary's.
- `ChannelRef` is the broadcasting party as far as ingest cares. `stream` is core and
  cannot depend on `identity` (a sibling core); the **app** maps its principal onto a
  `ChannelRef` at the one composition point.

`createInMemoryIngestBroker(deps)` is the dev/test stand-in behind the seam — correct
for a single process — the twin of `createInMemoryPaymentGateway`.
