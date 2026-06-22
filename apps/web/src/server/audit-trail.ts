import { randomUUID } from 'node:crypto';

import { SystemClock } from '@crowdship/identity-node';
import { createInMemoryAuditTrail, entryId, type AuditTrail, type EntryId } from '@crowdship/moderation';

/**
 * The single place the web app holds its moderation audit trail [LAW:single-enforcer] —
 * the system-of-record twin of `getSanctions()` and `getPolicyBoundary()`. Every path
 * that records a moderation event (a viewer filing a report, a reviewer resolving an
 * item) appends through this one {@link AuditTrail}, and every view of moderation
 * history — the review queue above all — is a PURE projection of its `entries()`, never
 * a second store that could drift from it [LAW:one-source-of-truth].
 *
 * The trail OWNS each entry's id and timestamp; the caller supplies only the event. So
 * the two effectful capabilities the in-memory trail needs are injected HERE at the
 * composition boundary [LAW:effects-at-boundaries] — the real {@link SystemClock} that
 * stamps "now", and a CSPRNG-backed id minter — never reached for inside the core.
 *
 * It is the in-memory trail: correct for one process, the dev/test stand-in behind the
 * {@link AuditTrail} seam. Unlike the policy boundary it CARRIES STATE (the append-only
 * log), so it is cached on `globalThis` exactly as the ingest broker is, or Next.js dev
 * HMR would re-evaluate this module and wipe the queue between edits. A durable
 * `AuditTrail` store (the moderation twin of `SqliteSanctionStore`) is the swap this
 * seam is shaped for; until it lands the trail is honestly per-process, not silently
 * pretending to persist [LAW:no-silent-failure].
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

const globalForTrail = globalThis as unknown as { __crowdshipAuditTrail?: AuditTrail };
const auditTrail: AuditTrail =
  globalForTrail.__crowdshipAuditTrail ?? createInMemoryAuditTrail({ clock: new SystemClock(), newEntryId });
if (process.env.NODE_ENV !== 'production') globalForTrail.__crowdshipAuditTrail = auditTrail;

export const getAuditTrail = (): AuditTrail => auditTrail;
