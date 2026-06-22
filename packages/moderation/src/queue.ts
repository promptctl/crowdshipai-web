import type { PolicyDecision, PolicySubject, PolicyViolation } from './boundary.js';
import type { EntryId } from './ids.js';
import type { Report } from './report.js';
import type { RecordedEvent } from './audit.js';

/**
 * The violations that make a policy decision a moderation INCIDENT — something a
 * reviewer should see — or `null` when it is none. Only a denial is an incident:
 * `gated` is normal access control (a viewer simply needs standing) and `allowed` is
 * a pass, neither a rule broken [seam note o97.3]. This is the ONE place "what counts
 * as an incident, and on what evidence" is decided [LAW:single-enforcer]; returning
 * the violations (not just a yes/no) is what lets the queue project the incident
 * WITHOUT re-deciding `outcome` for itself.
 *
 * The switch has no default arm: a fourth `outcome` fails to compile here until
 * someone decides whether it is an incident, rather than defaulting silently
 * [LAW:types-are-the-program].
 */
export const incidentViolations = (
  decision: PolicyDecision,
): readonly [PolicyViolation, ...PolicyViolation[]] | null => {
  switch (decision.outcome) {
    case 'denied':
      return decision.violations;
    case 'gated':
      return null;
    case 'allowed':
      return null;
  }
};

/** Whether a decision is an incident at all — the yes/no view of
 *  {@link incidentViolations}, for the edge that only needs to know whether to record
 *  rather than what to show. One classifier, two readings [LAW:one-source-of-truth]. */
export const isIncident = (decision: PolicyDecision): boolean => incidentViolations(decision) !== null;

/**
 * One thing awaiting a reviewer, tagged by where it came from — a human `report` or
 * an automated `incident`. The two paths the founding document names ("the human and
 * automated path") meet here as arms of one type, reviewed through one queue rather
 * than two [LAW:one-type-per-behavior]. Each carries the {@link EntryId} of its trail
 * entry, so a resolution names exactly what it closes.
 */
export type QueueItem =
  | { readonly kind: 'report'; readonly id: EntryId; readonly report: Report }
  | {
      readonly kind: 'incident';
      readonly id: EntryId;
      readonly subject: PolicySubject;
      readonly violations: readonly [PolicyViolation, ...PolicyViolation[]];
    };

/**
 * What ONE trail entry contributes to the review queue: a queue item, or `null` when
 * the entry is not itself reviewable (a resolution, or a decision that is no
 * incident). An exhaustive `switch` on `kind` with NO default arm — so a new
 * {@link ModerationEvent} arm fails to compile here until someone decides what it
 * shows in the queue, which is what makes the projection genuinely open to the
 * growing union rather than silently dropping a kind it has not met
 * [LAW:dataflow-not-control-flow] [LAW:types-are-the-program].
 */
const queueItemFor = (entry: RecordedEvent): QueueItem | null => {
  const event = entry.event;
  switch (event.kind) {
    case 'report-filed':
      return { kind: 'report', id: entry.id, report: event.report };
    case 'policy-decided': {
      const violations = incidentViolations(event.decision);
      return violations === null
        ? null
        : { kind: 'incident', id: entry.id, subject: event.subject, violations };
    }
    case 'action-taken':
      // A resolution is the thing that CLOSES queue items, never one itself.
      return null;
  }
};

/**
 * The review queue, derived purely from the trail [LAW:one-source-of-truth]: every
 * reportable item — a filed report, or a recorded denial — that no `action-taken`
 * has yet resolved. It is a PROJECTION, not a store: there is nothing to keep in sync
 * with the trail because it IS the trail, read through a filter
 * [LAW:effects-at-boundaries]. Recompute it whenever the queue is needed; the cost is
 * the in-memory fake's to bear and a real store's to index.
 *
 * Resolution is by id and ORDER-FREE: an `action-taken`'s `resolves` removes the
 * matching item whatever its kind and wherever it sits in the log, so the verdict
 * does not depend on record order [LAW:no-ambient-temporal-coupling]. A `resolves`
 * that matches no open item is tolerated as a no-op — the projection is total, never
 * the place that validates the trail. Whether a dangling resolve is itself a fault is
 * the RECORDING edge's call (the single enforcer of trail integrity), not the queue's;
 * the queue only ever reports what is genuinely open.
 */
export const reviewQueue = (entries: readonly RecordedEvent[]): readonly QueueItem[] => {
  const resolved = new Set<EntryId>(
    entries.flatMap((entry) => (entry.event.kind === 'action-taken' ? [entry.event.resolves] : [])),
  );

  return entries
    .filter((entry) => !resolved.has(entry.id))
    .map(queueItemFor)
    .filter((item): item is QueueItem => item !== null);
};
