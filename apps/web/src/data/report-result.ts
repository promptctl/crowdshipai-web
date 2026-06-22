/**
 * What a viewer learns after filing a moderation report — the report twin of
 * `admin-result.ts`. A server action returns these across the network boundary, so each
 * arm carries only serializable primitives, never a domain handle. Every arm is a
 * DISTINCT outcome the surface renders differently: the authentication refusal is never
 * folded into the input-shape refusals, because telling a viewer "sign in" when their
 * report was actually blank would point them at the wrong fix [LAW:no-silent-failure].
 *
 * A report is gated only by authentication, never by authority: anyone signed in may
 * flag a thing for review. Identity is required so the report is ATTRIBUTABLE — an
 * anonymous flag is an abuse vector the trail could not later weigh, so a logged-out
 * request is refused rather than recorded against no one.
 */
export type ReportResult =
  /** The report was recorded to the audit trail and now awaits review. */
  | { readonly kind: 'filed' }
  /** The reported target was blank — nothing identifiable to review. */
  | { readonly kind: 'invalid-target' }
  /** The reason was blank — a report a reviewer cannot understand the grounds of. */
  | { readonly kind: 'invalid-reason' }
  /** No live session — a report must name who filed it, so an anonymous one is refused. */
  | { readonly kind: 'must-authenticate' };
