import { describe, expect, test } from 'vitest';

import type { NameStore } from '../src/index.js';

/**
 * The behavioural contract every {@link NameStore} must honour, asserted against
 * whatever `storeOf` returns — the process-local in-memory store and the durable
 * SQLite store both run this identical suite, so a caller can swap one for the other
 * behind the seam and rely on the same promises [LAW:behavior-not-structure]. The
 * durability- and cross-process-specific guarantees the in-memory store cannot make
 * are proven separately, against the durable store alone.
 *
 * `storeOf` returns a fresh, empty store per call so the cases do not bleed into each
 * other.
 */
export const nameStoreContract = (name: string, storeOf: () => NameStore): void => {
  describe(name, () => {
    const fp = (n: bigint): bigint => n; // fingerprints are opaque 128-bit values

    test('resolves a recorded name', async () => {
      const store = storeOf();
      await store.record(fp(42n), 'acct:mint');
      const names = await store.resolve([fp(42n)]);
      expect(names.get(fp(42n))).toBe('acct:mint');
    });

    test('a fingerprint with no recorded name is simply absent — never guessed', async () => {
      const store = storeOf();
      await store.record(fp(1n), 'acct:known');
      const names = await store.resolve([fp(1n), fp(2n)]);
      expect(names.get(fp(1n))).toBe('acct:known');
      expect(names.has(fp(2n))).toBe(false);
    });

    test('resolves a batch in one call, present and absent mixed', async () => {
      const store = storeOf();
      await store.record(fp(10n), 'reason:tip');
      await store.record(fp(20n), 'reason:bounty');
      const names = await store.resolve([fp(10n), fp(99n), fp(20n)]);
      expect([...names.entries()].sort()).toStrictEqual([
        [10n, 'reason:tip'],
        [20n, 'reason:bounty'],
      ].sort());
      expect(names.has(fp(99n))).toBe(false);
    });

    test('re-recording the same name under the same fingerprint is a no-op', async () => {
      const store = storeOf();
      await store.record(fp(7n), 'acct:wallet');
      await store.record(fp(7n), 'acct:wallet');
      const names = await store.resolve([fp(7n)]);
      expect(names.get(fp(7n))).toBe('acct:wallet');
    });

    test('write-once: the first name recorded for a fingerprint is authoritative', async () => {
      // Two different names under one fingerprint cannot happen in real use (the
      // fingerprint is a content hash of the name), but the seam must pin a single
      // answer so no two implementations can silently diverge here: the first wins.
      const store = storeOf();
      await store.record(fp(8n), 'acct:first');
      await store.record(fp(8n), 'acct:second');
      const names = await store.resolve([fp(8n)]);
      expect(names.get(fp(8n))).toBe('acct:first');
    });

    test('an empty batch resolves to an empty map without touching the store', async () => {
      const store = storeOf();
      const names = await store.resolve([]);
      expect(names.size).toBe(0);
    });

    test('preserves full 128-bit fingerprints without collision or truncation', async () => {
      const store = storeOf();
      const big = (1n << 127n) + 12345n; // exceeds a 64-bit integer
      const neighbour = big + 1n;
      await store.record(big, 'acct:big');
      await store.record(neighbour, 'acct:neighbour');
      const names = await store.resolve([big, neighbour]);
      expect(names.get(big)).toBe('acct:big');
      expect(names.get(neighbour)).toBe('acct:neighbour');
    });
  });
};
