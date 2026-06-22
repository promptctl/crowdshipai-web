/**
 * Node-runtime adapters for the identity capability ports: the real clock,
 * CSPRNG id/token minting, scrypt-backed credential storage, and durable SQLite
 * stores. These are the effectful edges [LAW:effects-at-boundaries] that the pure
 * `@crowdship/identity` core declares as seams — adopted crypto and the runtime's
 * own SQLite, not reinvented, plugged in behind the same interfaces the in-memory
 * test doubles satisfy.
 */
export { SystemClock } from './system-clock.js';
export { CryptoIdMint, CryptoSecretMint } from './crypto-mints.js';

export { ScryptCredentialStore, DEFAULT_SCRYPT_PARAMS } from './scrypt-credentials.js';
export type { ScryptParams } from './scrypt-credentials.js';

export { openIdentityDb } from './identity-db.js';
export { SqliteAuthStore } from './sqlite-auth-store.js';
export { SqliteCredentialStore } from './sqlite-credentials.js';
export { SqliteChannelStore } from './sqlite-channel-store.js';
export { SqliteSanctionStore } from './sqlite-sanction-store.js';
