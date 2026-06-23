import { DatabaseSync } from '@crowdship/node-std';

/**
 * Opens the identity database and brings its schema into existence — the single
 * place the durable identity tables are defined [LAW:one-source-of-truth]. The
 * SQLite stores ({@link SqliteAuthStore}, {@link SqliteCredentialStore},
 * {@link SqliteChannelStore}) share one handle returned here, so all identity
 * state lives in one file and one connection; the founder's "SQLite now, Postgres
 * as performance requires" path is a swap of this opener and the stores behind
 * their ports, nothing above.
 *
 * `location` is a filesystem path, or `':memory:'` for an ephemeral database
 * (the fast, isolated store the durable-parity tests run against).
 *
 * NOTE: `node:sqlite` is a stable-but-experimental Node built-in and emits one
 * ExperimentalWarning on first use — adopted deliberately as the zero-dependency,
 * no-native-compile SQLite that ships inside the runtime itself.
 *
 * Bearer tokens are stored only as a SHA-256 of the token (see the session and
 * recovery tables): a leak of this database hands an attacker no usable session
 * or recovery token, only an irreversible digest [LAW:no-silent-failure is not a
 * licence to store secrets in the clear].
 */
export const openIdentityDb = (location: string): DatabaseSync => {
  const db = new DatabaseSync(location);
  // `next build` collects page data in parallel worker PROCESSES that each open this
  // same file; without a busy timeout their concurrent opens and schema-creation writes
  // collide as `database is locked` the instant a lock is contended. With one, a
  // contended lock waits-and-retries up to this budget and — if the lock truly outlasts
  // it — still throws loudly [LAW:no-silent-failure — a bounded wait, never a silent
  // give-up or a swallowed error]. Set FIRST, before any other pragma, because the
  // `journal_mode = WAL` switch below itself takes a lock that must be allowed to wait.
  // This is the correct production posture too — concurrent requests serialize on the
  // writer the same way.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id         TEXT    PRIMARY KEY,
      email      TEXT    NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      roles      TEXT    NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS credentials (
      account_id TEXT    PRIMARY KEY,
      salt       BLOB    NOT NULL,
      hash       BLOB    NOT NULL,
      n          INTEGER NOT NULL,
      r          INTEGER NOT NULL,
      p          INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT    PRIMARY KEY,
      id         TEXT    NOT NULL,
      account_id TEXT    NOT NULL,
      issued_at  INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);
    CREATE TABLE IF NOT EXISTS recoveries (
      token_hash TEXT    PRIMARY KEY,
      account_id TEXT    NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (
      id           TEXT    PRIMARY KEY,
      owner_id     TEXT    NOT NULL UNIQUE,
      handle       TEXT    NOT NULL UNIQUE,
      display_name TEXT    NOT NULL,
      bio          TEXT    NOT NULL DEFAULT '',
      verification TEXT    NOT NULL DEFAULT 'none',
      created_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sanctions (
      seq        INTEGER PRIMARY KEY,
      account_id TEXT    NOT NULL,
      reason     TEXT    NOT NULL,
      issued_at  INTEGER NOT NULL,
      scope_kind TEXT    NOT NULL,
      until      INTEGER
    );
    CREATE INDEX IF NOT EXISTS sanctions_by_account ON sanctions (account_id);
  `);
  migrateAddRolesColumn(db);
  migrateAddVerificationColumn(db);
  return db;
};

/**
 * Bring a pre-`roles` accounts table up to schema. `CREATE TABLE IF NOT EXISTS`
 * never alters an existing table, so a database created before bb2.2 would lack
 * the `roles` column and every account read would fail loudly. This adds it
 * exactly once: guarded by the live column list so it is idempotent on a fresh
 * database (where the CREATE already made the column) and a reversible, explicit
 * migration on an old one [LAW:no-silent-failure]. Existing rows take the column
 * default `''` — an empty {@link RoleSet}, the honest "we do not know this legacy
 * account's capabilities", never a guessed default that silently grants one.
 */
const migrateAddRolesColumn = (db: DatabaseSync): void => {
  const columns = db.prepare('PRAGMA table_info(accounts)').all();
  const hasRoles = columns.some((column) => (column as { name?: unknown }).name === 'roles');
  if (!hasRoles) db.exec("ALTER TABLE accounts ADD COLUMN roles TEXT NOT NULL DEFAULT ''");
};

/**
 * Bring a pre-`verification` channels table up to schema — the same idempotent,
 * column-list-guarded shape as {@link migrateAddRolesColumn} [LAW:no-silent-failure].
 * A channels table created before bb2.4 lacks the column; this adds it exactly
 * once, and existing rows take the default `'none'` — the honest "this channel
 * carries no trust signal", never a guessed badge.
 */
const migrateAddVerificationColumn = (db: DatabaseSync): void => {
  const columns = db.prepare('PRAGMA table_info(channels)').all();
  const hasVerification = columns.some(
    (column) => (column as { name?: unknown }).name === 'verification',
  );
  if (!hasVerification) {
    db.exec("ALTER TABLE channels ADD COLUMN verification TEXT NOT NULL DEFAULT 'none'");
  }
};
