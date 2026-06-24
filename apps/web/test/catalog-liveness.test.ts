import type { Clock, Result } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  channelRef,
  createInMemoryIngestBroker,
  ingestEndpoint,
  ingestKey,
  ingestProtocol,
  streamId,
  type ChannelRef,
  type IngestBroker,
} from '@crowdship/stream';
import { describe, expect, it } from 'vitest';

import { createFakeCatalog } from '../src/data/fake-catalog';
import type { StreamSummary } from '../src/data/types';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const fixedClock: Clock = { now: () => must(timestamp(1_700_000_000_000)) };

/** A real in-memory broker, the same one the app falls back to when no SFU is
 *  configured — so the test exercises liveness against genuine broker state, not a
 *  stub of it [LAW:behavior-not-structure]. */
const broker = (): IngestBroker => {
  let ids = 0;
  let keys = 0;
  return createInMemoryIngestBroker({
    clock: fixedClock,
    newStreamId: () => must(streamId(`str_${(ids += 1)}`)),
    newIngestKey: () => must(ingestKey(`key_${(keys += 1)}`)),
    endpointFor: (channel, protocol) => must(ingestEndpoint(`${protocol}://ingest.test/${channel}`)),
  });
};

const ch = (slug: string): ChannelRef => must(channelRef(slug));
const whip = must(ingestProtocol('whip'));

/** The liveness resolver the composition root injects, here backed by a test broker:
 *  a channel is live iff the broker holds an open session for it — the one authority. */
const livenessOf = (b: IngestBroker) => async (slug: string): Promise<boolean> =>
  (await b.forChannel(ch(slug))) !== null;

const bySlug = (roster: readonly StreamSummary[]): Map<string, StreamSummary> =>
  new Map(roster.map((s) => [s.slug, s]));

describe('catalog liveness is derived from broker room state, not a seed flag', () => {
  it('reports every builder offline when no ingest is open', async () => {
    const catalog = createFakeCatalog(livenessOf(broker()));
    const roster = await catalog.roster();

    expect(roster.length).toBeGreaterThan(0);
    expect(roster.every((s) => !s.isLive)).toBe(true);
  });

  it('reports a builder live exactly when their room has an open session', async () => {
    const b = broker();
    const catalog = createFakeCatalog(livenessOf(b));

    // Pick a real seeded builder and another to contrast against.
    const before = await catalog.roster();
    const [live, ...rest] = before.map((s) => s.slug);
    const other = rest[0];

    await b.open(ch(live), whip);

    const roster = bySlug(await catalog.roster());
    expect(roster.get(live)?.isLive).toBe(true);
    expect(roster.get(other)?.isLive).toBe(false);

    // The single-channel read agrees with the roster — both read the one authority.
    const channel = await catalog.channel(live);
    expect(channel?.stream.isLive).toBe(true);
    const otherChannel = await catalog.channel(other);
    expect(otherChannel?.stream.isLive).toBe(false);
  });

  it('drops a builder back to offline the instant their ingest closes', async () => {
    const b = broker();
    const catalog = createFakeCatalog(livenessOf(b));
    const slug = (await catalog.roster())[0].slug;

    const opened = await b.open(ch(slug), whip);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('expected open to succeed');
    expect((await catalog.channel(slug))?.stream.isLive).toBe(true);

    await b.close(opened.value.session.id);
    expect((await catalog.channel(slug))?.stream.isLive).toBe(false);
  });

  it('orders the roster live-first over the derived liveness', async () => {
    const b = broker();
    const catalog = createFakeCatalog(livenessOf(b));
    // Go live for a builder that is NOT already first by audience, so a live-first
    // order is observably different from an audience-only order.
    const audienceOrder = (await catalog.roster()).map((s) => s.slug);
    const lift = audienceOrder[audienceOrder.length - 1];

    await b.open(ch(lift), whip);

    const roster = await catalog.roster();
    expect(roster[0].slug).toBe(lift);
    expect(roster[0].isLive).toBe(true);
  });
});
