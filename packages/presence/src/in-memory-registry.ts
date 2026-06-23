import type { PresenceHandle, PresenceRegistry } from './registry.js';
import type { PresenceTopic } from './topic.js';

/**
 * The in-memory presence registry: correct for a single process and for tests, the
 * dev/test stand-in behind the {@link PresenceRegistry} seam that a real cross-instance
 * backend (a Redis set, a presence service) replaces with no caller change
 * [LAW:locality-or-seam] — mirroring `createInMemoryLiveFeed` and
 * `createInMemoryIngestBroker`.
 *
 * A topic's presence is a SET of session ids, one minted per `join`, and the count is
 * the set's size. Representing occupancy as a set rather than an integer counter makes
 * the two ways a count could go wrong UNREPRESENTABLE [LAW:types-are-the-program]: a
 * release-without-a-matching-join cannot drive the count negative (there is no id to
 * remove), and a double-release is the set deleting an absent id — a true no-op, the
 * idempotence the handle promises [LAW:no-defensive-null-guards], with no `Math.max(0,…)`
 * guard papering over an illegal state.
 */
export const createInMemoryPresenceRegistry = (): PresenceRegistry => {
  const present = new Map<PresenceTopic, Set<number>>();
  // A monotonic id makes each presence its own member of the set, so the same viewer
  // joining twice (two tabs) counts twice and each releases independently — and so a
  // stale handle can never collide with a fresh one [LAW:one-source-of-truth — the id
  // is the presence's identity, not the topic]. A counter, not a clock or random, so
  // it stays deterministic for tests.
  let nextId = 0;

  const join = (topic: PresenceTopic): PresenceHandle => {
    const ids = present.get(topic) ?? new Set<number>();
    present.set(topic, ids);
    const id = (nextId += 1);
    ids.add(id);
    return {
      release: () => {
        ids.delete(id);
        // Drop an emptied topic, but ONLY while the map still holds THIS set: a stale
        // double-release (the idempotent no-op the contract promises) acts on the
        // captured set, which may already have been dropped and the topic reused by a
        // fresh join's set — deleting on size alone would silently evict that live
        // presence [LAW:one-source-of-truth — `present.get` is authoritative, the
        // captured reference is a stale copy].
        if (ids.size === 0 && present.get(topic) === ids) present.delete(topic);
      },
    };
  };

  // Absence of a topic is a real, empty occupancy — zero, not a guard hiding a missing
  // step [LAW:no-defensive-null-guards].
  const countOf = (topic: PresenceTopic): number => present.get(topic)?.size ?? 0;

  return { join, countOf };
};
