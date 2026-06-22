import type { ActorRef } from './ids.js';

/** The dispositions in one array — written once as the single source for BOTH the
 *  type below and any runtime iteration or validation [LAW:one-source-of-truth], so a
 *  hand-listed union and a hand-listed array can never drift apart. */
export const REVIEW_DISPOSITIONS = ['upheld', 'dismissed'] as const;

/**
 * A reviewer's verdict on something awaiting review — the CLOSED platform vocabulary
 * for how a review ends, the moderation twin of `PolicyDecision.outcome`. Two states,
 * and only two: the grounds were valid (`upheld`) or they were not (`dismissed`).
 * Three-plus states cannot ride a boolean without lying, and a free string would let
 * "maybe" and typos in [LAW:types-are-the-program]; the platform owns this enum, so
 * it is closed — and the type is DERIVED from {@link REVIEW_DISPOSITIONS} so the set
 * is stated exactly once.
 *
 * What an `upheld` verdict then DOES — remove the content, suspend or ban the actor —
 * is conduct ENFORCEMENT, an OPEN vocabulary tied to identity that o97.5 hangs off
 * this verdict. This ticket owns the verdict; o97.5 owns its teeth. Keeping the two
 * apart is why a dismissal needs no enforcement field [LAW:decomposition].
 */
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

/**
 * The outcome a reviewer records against an open item — who reviewed, what they
 * concluded, and why. `note` is free text (the reviewer's reasoning), kept as prose
 * because a verdict the audit trail cannot explain is a silent one [LAW:no-silent-failure].
 * Attribution is structural: `reviewer` is on the record, so the trail always says
 * WHO acted, never an anonymous edit.
 */
export interface Resolution {
  readonly reviewer: ActorRef;
  readonly disposition: ReviewDisposition;
  readonly note: string;
}
