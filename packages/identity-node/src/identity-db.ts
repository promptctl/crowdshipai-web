import { createRequire } from 'node:module';

// `node:sqlite` is newer than most bundlers' built-ins lists (Vite, vite-node),
// which strip the `node:` prefix and then fail to resolve a bare `sqlite`. Loading
// it through a runtime require bound to this file bypasses static analysis, so the
// real Node built-in is resolved at run time under every bundler — types still
// come from `@types/node` via the `typeof import(...)` annotation [LAW:no-silent-failure].
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;

/**
 * Opens the identity database and brings its schema into existence — the single
 * place the durable identity tables are defined [LAW:one-source-of-truth]. The
 * SQLite stores ({@link SqliteAuthStore}, {@link SqliteCredentialStore}) share
 * one handle returned here, so all identity state lives in one file and one
 * connection; the founder's "SQLite now, Postgres as performance requires" path
 * is a swap of this opener and the stores behind their ports, nothing above.
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
  `);
  migrateAddRolesColumn(db);
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
