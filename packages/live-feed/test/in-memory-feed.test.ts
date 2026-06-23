import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  createInMemoryLiveFeed,
  liveEventType,
  liveTopic,
  type LiveEvent,
  type LiveTopic,
} from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const AT = must(timestamp(1_700_000_000_000));
const topicA: LiveTopic = must(liveTopic('channel:ada'));
const topicB: LiveTopic = must(liveTopic('channel:linus'));

/** Build a live event with a distinguishing payload, so a test can assert exactly
 *  which event a watcher received. */
const event = (payload: LiveEvent['payload'], at: Timestamp = AT): LiveEvent => ({
  type: must(liveEventType('effect-fired')),
  at,
  payload,
});

/** A watcher that records, in order, every event it is handed. */
const recorder = (): { seen: LiveEvent[]; watch: (e: LiveEvent) => void } => {
  const seen: LiveEvent[] = [];
  return { seen, watch: (e) => seen.push(e) };
};

describe('createInMemoryLiveFeed', () => {
  it('fans a published event out to every watcher of the topic', async () => {
    const feed = createInMemoryLiveFeed();
    const a = recorder();
    const b = recorder();
    feed.subscribe(topicA, a.watch);
    feed.subscribe(topicA, b.watch);

    const fired = event({ shout: 'gg' });
    await feed.publish(topicA, fired);

    expect(a.seen).toEqual([fired]);
    expect(b.seen).toEqual([fired]);
  });

  it('delivers the event verbatim — type, at, and payload unchanged', async () => {
    const feed = createInMemoryLiveFeed();
    const a = recorder();
    feed.subscribe(topicA, a.watch);

    const fired = event({ nested: { count: 3 }, list: [1, true, null] }, must(timestamp(1_700_000_001_000)));
    await feed.publish(topicA, fired);

    expect(a.seen).toHaveLength(1);
    expect(a.seen[0]).toEqual(fired);
  });

  it('is LIVE not history: a watcher attached after a publish does not receive the earlier event', async () => {
    const feed = createInMemoryLiveFeed();
    await feed.publish(topicA, event({ before: true }));

    const late = recorder();
    feed.subscribe(topicA, late.watch);

    expect(late.seen).toEqual([]);
  });

  it('isolates topics: a publish to one topic reaches no watcher of another', async () => {
    const feed = createInMemoryLiveFeed();
    const onA = recorder();
    const onB = recorder();
    feed.subscribe(topicA, onA.watch);
    feed.subscribe(topicB, onB.watch);

    await feed.publish(topicA, event({ for: 'a' }));

    expect(onA.seen).toHaveLength(1);
    expect(onB.seen).toEqual([]);
  });

  it('stops delivery to a closed subscription while leaving the others', async () => {
    const feed = createInMemoryLiveFeed();
    const staying = recorder();
    const leaving = recorder();
    feed.subscribe(topicA, staying.watch);
    const sub = feed.subscribe(topicA, leaving.watch);

    sub.close();
    await feed.publish(topicA, event({ after: 'close' }));

    expect(staying.seen).toHaveLength(1);
    expect(leaving.seen).toEqual([]);
  });

  it('closes idempotently — closing an already-closed subscription is a no-op', async () => {
    const feed = createInMemoryLiveFeed();
    const a = recorder();
    const sub = feed.subscribe(topicA, a.watch);

    sub.close();
    expect(() => sub.close()).not.toThrow();

    await feed.publish(topicA, event({ x: 1 }));
    expect(a.seen).toEqual([]);
  });

  it('a stale double-close does not evict a fresh subscription that reused the topic', async () => {
    const feed = createInMemoryLiveFeed();
    const first = recorder();
    const sub1 = feed.subscribe(topicA, first.watch);
    sub1.close(); // topic A's last watcher leaves; the topic is dropped internally

    const fresh = recorder();
    feed.subscribe(topicA, fresh.watch); // a brand-new watcher reuses topic A

    sub1.close(); // the idempotent no-op the contract promises — must NOT touch the fresh watch

    await feed.publish(topicA, event({ live: true }));
    expect(fresh.seen).toHaveLength(1);
  });

  it('treats the same function watching twice as two independent subscriptions', async () => {
    const feed = createInMemoryLiveFeed();
    const a = recorder();
    const first = feed.subscribe(topicA, a.watch);
    feed.subscribe(topicA, a.watch);

    await feed.publish(topicA, event({ n: 1 }));
    expect(a.seen).toHaveLength(2);

    // Closing one of the two leaves the other delivering.
    first.close();
    await feed.publish(topicA, event({ n: 2 }));
    expect(a.seen).toHaveLength(3);
  });

  it('publishing to a topic with no watchers is a no-op success', async () => {
    const feed = createInMemoryLiveFeed();
    await expect(feed.publish(topicA, event({ heard: 'by no one' }))).resolves.toBeUndefined();
  });

  it('delivers to the snapshot of watchers at publish time — a watcher that subscribes during delivery is not joined mid-fan-out', async () => {
    const feed = createInMemoryLiveFeed();
    const latecomer = recorder();
    // A watcher that, when it fires, tries to subscribe a new watcher to the same topic.
    feed.subscribe(topicA, () => {
      feed.subscribe(topicA, latecomer.watch);
    });

    await feed.publish(topicA, event({ first: true }));

    // The latecomer joined during the fan-out and so missed the in-flight event;
    // ordering of callbacks cannot smuggle it in [LAW:no-ambient-temporal-coupling].
    expect(latecomer.seen).toEqual([]);

    await feed.publish(topicA, event({ second: true }));
    expect(latecomer.seen).toHaveLength(1);
  });
});

describe('liveTopic / liveEventType', () => {
  it('rejects a blank topic at the trust boundary', () => {
    expect(liveTopic('   ').ok).toBe(false);
  });

  it('rejects a blank event type at the trust boundary', () => {
    expect(liveEventType('').ok).toBe(false);
  });
});
