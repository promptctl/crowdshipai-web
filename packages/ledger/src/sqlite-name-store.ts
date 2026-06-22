import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { NameStore } from './name-store.js';

// `node:sqlite` is the one SQLite engine this codebase uses — the zero-dependency,
// no-native-compile engine that ships inside the runtime — chosen here over adding a
// second SQLite binding [LAW:one-type-per-behavior]. It is newer than most bundlers'
// built-ins lists, which strip the `node:` prefix and then fail to resolve a bare
// `sqlite`; loading it through a runtime require bound to this file bypasses static
// analysis so the real built-in resolves under every bundler, while types still come
// from `@types/node` via the `typeof import(...)` annotation. It is a
// stable-but-experimental built-in and emits one ExperimentalWarning on first use,
// accepted deliberately.
//
// The same loader idiom also lives in the identity stores. That is a deliberate,
// transitional duplication: the engine choice is one behaviour, but its only correct
// home is a shared node-runtime package that does not yet exist — `std` and the
// ledger kernel are both intentionally node-free and may not host it [LAW:one-way-deps].
// Extracting it is a small focused cross-package pass, not something to smuggle into a
// ledger ticket — the same call this repo already makes for its other cross-package
// primitive duplication.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;

/**
 * The durable, cross-process {@link NameStore}: the same fingerprint→string
 * dictionary the in-memory store holds, kept in a single SQLite file so a name one
 * process records is resolvable by any other, and survives a restart. This is the
 * production follow-up the seam was shaped for — it slots in behind `NameStore`
 * with no caller change [LAW:locality-or-seam].
 *
 * Why a database and not a hand-rolled file: a durable, multi-writer, concurrent
 * dictionary *is* a database, so we reuse SQLite rather than reinvent locking, fsync,
 * and crash-recovery. It mirrors the project's larger bet — TigerBeetle owns the
 * money, SQLite owns the money's *dictionary*; neither is rebuilt here.
 *
 * It is still strictly auxiliary — it holds no balance, so it is no second authority
 * that could drift from the engine [LAW:one-source-of-truth]. A name lost here is a
 * loud "name gap" at audit time, never silent wrong money: the coins stay intact in
 * TigerBeetle. The 128-bit fingerprint exceeds SQLite's 64-bit integer, so it is
 * stored as its base-16 string; the value round-trips exactly.
 */
export class SqliteNameStore implements NameStore {
  readonly #db: DatabaseSync;
  readonly #insert: import('node:sqlite').StatementSync;
  readonly #select: import('node:sqlite').StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    // WAL lets readers run while a writer holds the lock — the shared-reader case
    // this store exists for. NORMAL fsyncs at each checkpoint: durable across an app
    // crash, and a name lost to an OS-level crash degrades to a loud name gap, never
    // to wrong money [LAW:no-silent-failure]. busy_timeout makes a concurrent writer
    // *wait* for the lock instead of failing the write, so cross-process records that
    // collide in time both land rather than one silently erroring.
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    // One store owns one table, so this store owns its own schema [LAW:decomposition];
    // it does not share the identity database. `IF NOT EXISTS` makes opening an
    // existing file idempotent.
    db.exec('CREATE TABLE IF NOT EXISTS names (fingerprint TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT');

    // First write of a fingerprint wins and later records of it are no-ops. The
    // fingerprint is a one-way hash of the name, so any later record under the same
    // fingerprint carries the same name by construction — idempotent re-opens and
    // movement replays are safe, matching the in-memory store exactly [LAW:behavior-not-structure].
    this.#insert = db.prepare('INSERT INTO names (fingerprint, name) VALUES (?, ?) ON CONFLICT(fingerprint) DO NOTHING');
    // One prepared statement resolves a batch of any size: the keys arrive as a JSON
    // array and `json_each` unrolls them into the IN-set, so no SQL is built per call.
    this.#select = db.prepare('SELECT fingerprint, name FROM names WHERE fingerprint IN (SELECT value FROM json_each(?))');
  }

  record(fingerprint: bigint, name: string): Promise<void> {
    this.#insert.run(toKey(fingerprint), name);
    return Promise.resolve();
  }

  resolve(fingerprints: readonly bigint[]): Promise<ReadonlyMap<bigint, string>> {
    const found = new Map<bigint, string>();
    if (fingerprints.length === 0) return Promise.resolve(found);
    const rows = this.#select.all(JSON.stringify(fingerprints.map(toKey)));
    for (const row of rows) found.set(fromKey(reqStr(row, 'fingerprint')), reqStr(row, 'name'));
    return Promise.resolve(found);
  }

  /** Releases the file handle and checkpoints the WAL. The owner that opened this
   *  store closes it — it is not closed by a `Ledger` it was injected into, which
   *  did not open it [LAW:no-ambient-temporal-coupling]. */
  close(): void {
    this.#db.close();
  }
}

// The 128-bit fingerprint as its canonical base-16 string and back. Hex round-trips
// the value exactly, so the map this store returns is keyed by the same bigints the
// caller asked for.
const toKey = (fingerprint: bigint): string => fingerprint.toString(16);
const fromKey = (key: string): bigint => BigInt(`0x${key}`);

// Read a column that must be a string; anything else is a corrupt durable record,
// halted loudly rather than smuggled onward as a malformed name [LAW:no-silent-failure].
const reqStr = (row: unknown, column: string): string => {
  const value = (row as Record<string, unknown>)[column];
  if (typeof value !== 'string') {
    throw new Error(`sqlite-name-store: column ${column} is not a string: ${JSON.stringify(value)}`);
  }
  return value;
};

/**
 * Opens (creating if absent) a durable {@link SqliteNameStore} at `location`, a
 * filesystem path — building any missing parent directories — or `':memory:'` for an
 * ephemeral store (the fast, isolated store the contract tests run against). The
 * caller owns the returned store's lifecycle and calls `close()` when done.
 */
export const createSqliteNameStore = (location: string): SqliteNameStore => {
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
  return new SqliteNameStore(new DatabaseSync(location));
};
