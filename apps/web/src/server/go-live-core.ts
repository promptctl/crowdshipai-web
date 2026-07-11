import type { Principal } from '@crowdship/identity';
import type { PolicyDecision } from '@crowdship/moderation';

import type { GoLiveResult, PublishHandoff } from '../data/go-live-result';

/**
 * Going live, as PURE orchestration over already-resolved values — the publish twin of
 * `chat-core.ts`. It takes the acting principal, a way to read the builder's OWN channel
 * slug, and the open-publish capability as plain inputs, so the whole decision is
 * reproducible in a test without a session, a cookie, or a live SFU
 * [LAW:effects-at-boundaries]. The `'use server'` edge (`stream-actions.ts`) resolves
 * those from the request and the composition roots and hands them here.
 *
 * Authentication is checked FIRST: you cannot stream as no one. Then the proven actor's
 * CONDUCT is screened through the one policy boundary — a barred actor may do nothing,
 * so the bar is stated before any channel is even read, and the screen (not this core)
 * owns recording the incident to the trail [LAW:single-enforcer]. Then the slug comes
 * from the SERVER's own read of the principal's channel, never from the client — the
 * browser does not get to choose which room it publishes to [LAW:single-enforcer]. Only
 * once all three are settled is the provider's ingest opened. The result is a closed
 * union the control matches exhaustively, so adding an outcome is a compile error at the
 * UI, not a silent gap [LAW:dataflow-not-control-flow].
 */

export interface GoLiveDeps {
  readonly principal: Principal | null;
  /**
   * Screen this proven actor's go-live against the policy boundary and return its
   * verdict. The edge owns building the conduct subject (actor ref, standing, the
   * `go-live` action) and recording any incident; this core owns only ENFORCING the
   * outcome — refusing the open on a deny — because deciding, recording, and enforcing
   * are three concerns and the boundary seam already splits them [LAW:decomposition].
   */
  screenConduct(actor: Principal): Promise<PolicyDecision>;
  /**
   * The acting builder's OWN channel slug, or `null` if they hold no channel — the
   * narrow slice of identity this core needs to name the room to publish to
   * [LAW:locality-or-seam]. Read server-side from the principal, so the room is the
   * builder's own and cannot be spoofed by the client [LAW:single-enforcer].
   */
  ownChannelSlug(accountId: Principal['id']): Promise<string | null>;
  /** Open the ingest for a slug and surrender the publish credential. The one effect, pushed to the edge. */
  openPublish(slug: string): Promise<PublishHandoff>;
}

export const performGoLive = async (deps: GoLiveDeps): Promise<GoLiveResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  const conduct = await deps.screenConduct(deps.principal);
  // A deny always carries at least one violation with its reason — the boundary's
  // non-empty tuple makes "barred for no reason" unrepresentable, so the first
  // violation's reason is always there to surface [LAW:types-are-the-program].
  if (conduct.outcome === 'denied') return { kind: 'barred', reason: conduct.violations[0].reason };

  const slug = await deps.ownChannelSlug(deps.principal.id);
  if (slug === null) return { kind: 'no-channel' };

  return deps.openPublish(slug);
};
