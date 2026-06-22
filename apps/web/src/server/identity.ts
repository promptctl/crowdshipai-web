import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { AuthService, Email, RecoveryDelivery, RecoveryToken } from '@crowdship/identity';
import { StandardAuthService } from '@crowdship/identity';
import {
  CryptoIdMint,
  CryptoSecretMint,
  SqliteAuthStore,
  SqliteCredentialStore,
  SystemClock,
  openIdentityDb,
} from '@crowdship/identity-node';

/**
 * The single place the web app decides which {@link AuthService} it runs against
 * [LAW:one-source-of-truth] — the identity twin of `getCatalog()`. Every route,
 * action, and the NextAuth provider reach identity through `getAuthService()`, so
 * swapping the durable store (SQLite today, Postgres "as performance requires")
 * or the whole service is a change HERE and nowhere else [LAW:single-enforcer].
 *
 * It also owns the single identity DB handle ({@link getIdentityDb}). The channel
 * service (`channels.ts`) is a SEPARATE composition root that runs over the SAME
 * handle — all identity state (accounts, sessions, channels) lives in one file and
 * one connection, so the two services can never read divergent copies of it
 * [LAW:one-source-of-truth]. The handle is opened here once, never per-service.
 */

const SESSION_TTL_MILLIS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RECOVERY_TTL_MILLIS = 1000 * 60 * 30; // 30 minutes

/**
 * The walking-skeleton out-of-band channel: write the recovery token to the
 * server log. It is honest — the token really is surfaced, loudly and visibly,
 * never swallowed [LAW:no-silent-failure] — and swaps for real email behind this
 * same {@link RecoveryDelivery} seam without touching the auth lifecycle.
 */
class ConsoleRecoveryDelivery implements RecoveryDelivery {
  deliver(address: Email, token: RecoveryToken): Promise<void> {
    console.info(`[identity] recovery token for ${address}: ${token}`);
    return Promise.resolve();
  }
}

const openDb = (): DatabaseSync => {
  const dir = join(process.cwd(), '.data');
  mkdirSync(dir, { recursive: true });
  return openIdentityDb(join(dir, 'identity.db'));
};

// One DB handle per process — the single owner of identity storage
// [LAW:no-shared-mutable-globals]. Both the auth service below and the channel
// service (channels.ts) run over THIS handle, never a second connection to the same
// file. Cached on globalThis so Next.js dev HMR, which re-evaluates modules, reuses
// the handle instead of reopening the file each time.
const globalForDb = globalThis as unknown as { __crowdshipIdentityDb?: DatabaseSync };
const identityDb: DatabaseSync = globalForDb.__crowdshipIdentityDb ?? openDb();
if (process.env.NODE_ENV !== 'production') globalForDb.__crowdshipIdentityDb = identityDb;

/** The single identity DB handle, for the other identity-domain composition roots that share it. */
export const getIdentityDb = (): DatabaseSync => identityDb;

const build = (): AuthService =>
  new StandardAuthService({
    clock: new SystemClock(),
    ids: new CryptoIdMint(),
    secrets: new CryptoSecretMint(),
    credentials: new SqliteCredentialStore(identityDb),
    delivery: new ConsoleRecoveryDelivery(),
    store: new SqliteAuthStore(identityDb),
    sessionTtlMillis: SESSION_TTL_MILLIS,
    recoveryTtlMillis: RECOVERY_TTL_MILLIS,
  });

// One auth service per process, over the shared handle. Cached on globalThis for the
// same HMR reason as the handle itself.
const globalForAuth = globalThis as unknown as { __crowdshipAuth?: AuthService };
const authService: AuthService = globalForAuth.__crowdshipAuth ?? build();
if (process.env.NODE_ENV !== 'production') globalForAuth.__crowdshipAuth = authService;

export const getAuthService = (): AuthService => authService;
