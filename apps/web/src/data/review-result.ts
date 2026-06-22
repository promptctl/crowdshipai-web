import type { ReviewDisposition } from '@crowdship/moderation';

/**
 * One open review-queue item, flattened to serializable primitives for the client
 * console — the read twin of `admin-result.ts`'s write outcomes. The server reads the
 * audit trail, projects the queue, and maps each {@link QueueItem} to this shape at its
 * edge, so no moderation domain handle (a branded `EntryId`, a `PolicySubject`) crosses
 * the network boundary [LAW:effects-at-boundaries]. The two arms mirror the queue's own
 * `report | incident` split: a human flag, or an automated policy denial.
 *
 * `id` is the trail entry id this item resolves against — carried verbatim so the resolve
 * form names exactly what it closes, and parsed back at the resolve edge, never trusted
 * as already-valid [LAW:no-silent-failure].
 */
export type QueueItemView =
  | {
      readonly kind: 'report';
      readonly id: string;
      readonly target: string;
      readonly reason: string;
      readonly reporter: string;
    }
  | {
      readonly kind: 'incident';
      readonly id: string;
      readonly subject: string;
      readonly violations: readonly string[];
    };

/**
 * What a reviewer learns after resolving an item — the review twin of `SanctionResult`.
 * Every arm is a DISTINCT outcome: the two authorization refusals
 * (`must-authenticate`, `forbidden`) are never folded into the input-shape refusals,
 * because conflating "you may not review" with "that note was blank" tells the reviewer
 * the wrong thing to fix [LAW:no-silent-failure]. `forbidden` carries no detail — a
 * non-staff caller learns only that review is not theirs.
 */
export type ResolveResult =
  /** The verdict was recorded; the item leaves the queue. */
  | { readonly kind: 'resolved'; readonly disposition: ReviewDisposition }
  /** The entry id was blank — no item named to resolve. */
  | { readonly kind: 'invalid-item' }
  /** The disposition was not one of the closed review verdicts. */
  | { readonly kind: 'invalid-disposition' }
  /** The note was blank — a verdict the audit trail cannot explain is a silent one. */
  | { readonly kind: 'invalid-note' }
  /** A live session without platform authority — the staff gate refused. */
  | { readonly kind: 'forbidden' }
  /** No live session — the request carried no principal to authorize. */
  | { readonly kind: 'must-authenticate' };
