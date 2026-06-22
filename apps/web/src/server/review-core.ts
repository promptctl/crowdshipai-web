import { maySanction, type Principal, type StaffRoster } from '@crowdship/identity';
import {
  entryId,
  REVIEW_DISPOSITIONS,
  type AuditTrail,
  type QueueItem,
  type Resolution,
} from '@crowdship/moderation';

import { actorRefFor } from './actor-ref';
import type { QueueItemView, ResolveResult } from '../data/review-result';

/**
 * The review-queue read and resolve, as PURE orchestration over already-resolved values
 * — the review twin of `admin-core.ts`. Projecting a {@link QueueItem} to its
 * serializable view and recording a reviewer's verdict are both reproducible in a test
 * without a session or a framework [LAW:effects-at-boundaries]; the edges
 * (`admin/page.tsx` for the read, `review-actions.ts` for the resolve) resolve the trail
 * and the request subject and hand them here.
 */

/**
 * Flatten one {@link QueueItem} to the serializable shape the client console renders.
 * An exhaustive switch on `kind` with NO default arm, so a new queue arm fails to compile
 * here until it is given a view rather than silently dropping out of the surface
 * [LAW:types-are-the-program]. The branded ids and the policy subject become plain
 * strings — the only place the domain handle is opened, at this one edge.
 */
export const toQueueView = (item: QueueItem): QueueItemView => {
  switch (item.kind) {
    case 'report':
      return {
        kind: 'report',
        id: item.id,
        target: item.report.target,
        reason: item.report.reason,
        reporter: item.report.reporter,
      };
    case 'incident':
      return {
        kind: 'incident',
        id: item.id,
        subject: item.subject.kind,
        violations: item.violations.map((v) => v.reason),
      };
  }
};

export interface ResolveDeps {
  readonly principal: Principal | null;
  readonly roster: StaffRoster;
  readonly audit: AuditTrail;
}

export interface ResolveInput {
  /** The trail entry id the verdict closes — carried back verbatim from the queue view. */
  readonly entry: string;
  /** The reviewer's verdict — validated against the closed disposition set. */
  readonly disposition: string;
  /** The reviewer's free-text reasoning, required so the verdict is never silent. */
  readonly note: string;
}

/**
 * Record a reviewer's verdict against an open item — a platform action gated by
 * {@link maySanction}, the same staff authority that issues sanctions, never ownership
 * [LAW:single-enforcer]. Authorization is checked FIRST, before any field is parsed, so a
 * caller without authority is refused having learned nothing about the queue.
 *
 * This records ONLY the verdict (`action-taken`), which clears the item from the queue.
 * What an `upheld` verdict then DOES — bar the reported account — is conduct enforcement,
 * the existing separate `performIssueSanction` action: the verdict and its teeth are kept
 * apart exactly as `review.ts` draws the cut [LAW:decomposition]. The note must be
 * non-blank: a verdict the audit trail cannot explain is a silent one
 * [LAW:no-silent-failure].
 */
export const performResolveItem = async (deps: ResolveDeps, input: ResolveInput): Promise<ResolveResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };
  if (!maySanction(deps.principal, deps.roster)) return { kind: 'forbidden' };

  const entry = entryId(input.entry.trim());
  if (!entry.ok) return { kind: 'invalid-item' };
  // The disposition rides back as a value matched against the one closed set, never
  // branched on as a free string [LAW:dataflow-not-control-flow] — an unknown verdict
  // is refused, not coerced.
  const disposition = REVIEW_DISPOSITIONS.find((d) => d === input.disposition);
  if (disposition === undefined) return { kind: 'invalid-disposition' };
  const note = input.note.trim();
  if (note.length === 0) return { kind: 'invalid-note' };

  const resolution: Resolution = { reviewer: actorRefFor(deps.principal), disposition, note };
  await deps.audit.record({ kind: 'action-taken', resolves: entry.value, resolution });
  return { kind: 'resolved', disposition };
};
