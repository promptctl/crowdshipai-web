import { createInMemoryLiveFeed, liveEventType, liveTopic, type LiveEvent } from '@crowdship/live-feed';
import { createInMemoryPresenceRegistry, presenceTopic } from '@crowdship/presence';
import type { Result } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { EFFECT_FIRED_EVENT, PRESENCE_EVENT, parseFiredEffect, parseViewerPresence } from '../src/data/live-event';
import { createWatchEventStream } from '../src/server/watch-event-stream';

/**
 * The watch event stream is the one owner of a viewer's connection lifecycle: subscribe,
 * join presence, announce the count, and tear all three down in the right order. These
 * tests drive a REAL `ReadableStream` against a real feed and registry — the coverage
 * the lifecycle could not have while it was welded to a Next route handler. The sharpest
 * of them pins the teardown ordering: a leaving viewer must NOT fan its own leave-frame
 * back into its dead controller, because that throw leaks the subscription and starves
 * every other watcher's fan-out [LAW:no-ambient-temporal-coupling].
 */

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const AT = must(timestamp(1_700_000_000_000));
const decoder = new TextDecoder();

/** Read the next SSE `data:` frame's payload off a reader, skipping the opening `:`
 *  comment — returns the JSON string a client's `onmessage` would receive as `e.data`. */
const nextData = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done || value === undefined) throw new Error('stream ended before a data frame');
    const chunk = decoder.decode(value);
    if (chunk.startsWith('data:')) return chunk.slice('data:'.length).trim();
  }
};

const presenceLiveEvent = (count: number): LiveEvent => ({
  type: must(liveEventType(PRESENCE_EVENT)),
  at: AT,
  payload: { count },
});

const firedLiveEvent = (effectKind: string): LiveEvent => ({
  type: must(liveEventType(EFFECT_FIRED_EVENT)),
  at: AT,
  payload: { effectKind },
});

/** A fresh feed + registry + the announce bridge wired exactly as the app wires it:
 *  the count is read from the registry and published onto the same topic the streams
 *  subscribe to, so a join/leave announce reaches every watcher the way it does live. */
const setup = () => {
  const feed = createInMemoryLiveFeed();
  const topic = must(liveTopic('channel:ada'));
  const registry = createInMemoryPresenceRegistry();
  const pTopic = must(presenceTopic('channel:ada'));
  const counts: number[] = [];
  const announcePresence = (count: number): Promise<void> => {
    counts.push(count);
    return feed.publish(topic, presenceLiveEvent(count));
  };
  const baseDeps = { feed, topic, registry, presenceTopic: pTopic, announcePresence };
  return { feed, topic, registry, pTopic, counts, baseDeps };
};

describe('createWatchEventStream', () => {
  it('announces the joining viewer their own count over the same connection', async () => {
    const { registry, pTopic, counts, baseDeps } = setup();
    const ac = new AbortController();
    const reader = createWatchEventStream({ ...baseDeps, signal: ac.signal }).getReader();

    expect(registry.countOf(pTopic)).toBe(1);
    expect(parseViewerPresence(await nextData(reader))).toEqual({ count: 1 });
    expect(counts).toEqual([1]);

    ac.abort();
  });

  it('a second viewer joining bumps the live count for the watcher already there', async () => {
    const { baseDeps } = setup();
    const ac1 = new AbortController();
    const r1 = createWatchEventStream({ ...baseDeps, signal: ac1.signal }).getReader();
    expect(parseViewerPresence(await nextData(r1))).toEqual({ count: 1 });

    const ac2 = new AbortController();
    createWatchEventStream({ ...baseDeps, signal: ac2.signal }).getReader();
    // The second join announces count 2 onto the topic; the first viewer receives it.
    expect(parseViewerPresence(await nextData(r1))).toEqual({ count: 2 });

    ac1.abort();
    ac2.abort();
  });

  it('a cancelled viewer leaves cleanly without leaking a dead subscriber or starving the rest', async () => {
    const { feed, topic, registry, pTopic, baseDeps } = setup();
    const ac1 = new AbortController();
    const r1 = createWatchEventStream({ ...baseDeps, signal: ac1.signal }).getReader();

    const ac2 = new AbortController();
    const r2 = createWatchEventStream({ ...baseDeps, signal: ac2.signal }).getReader();
    expect(registry.countOf(pTopic)).toBe(2);
    // Drain viewer 2's own join frame so the next read is deterministic.
    expect(parseViewerPresence(await nextData(r2))).toEqual({ count: 2 });

    // Cancelling routes through the stream's `cancel()` → leave(): close this viewer's
    // subscription, release presence, announce the lower count. Because the subscription
    // closes BEFORE the announce, the leave-frame never fans back into this connection's
    // own tearing-down controller — it reaches only the survivors. cancel() resolves and
    // the registry count drops to exactly the remaining viewers.
    await expect(r1.cancel()).resolves.toBeUndefined();
    expect(registry.countOf(pTopic)).toBe(1);

    // Viewer 2 receives the departure count — the announce reached the survivors.
    expect(parseViewerPresence(await nextData(r2))).toEqual({ count: 1 });

    // And the fan-out is intact: a fresh publish still reaches viewer 2. A leaked dead
    // subscriber would have thrown here and starved this delivery.
    await feed.publish(topic, firedLiveEvent('shoutout'));
    expect(parseFiredEffect(await nextData(r2))).toEqual({ effectKind: 'shoutout' });

    ac2.abort();
  });

  it('a viewer leaving via the abort path releases presence and announces the lower count to the rest', async () => {
    const { registry, pTopic, baseDeps } = setup();
    const ac1 = new AbortController();
    const r1 = createWatchEventStream({ ...baseDeps, signal: ac1.signal }).getReader();
    await nextData(r1); // its own join (count 1)

    const ac2 = new AbortController();
    const r2 = createWatchEventStream({ ...baseDeps, signal: ac2.signal }).getReader();
    await nextData(r2); // viewer 2's join (count 2)
    await nextData(r1); // viewer 1 sees the bump to 2

    ac1.abort(); // viewer 1 leaves via the abort signal path
    expect(registry.countOf(pTopic)).toBe(1);
    expect(parseViewerPresence(await nextData(r2))).toEqual({ count: 1 });

    ac2.abort();
  });
});
