import type { Clock, Timestamp } from '@crowdship/std';

import type { PolicyDecision, PolicySubject } from './boundary.js';
import type { EntryId } from './ids.js';
import type { Report } from './report.js';
import type { Resolution } from './review.js';

/**
 * Everything the moderation pipeline records — a DISCRIMINATED UNION that GROWS, the
 * same shape `PolicySubject` takes. The trail appends and reads these and never
 * branches on `kind` itself [LAW:dataflow-not-control-flow], so a new event kind is a
 * new value the trail already stores, not a new code path through it. The three arms
 * seed the founding document's "report, review, action": the automated path
 * (`policy-decided`), the human report (`report-filed`), and the reviewer's
 * resolution (`action-taken`).
 *
 * `action-taken` carries `resolves`, the {@link EntryId} of the item it closes — the
 * one link that correlates a verdict back to the report or incident it answers, so
 * the human and automated paths fold into one reviewable history.
 */
export type ModerationEvent =
  | { readonly kind: 'policy-decided'; readonly subject: PolicySubject; readonly decision: PolicyDecision }
  | { readonly kind: 'report-filed'; readonly report: Report }
  | { readonly kind: 'action-taken'; readonly resolves: EntryId; readonly resolution: Resolution };

/**
 * A {@link ModerationEvent} as it lives in the trail: stamped with the id the trail
 * assigned and the instant it was recorded. The trail owns both stamps — the caller
 * supplies only the event, never its identity or its time, because uniqueness and
 * "now" are the store's to guarantee at its boundary [LAW:effects-at-boundaries].
 */
export interface RecordedEvent {
  readonly id: EntryId;
  readonly at: Timestamp;
  readonly event: ModerationEvent;
}

/**
 * THE moderation audit trail [LAW:single-enforcer]: the append-only system of record
 * for everything the pipeline does. It is the one source of truth for moderation
 * history [LAW:one-source-of-truth] — the review queue and every other view are PURE
 * projections of `entries()` (see `./queue.ts`), never a second store that could
 * drift from it.
 *
 * Both methods are async: a real trail persists to durable storage at this seam, so
 * the port is shaped for it even though the in-memory fake resolves at once — the
 * same convention `IngestBroker` and `PaymentGateway` follow. Recording is the only
 * write; there is no update or delete, because an audit trail you can rewrite is not
 * one [LAW:no-silent-failure].
 */
export interface AuditTrail {
  /** Append one event; the trail assigns its id and timestamp and hands back the
   *  recorded entry so the caller learns the id it can later resolve against. */
  record(event: ModerationEvent): Promise<RecordedEvent>;
  /** The whole history in record order — the substrate every projection reads. */
  entries(): Promise<readonly RecordedEvent[]>;
}

/**
 * The effects the in-memory trail needs handed in from its boundary, never reached
 * for ambiently [LAW:effects-at-boundaries] — the clock that stamps each entry and
 * the minter that issues ids. Splitting `newEntryId` out as an injected capability
 * (rather than the fake inventing ids) keeps the core free of randomness and lets a
 * test supply a deterministic, readable sequence, exactly as `IngestBrokerDeps`
 * injects `newStreamId`.
 */
export interface AuditTrailDeps {
  readonly clock: Clock;
  newEntryId(): EntryId;
}

/**
 * The in-memory audit trail: correct for a single process and for tests, the
 * dev/test stand-in behind the {@link AuditTrail} seam that a durable store replaces
 * with no caller change [LAW:locality-or-seam]. The entry list IS the trail — append
 * only, never mutated in place — so reading it back is reading the truth.
 */
export const createInMemoryAuditTrail = (deps: AuditTrailDeps): AuditTrail => {
  const log: RecordedEvent[] = [];

  return {
    record: (event) => {
      const id = deps.newEntryId();
      // The trail OWNS id uniqueness [LAW:single-enforcer], so it ENFORCES it rather
      // than merely trusting the minter: a repeated id would let one resolution close
      // two entries and collapse two incidents into one, so a colliding minter fails
      // loudly here instead of corrupting the record silently [LAW:no-silent-failure].
      if (log.some((e) => e.id === id)) {
        throw new Error(`audit trail: minter returned a duplicate entry id ${JSON.stringify(id)}`);
      }
      const recorded: RecordedEvent = { id, at: deps.clock.now(), event };
      log.push(recorded);
      return Promise.resolve(recorded);
    },
    entries: () => Promise.resolve([...log]),
  };
};
