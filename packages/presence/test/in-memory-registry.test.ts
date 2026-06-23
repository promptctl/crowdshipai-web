import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { createInMemoryPresenceRegistry, presenceTopic, type PresenceTopic } from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const ada: PresenceTopic = must(presenceTopic('channel:ada'));
const linus: PresenceTopic = must(presenceTopic('channel:linus'));

describe('createInMemoryPresenceRegistry', () => {
  it('counts zero on a topic no one is watching', () => {
    const presence = createInMemoryPresenceRegistry();
    expect(presence.countOf(ada)).toBe(0);
  });

  it('counts each joined viewer, and the same viewer in two tabs as two', () => {
    const presence = createInMemoryPresenceRegistry();
    presence.join(ada);
    expect(presence.countOf(ada)).toBe(1);
    presence.join(ada);
    expect(presence.countOf(ada)).toBe(2);
  });

  it('drops the count by one when a viewer releases', () => {
    const presence = createInMemoryPresenceRegistry();
    const a = presence.join(ada);
    presence.join(ada);
    expect(presence.countOf(ada)).toBe(2);

    a.release();
    expect(presence.countOf(ada)).toBe(1);
  });

  it('returns to zero when the last viewer leaves', () => {
    const presence = createInMemoryPresenceRegistry();
    const a = presence.join(ada);
    a.release();
    expect(presence.countOf(ada)).toBe(0);
  });

  it('releases idempotently — a second release of the same presence does not double-count down', () => {
    const presence = createInMemoryPresenceRegistry();
    const a = presence.join(ada);
    presence.join(ada);

    a.release();
    expect(() => a.release()).not.toThrow();
    // The lone double-release must not steal the OTHER viewer's presence.
    expect(presence.countOf(ada)).toBe(1);
  });

  it('never goes negative: releasing into an already-empty topic stays at zero', () => {
    const presence = createInMemoryPresenceRegistry();
    const a = presence.join(ada);
    a.release();
    a.release();
    a.release();
    expect(presence.countOf(ada)).toBe(0);
  });

  it('isolates topics: a viewer on one stream is not counted on another', () => {
    const presence = createInMemoryPresenceRegistry();
    presence.join(ada);
    expect(presence.countOf(ada)).toBe(1);
    expect(presence.countOf(linus)).toBe(0);
  });

  it('a stale double-release does not evict a fresh viewer who reused the topic', () => {
    const presence = createInMemoryPresenceRegistry();
    const first = presence.join(ada);
    first.release(); // the topic empties and is dropped internally

    presence.join(ada); // a brand-new viewer reuses the topic
    expect(presence.countOf(ada)).toBe(1);

    first.release(); // the idempotent no-op — must NOT evict the fresh viewer

    expect(presence.countOf(ada)).toBe(1);
  });
});

describe('presenceTopic', () => {
  it('rejects a blank topic at the trust boundary', () => {
    expect(presenceTopic('   ').ok).toBe(false);
  });
});
