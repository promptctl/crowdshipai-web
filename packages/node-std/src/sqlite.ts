import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncInstance, StatementSync } from 'node:sqlite';

// `node:sqlite` is the one SQLite engine this codebase uses — the zero-dependency,
// no-native-compile engine that ships inside the runtime — chosen over adding a second
// SQLite binding [LAW:one-type-per-behavior]. It is newer than most bundlers' built-ins
// lists (Vite, vite-node), which strip the `node:` prefix and then fail to resolve a
// bare `sqlite`; loading it through a runtime require bound to THIS file bypasses static
// analysis, so the real built-in resolves at run time under every bundler, while the
// types still come from `@types/node` via the `typeof import(...)` annotation. It is a
// stable-but-experimental built-in and emits one ExperimentalWarning on first use,
// accepted deliberately.
//
// This is the single home for that idiom [LAW:one-source-of-truth] — the loader is one
// behaviour, so it lives once here rather than re-copied into every store that opens a
// database. `createRequire(import.meta.url)` binds the require to this module's URL, but
// `'node:sqlite'` is an absolute built-in specifier, so the engine it resolves is
// identical no matter which file does the loading.
const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/**
 * The runtime SQLite engine constructor, resolved past bundler static analysis. The
 * value every durable store opens its handle with: `new DatabaseSync(location)`.
 */
export const DatabaseSync = sqlite.DatabaseSync;

/** The instance type of an open database — deliberately the same name as the value,
 *  so a caller imports `DatabaseSync` once and uses it as both constructor and type. */
export type DatabaseSync = DatabaseSyncInstance;

/** A prepared statement over an open database. */
export type { StatementSync };
