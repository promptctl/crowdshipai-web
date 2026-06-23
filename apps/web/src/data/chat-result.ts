/**
 * What a viewer learns after sending a chat line — the chat twin of
 * `report-result.ts`. A server action returns these across the network boundary, so
 * each arm carries only serializable primitives, never a domain handle. Every arm is
 * a DISTINCT outcome the surface renders differently: the authentication refusal is
 * never folded into the input-shape refusals, because telling a viewer "sign in"
 * when their message was actually too long would point them at the wrong fix
 * [LAW:no-silent-failure].
 *
 * Chat is gated only by authentication, never by authority: anyone signed in may
 * speak. Identity is required so a line is ATTRIBUTABLE to an account on the server
 * even though the public label is a channel name or a pseudonym — an anonymous
 * back-channel is an abuse vector, so a logged-out send is refused, not broadcast
 * against no one.
 */
export type ChatResult =
  /** The line was broadcast on the builder's live channel. */
  | { readonly kind: 'sent' }
  /** The text was blank — nothing to say, so nothing is broadcast. */
  | { readonly kind: 'empty' }
  /** The text exceeded the length bound; `max` is the limit the surface reports. */
  | { readonly kind: 'too-long'; readonly max: number }
  /** No live session — a chat line must name who sent it, so an anonymous one is refused. */
  | { readonly kind: 'must-authenticate' };
