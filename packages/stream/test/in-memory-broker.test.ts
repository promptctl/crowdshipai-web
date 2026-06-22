import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  channelRef,
  createInMemoryIngestBroker,
  ingestEndpoint,
  ingestKey,
  ingestProtocol,
  streamId,
  type ChannelRef,
  type IngestBrokerDeps,
  type IngestProtocol,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const OPENED_AT = 1_700_000_000_000;
const fixedClock: Clock = { now: () => must(timestamp(OPENED_AT)) };

const ch = (raw: string): ChannelRef => must(channelRef(raw));
const whip: IngestProtocol = must(ingestProtocol('whip'));
const rtmp: IngestProtocol = must(ingestProtocol('rtmp'));

/** A broker whose mints are deterministic counters, so a test can assert exactly
 *  which id/key/endpoint a session carries. `over` lets a test add the one fault knob. */
const broker = (over: Partial<IngestBrokerDeps> = {}) => {
  let ids = 0;
  let keys = 0;
  const deps: IngestBrokerDeps = {
    clock: fixedClock,
    newStreamId: () => must(streamId(`str_${(ids += 1)}`)),
    newIngestKey: () => must(ingestKey(`key_${(keys += 1)}`)),
    endpointFor: (channel, protocol) => must(ingestEndpoint(`${protocol}://ingest.test/${channel}`)),
    ...over,
  };
  return createInMemoryIngestBroker(deps);
};

describe('ingestProtocol', () => {
  it('admits the known protocols and refuses an unknown one rather than defaulting', () => {
    expect(must(ingestProtocol('whip'))).toBe('whip');
    expect(must(ingestProtocol('rtmp'))).toBe('rtmp');

    const unknown = ingestProtocol('hls');
    expect(unknown).toEqual({ ok: false, error: { kind: 'unknown-protocol', value: 'hls' } });
  });
});

describe('the in-memory ingest broker', () => {
  it('opens an ingest channel and hands back a ticket the builder pushes with', async () => {
    const b = broker();

    const result = await b.open(ch('chan-1'), rtmp);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const { session, key } = result.value;
    expect(session.id).toBe('str_1');
    expect(session.channel).toBe('chan-1');
    expect(session.protocol).toBe('rtmp');
    expect(session.endpoint).toBe('rtmp://ingest.test/chan-1');
    expect(session.openedAt).toBe(OPENED_AT as Timestamp);
    // The bearer key is surfaced once, on the ticket — and the session record carries
    // no key field at all — the secret has one home [LAW:one-source-of-truth].
    expect(key).toBe('key_1');
    expect('key' in session).toBe(false);
  });

  it('makes an open session resolvable by id and by channel', async () => {
    const b = broker();
    const opened = await b.open(ch('chan-1'), whip);
    if (!opened.ok) throw new Error('open should have succeeded');

    const byId = await b.resolve(opened.value.session.id);
    const byChannel = await b.forChannel(ch('chan-1'));

    expect(byId).toEqual(opened.value.session);
    expect(byChannel).toEqual(opened.value.session);
  });

  it('returns null for a stream or channel that is not live — absence as a value, not a throw', async () => {
    const b = broker();
    expect(await b.resolve(must(streamId('nope')))).toBeNull();
    expect(await b.forChannel(ch('nobody'))).toBeNull();
  });

  it('refuses a second open for a live channel, carrying the stream already live', async () => {
    const b = broker();
    const first = await b.open(ch('chan-1'), rtmp);
    if (!first.ok) throw new Error('first open should have succeeded');

    const second = await b.open(ch('chan-1'), whip);

    expect(second).toEqual({ ok: false, error: { kind: 'already-live', streamId: first.value.session.id } });
    // No second session was minted — the channel still resolves to exactly the first.
    expect(await b.forChannel(ch('chan-1'))).toEqual(first.value.session);
  });

  it('lets distinct channels be live at the same time', async () => {
    const b = broker();
    const a = await b.open(ch('chan-a'), rtmp);
    const c = await b.open(ch('chan-b'), whip);

    expect(a.ok && c.ok).toBe(true);
    if (!a.ok || !c.ok) throw new Error('unreachable');
    expect(a.value.session.id).not.toBe(c.value.session.id);
  });

  it('closes idempotently and frees the channel to go live again with a fresh id and key', async () => {
    const b = broker();
    const first = await b.open(ch('chan-1'), rtmp);
    if (!first.ok) throw new Error('first open should have succeeded');

    await b.close(first.value.session.id);
    expect(await b.resolve(first.value.session.id)).toBeNull();
    expect(await b.forChannel(ch('chan-1'))).toBeNull();
    // Closing again, and closing an unknown stream, are both success — not errors.
    await expect(b.close(first.value.session.id)).resolves.toBeUndefined();
    await expect(b.close(must(streamId('never-existed')))).resolves.toBeUndefined();

    const reopened = await b.open(ch('chan-1'), rtmp);
    if (!reopened.ok) throw new Error('reopen should have succeeded');
    // A fresh session and a freshly-minted key — a closed stream's secret is never replayed.
    expect(reopened.value.session.id).not.toBe(first.value.session.id);
    expect(reopened.value.key).not.toBe(first.value.key);
  });

  it('surfaces the retryable provider-unavailable arm and stores nothing when the provider is down', async () => {
    const b = broker({ unavailable: () => true });

    const result = await b.open(ch('chan-1'), rtmp);

    expect(result).toEqual({ ok: false, error: { kind: 'provider-unavailable' } });
    // A failed open left no phantom session behind.
    expect(await b.forChannel(ch('chan-1'))).toBeNull();
  });
});
