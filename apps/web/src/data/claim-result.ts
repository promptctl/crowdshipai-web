import type { ClaimError, DisplayNameError, HandleError } from '@crowdship/identity';

/**
 * The closed outcome of a channel-claim attempt, as the value the claim form matches
 * exhaustively [LAW:dataflow-not-control-flow]. The domain's own {@link ClaimError} arms
 * (handle reserved/taken, already-has-channel, no-such-account) are folded in by
 * INCLUSION rather than restated, so a new failure the channel service can return becomes
 * a compile error in the form's notice mapper instead of a silently blank message
 * [LAW:one-source-of-truth][LAW:no-silent-failure].
 *
 * The two parse arms carry the constructor's named error so the builder is told the
 * SPECIFIC reason a handle or display name was rejected (too short, malformed shape, …),
 * never a blanket "invalid" — the trust boundary's precision surfaced to the UI
 * [LAW:types-are-the-program]. `claimed` is the success value the core returns; the edge
 * turns it into a redirect, so the form never renders it.
 */
export type ClaimResult =
  | { readonly kind: 'claimed'; readonly handle: string }
  | { readonly kind: 'must-authenticate' }
  | { readonly kind: 'invalid-handle'; readonly error: HandleError }
  | { readonly kind: 'invalid-display-name'; readonly error: DisplayNameError }
  | ClaimError;
