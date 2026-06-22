/**
 * The control-plane store: the words that go with the numbers. TigerBeetle stores
 * money, not strings — a domain account id and a movement's reason each reach the
 * engine only as a 128-bit fingerprint of their text (see `accountTbId` /
 * `reasonFingerprint`). The fingerprint is a one-way hash, so the verbatim string
 * cannot be read back out of the engine. This store keeps `fingerprint → string`
 * beside the engine so the audit/query API can show *which* account and *why*,
 * not just opaque hashes.
 *
 * It is strictly auxiliary — it never holds money or a balance, so it is not a
 * second authority that could drift from the ledger [LAW:one-source-of-truth]. The
 * engine remains the sole source of truth for value; this is only its dictionary.
 *
 * The seam is async so a durable, cross-process implementation (the production
 * follow-up) can sit behind it unchanged — the same "in-memory now, real engine
 * later" fork the rest of the ledger uses [LAW:locality-or-seam]. The in-memory
 * implementation here is process-local: it serves single-process audit and the
 * tests, and a movement's names are recoverable in the process that recorded them.
 */
export interface NameStore {
  /** Remember the verbatim string behind a fingerprint. Idempotent: recording the
   *  same `name` under the same `fingerprint` again is a no-op, so re-opening an
   *  account or replaying a movement is safe. */
  record(fingerprint: bigint, name: string): Promise<void>;

  /** Resolve a batch of fingerprints to the strings they were derived from, in one
   *  round trip. A fingerprint with no recorded name is simply absent from the
   *  returned map — the caller decides whether that absence is benign or, for a
   *  movement the engine recorded, corruption to surface loudly. */
  resolve(fingerprints: readonly bigint[]): Promise<ReadonlyMap<bigint, string>>;
}

/**
 * The in-memory {@link NameStore}: a single `Map` behind the seam. Used by the
 * fast tests and single-process audit; a durable implementation replaces it for
 * multi-process production without any caller changing [LAW:one-type-per-behavior].
 */
export class InMemoryNameStore implements NameStore {
  readonly #names = new Map<bigint, string>();

  record(fingerprint: bigint, name: string): Promise<void> {
    this.#names.set(fingerprint, name);
    return Promise.resolve();
  }

  resolve(fingerprints: readonly bigint[]): Promise<ReadonlyMap<bigint, string>> {
    const found = new Map<bigint, string>();
    for (const fingerprint of fingerprints) {
      const name = this.#names.get(fingerprint);
      if (name !== undefined) found.set(fingerprint, name);
    }
    return Promise.resolve(found);
  }
}

/** Builds the in-memory control-plane store. */
export const createInMemoryNameStore = (): NameStore => new InMemoryNameStore();
