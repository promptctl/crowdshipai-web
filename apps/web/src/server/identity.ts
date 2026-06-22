import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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

const build = (): AuthService => {
  const dir = join(process.cwd(), '.data');
  mkdirSync(dir, { recursive: true });
  const db = openIdentityDb(join(dir, 'identity.db'));
  return new StandardAuthService({
    clock: new SystemClock(),
    ids: new CryptoIdMint(),
    secrets: new CryptoSecretMint(),
    credentials: new SqliteCredentialStore(db),
    delivery: new ConsoleRecoveryDelivery(),
    store: new SqliteAuthStore(db),
    sessionTtlMillis: SESSION_TTL_MILLIS,
    recoveryTtlMillis: RECOVERY_TTL_MILLIS,
  });
};

// One service (one DB handle) per process, the single owner of identity storage
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR, which
// re-evaluates modules, reuses the handle instead of reopening the file each time.
const globalForAuth = globalThis as unknown as { __crowdshipAuth?: AuthService };
const authService: AuthService = globalForAuth.__crowdshipAuth ?? build();
if (process.env.NODE_ENV !== 'production') globalForAuth.__crowdshipAuth = authService;

export const getAuthService = (): AuthService => authService;
