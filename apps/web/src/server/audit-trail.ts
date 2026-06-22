import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { SystemClock } from '@crowdship/identity-node';
import { entryId, type AuditTrail, type EntryId } from '@crowdship/moderation';
import { createSqliteAuditTrail, openModerationDb } from '@crowdship/moderation-node';

/**
 * The single place the web app holds its moderation audit trail [LAW:single-enforcer] —
 * the system-of-record twin of `getSanctions()` and `getPolicyBoundary()`. Every path
 * that records a moderation event (a viewer filing a report, a reviewer resolving an
 * item) appends through this one {@link AuditTrail}, and every view of moderation
 * history — the review queue above all — is a PURE projection of its `entries()`, never
 * a second store that could drift from it [LAW:one-source-of-truth].
 *
 * The trail OWNS each entry's id and timestamp; the caller supplies only the event. So
 * the two effectful capabilities the trail needs are injected HERE at the composition
 * boundary [LAW:effects-at-boundaries] — the real {@link SystemClock} that stamps "now",
 * and a CSPRNG-backed id minter — never reached for inside the core.
 *
 * It is the durable SQLite trail, the moderation twin of the SQLite identity stores: a
 * filed report or a recorded incident now survives a server restart, behind the
 * unchanged {@link AuditTrail} seam that the in-memory fake stood in for. Moderation
 * history lives in its OWN `.data/moderation.db` file and handle, separate from the
 * identity database — a distinct domain in a distinct store, opened here once per
 * process and cached on `globalThis` exactly as the identity handle is, so Next.js dev
 * HMR reuses the connection instead of reopening the file on every edit
 * [LAW:no-shared-mutable-globals].
 */

/**
 * Mint a trail entry id from the platform CSPRNG. An id need only be unique, and a v4
 * UUID is past any collision concern — the same posture `CryptoIdMint` takes for account
 * and channel ids. A UUID is never blank, so `entryId` can only fail by programmer error;
 * we unwrap loudly at the seam rather than let a blank id silently stand in for a real,
 * trail-issued one [LAW:no-silent-failure].
 */
const newEntryId = (): EntryId => {
  const id = entryId(randomUUID());
  if (!id.ok) throw new Error(`audit-trail: invalid entry id: ${JSON.stringify(id.error)}`);
  return id.value;
};

const openDb = (): DatabaseSync => {
  const dir = join(process.cwd(), '.data');
  mkdirSync(dir, { recursive: true });
  return openModerationDb(join(dir, 'moderation.db'));
};

// One moderation DB handle per process — the single owner of moderation storage
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR reuses the
// handle instead of reopening the file each time, the same posture identity.ts takes.
const globalForDb = globalThis as unknown as { __crowdshipModerationDb?: DatabaseSync };
const moderationDb: DatabaseSync = globalForDb.__crowdshipModerationDb ?? openDb();
if (process.env.NODE_ENV !== 'production') globalForDb.__crowdshipModerationDb = moderationDb;

const auditTrail: AuditTrail = createSqliteAuditTrail(moderationDb, { clock: new SystemClock(), newEntryId });

export const getAuditTrail = (): AuditTrail => auditTrail;
