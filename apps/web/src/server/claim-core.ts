import type {
  AccountId,
  ChannelClaim,
  ChannelProfile,
  ClaimError,
  Handle,
  Principal,
} from '@crowdship/identity';
import { EMPTY_BIO, displayName, handle } from '@crowdship/identity';
import type { Result } from '@crowdship/std';

import type { ClaimResult } from '../data/claim-result';

/**
 * Claiming a builder channel, as PURE orchestration over already-resolved values — the
 * identity twin of `go-live-core.ts`. It takes the acting principal, the raw form input,
 * and the claim capability as plain inputs, so the whole decision is reproducible in a
 * test without a session, a cookie, or a database [LAW:effects-at-boundaries]. The
 * `'use server'` edge (`channel-actions.ts`) resolves those from the request and the
 * composition roots and hands them here.
 *
 * Authentication is checked FIRST: you cannot claim a channel as no one. The owner the
 * channel is bound to is the principal's OWN id, read here from the authenticated
 * subject — never a value the form supplies — so the browser cannot claim on behalf of
 * another account [LAW:single-enforcer]. {@link ClaimInput} has no owner field at all,
 * so that spoof is not refused but UNREPRESENTABLE [LAW:types-are-the-program]. The raw
 * handle and display name ARE untrusted, so they cross their constructors (the trust
 * boundary) before any store is touched; a malformed value is reported with its specific
 * reason and no claim is attempted. The result is a closed union the form matches
 * exhaustively [LAW:dataflow-not-control-flow].
 */

export interface ClaimDeps {
  readonly principal: Principal | null;
  /**
   * Bind a handle to an owner and grant the builder capability — the one effect, pushed
   * to the edge. Structurally the channel service's `claimChannel`; injected so the core
   * runs against a real service in a test without resolving it from a singleton.
   */
  claim(
    ownerId: AccountId,
    handle: Handle,
    profile: ChannelProfile,
  ): Promise<Result<ChannelClaim, ClaimError>>;
}

/** The raw form values — handle and display name only. There is deliberately NO owner
 *  field: who the channel belongs to is the authenticated principal, never the client. */
export interface ClaimInput {
  readonly handle: string;
  readonly displayName: string;
}

export const performClaim = async (deps: ClaimDeps, input: ClaimInput): Promise<ClaimResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  const parsedHandle = handle(input.handle);
  if (!parsedHandle.ok) return { kind: 'invalid-handle', error: parsedHandle.error };

  const parsedName = displayName(input.displayName);
  if (!parsedName.ok) return { kind: 'invalid-display-name', error: parsedName.error };

  // A fresh channel carries an empty bio — the explicit empty value, not an absent field
  // [LAW:dataflow-not-control-flow]. The builder fills it in later through profile edit.
  const profile: ChannelProfile = { displayName: parsedName.value, bio: EMPTY_BIO };

  const claimed = await deps.claim(deps.principal.id, parsedHandle.value, profile);
  // The service's failure arms ARE the result's failure arms — forwarded, never collapsed
  // into one "couldn't claim" [LAW:no-silent-failure].
  if (!claimed.ok) return claimed.error;
  return { kind: 'claimed', handle: claimed.value.channel.handle };
};
