import type { AccountId, Channel, ChannelId, Principal } from '@crowdship/identity';

import type { OverlayAuthorResult } from '../data/overlay-result';
import { overlayStyleFrom, overlayStyleProblems, type OverlayStyle } from '../data/overlay-style';

/**
 * Restyling a builder's overlay, as PURE orchestration over already-resolved values —
 * the overlay twin of `menu-author-core.ts`. It takes the acting principal, the raw
 * form fields, and the channel-lookup / save / announce capabilities as plain inputs,
 * so the whole decision is reproducible in a test without a session, a cookie, or a
 * database [LAW:effects-at-boundaries]. The `'use server'` edge resolves those from
 * the request and the composition roots and hands them here.
 *
 * Authentication is checked FIRST: you cannot restyle an overlay as no one. The
 * channel the style binds to is read from the authenticated principal's OWN account —
 * never a value the form supplies — so the browser cannot restyle another builder's
 * stream. {@link RawOverlayStyle} has no channel/owner field at all, so that spoof is
 * UNREPRESENTABLE [LAW:types-are-the-program].
 *
 * The announce runs AFTER the save, through the injected capability: what watchers
 * are nudged with is exactly what the store now holds, and an invalid submission
 * announces nothing. Sequencing lives here, in the one owner of the operation,
 * never in the caller's folklore [LAW:no-ambient-temporal-coupling].
 */

/** The style exactly as the builder's form submitted it — every field still a raw
 *  string that has NOT crossed the trust boundary. Deliberately NO channel/owner
 *  field: whose overlay this is comes from the session, never the client. */
export interface RawOverlayStyle {
  readonly placement: string;
  readonly accentHue: string;
  readonly durationSeconds: string;
}

export interface AuthorOverlayDeps {
  readonly principal: Principal | null;
  /** The authenticated account's channel, if they have claimed one — `channelByOwner`. */
  channelOf(ownerId: AccountId): Promise<Channel | undefined>;
  /** Persist the validated style against the builder's channel — one effect, at the edge. */
  saveStyle(channelId: ChannelId, style: OverlayStyle): Promise<void>;
  /** Nudge every watcher of the builder's stream with the style as saved. */
  announceStyle(builderSlug: string, style: OverlayStyle): Promise<void>;
}

/**
 * A whole-number axis from its raw form string, or `NaN` — the string→number trust
 * boundary, strict like the menu's price parse: an empty or non-numeric string must
 * become a value the validator REJECTS, never `Number('')`'s silent zero that would
 * save a hue the builder did not type [LAW:no-silent-failure].
 */
const parseAxis = (raw: string): number => (/^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN);

export const performSetOverlay = async (
  deps: AuthorOverlayDeps,
  raw: RawOverlayStyle,
): Promise<OverlayAuthorResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  const channel = await deps.channelOf(deps.principal.id);
  if (channel === undefined) return { kind: 'no-channel' };

  // Cross the trust boundary through the ONE style validator — the same line the wire
  // parse and the durable decode draw [LAW:single-enforcer]. Every failing field is
  // reported at once, and nothing is stored or announced on any failure.
  const candidate = {
    placement: raw.placement,
    accentHue: parseAxis(raw.accentHue),
    durationSeconds: parseAxis(raw.durationSeconds),
  };
  const style = overlayStyleFrom(candidate);
  if (style === null) return { kind: 'invalid', problems: overlayStyleProblems(candidate) };

  await deps.saveStyle(channel.id, style);
  await deps.announceStyle(channel.handle, style);
  return { kind: 'saved', style };
};
