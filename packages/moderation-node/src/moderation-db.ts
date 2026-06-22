import { createRequire } from 'node:module';

// `node:sqlite` is newer than most bundlers' built-ins lists (Vite, vite-node),
// which strip the `node:` prefix and then fail to resolve a bare `sqlite`. Loading
// it through a runtime require bound to this file bypasses static analysis, so the
// real Node built-in is resolved at run time under every bundler — types still come
// from `@types/node` via the `typeof import(...)` annotation [LAW:no-silent-failure].
// This is the third instance of the idiom (identity-node and ledger hold the others);
// platform-92o folds all three into one shared node-runtime home.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;

/**
 * Opens the moderation database and brings its schema into existence — the single
 * place the durable audit-trail table is defined [LAW:one-source-of-truth], the
 * moderation twin of identity-node's `openIdentityDb`. A SEPARATE file and connection
 * from the identity database: moderation history is its own domain, so it lives in its
 * own store rather than sharing identity's handle, which would couple this adapter to a
 * sibling adapter [LAW:one-way-deps]. The app holds the two handles side by side.
 *
 * `location` is a filesystem path, or `':memory:'` for an ephemeral database (the fast,
 * isolated store the durable-parity tests run against).
 *
 * The schema is one append-only log. `id` is the trail-assigned {@link EntryId},
 * UNIQUE so the store ENFORCES id uniqueness at its boundary [LAW:single-enforcer] —
 * the durable counterpart of the in-memory trail's explicit duplicate-id check; a
 * colliding minter fails loudly on insert rather than letting one resolution close two
 * entries [LAW:no-silent-failure]. `at` is the recorded instant. `kind` is the event
 * discriminant, denormalized out of the payload so a row is inspectable and the read
 * side can cross-check it against the stored body. `payload` is the whole
 * {@link ModerationEvent} as JSON — the event body round-trips verbatim, the moderation
 * types its single source of truth, never re-encoded as a second schema here. `seq` is
 * the monotonic insertion order `entries()` reads back, the order the log was written.
 *
 * NOTE: `node:sqlite` is a stable-but-experimental Node built-in and emits one
 * ExperimentalWarning on first use — adopted deliberately as the zero-dependency,
 * no-native-compile SQLite that ships inside the runtime itself.
 */
export const openModerationDb = (location: string): DatabaseSync => {
  const db = new DatabaseSync(location);
  // `next build` collects page data in parallel worker PROCESSES that each open this
  // same file; without a busy timeout their concurrent opens and schema-creation writes
  // collide as `database is locked` the instant a lock is contended. With one, a
  // contended lock waits-and-retries up to this budget and — if the lock truly outlasts
  // it — still throws loudly [LAW:no-silent-failure]. Set FIRST, before any other pragma,
  // because the `journal_mode = WAL` switch below itself takes a lock that must wait.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_events (
      seq     INTEGER PRIMARY KEY,
      id      TEXT    NOT NULL UNIQUE,
      at      INTEGER NOT NULL,
      kind    TEXT    NOT NULL,
      payload TEXT    NOT NULL
    );
  `);
  return db;
};
