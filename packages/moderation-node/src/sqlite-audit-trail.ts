import type { DatabaseSync } from 'node:sqlite';

import {
  entryId,
  type AuditTrail,
  type AuditTrailDeps,
  type ModerationEvent,
  type RecordedEvent,
} from '@crowdship/moderation';
import { timestamp } from '@crowdship/std';

import { orThrow, reqInt, reqStr } from './internal.js';

type Row = Record<string, unknown>;

const SELECT = 'SELECT id, at, kind, payload FROM moderation_events ORDER BY seq';

/**
 * Rebuild one {@link RecordedEvent} from its row. The ENVELOPE the store denormalizes
 * into columns — the {@link EntryId} and the {@link Timestamp} the trail owns — flows
 * back through the same trust-boundary constructors that admitted it, so a corrupt id
 * or a non-integer instant halts the read rather than reading back a malformed entry
 * [LAW:no-silent-failure]. The event BODY is reconstructed whole from its JSON payload:
 * the moderation types are its one source of truth [LAW:one-source-of-truth], so this
 * store reconstructs the value the writer serialized rather than re-validating every
 * nested field against a second copy of those types — which is exactly the behavioural
 * PARITY the {@link AuditTrail} seam asks of a durable store, the in-memory reference
 * stores and returns the event whole too. What the medium itself can break — an
 * unparseable payload, or a payload whose `kind` disagrees with the denormalized
 * discriminant — is surfaced loudly here, never coerced into a plausible-but-wrong
 * event.
 */
const toRecordedEvent = (row: Row): RecordedEvent => {
  const id = orThrow(entryId(reqStr(row, 'id')), 'moderation_events.id');
  const at = orThrow(timestamp(reqInt(row, 'at')), 'moderation_events.at');
  const kind = reqStr(row, 'kind');

  const parsed: unknown = JSON.parse(reqStr(row, 'payload'));
  if (typeof parsed !== 'object' || parsed === null || (parsed as { kind?: unknown }).kind !== kind) {
    throw new Error(
      `moderation-node: moderation_events.payload does not match its ${kind} discriminant: ${reqStr(row, 'payload')}`,
    );
  }
  // The event body's shape is guaranteed at the write edge by the typed `record(event)`
  // call, so it is reconstructed whole rather than re-litigated here against a duplicate
  // validator that would fork the moderation types' one source of truth.
  return { id, at, event: parsed as ModerationEvent };
};

/**
 * The durable {@link AuditTrail}: moderation history persisted in SQLite so a filed
 * report or a recorded incident survives a restart, the moderation twin of
 * identity-node's `SqliteSanctionStore` behind the unchanged seam — `getAuditTrail()`
 * swaps the in-memory fake for this with NO caller change [LAW:locality-or-seam]. The
 * review queue and every other view stay PURE projections of `entries()`, now reading a
 * store that outlives the process [LAW:one-source-of-truth].
 *
 * Append-only is the table's shape, not merely a convention: there is no UPDATE and no
 * DELETE, because an audit trail you can rewrite is not one [LAW:no-silent-failure]. The
 * trail OWNS each entry's id and timestamp, so the two effectful capabilities the
 * in-memory fake also needs are injected here from the boundary [LAW:effects-at-boundaries]
 * — the clock that stamps "now" and the minter that issues the id — never reached for
 * inside. Records read back in insertion order (the monotonic `seq` rowid), the order the
 * log was written, exactly as the in-memory reference returns them.
 */
export const createSqliteAuditTrail = (db: DatabaseSync, deps: AuditTrailDeps): AuditTrail => ({
  record: (event) => {
    const recorded: RecordedEvent = { id: deps.newEntryId(), at: deps.clock.now(), event };
    // One unconditional INSERT [LAW:dataflow-not-control-flow]; the event arm rides in
    // the serialized `payload` value, never a branch on `event.kind`. A duplicate id
    // violates the UNIQUE column and throws loudly, the durable enforcement of the same
    // uniqueness the in-memory trail checks by hand [LAW:no-silent-failure].
    db.prepare('INSERT INTO moderation_events (id, at, kind, payload) VALUES (?, ?, ?, ?)').run(
      recorded.id,
      recorded.at,
      recorded.event.kind,
      JSON.stringify(recorded.event),
    );
    return Promise.resolve(recorded);
  },
  entries: () => Promise.resolve(db.prepare(SELECT).all().map(toRecordedEvent)),
});
