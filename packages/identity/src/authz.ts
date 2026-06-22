import type { Account } from './account.js';
import type { Channel } from './channel.js';
import type { AccountId } from './ids.js';
import type { Role, RoleSet } from './roles.js';

/**
 * Authorization — the *second* question the single auth gate asks, once
 * authentication has answered the first ("who is this request?"). These are PURE
 * decisions over an already-resolved {@link Principal} and the resource it acts
 * on: no IO, no session lookup, no framework [LAW:effects-at-boundaries]. The gate
 * resolves the request to a principal ONCE at the boundary; every "may they?"
 * below is then a total function of that principal and the thing being touched, so
 * the decision is reproducible from a plain value in a test and cannot drift
 * across callsites [LAW:single-enforcer]. The channel service and `grantRole`
 * deliberately omit these checks precisely so they live here, in one place.
 */

/**
 * The subject of an authorization decision: who the principal is, and what they
 * may do. It is the identity-and-capabilities slice of an account, NOT the
 * session that proved it — authorization cares about WHO and WHAT-THEY-CAN-DO,
 * never about the lifecycle record [LAW:decomposition]. A full {@link Account} is
 * structurally a `Principal` (it has `id` and `roles`), so server code already
 * holding one — say, the account a claim just returned — passes it straight in.
 */
export interface Principal {
  readonly id: AccountId;
  readonly roles: RoleSet;
}

/**
 * May this principal administer a channel — rename it, edit its profile? By
 * OWNERSHIP: the channel is the principal's own public identity. Holding the
 * `builder` capability lets you claim *a* channel; it is ownership, never a role
 * name, that lets you manage *this* one — so the check is identity equality, not
 * `hasRole` [LAW:types-are-the-program]. This is the same rule claim/rename/
 * editProfile rely on; the channel service omits it so it cannot drift from here
 * [LAW:single-enforcer].
 */
export const mayManageChannel = (principal: Principal, channel: Channel): boolean =>
  channel.ownerId === principal.id;

/**
 * Whether a principal carries platform-operator authority — the right to act AS
 * the platform (verify a channel, administer another account), as distinct from
 * the marketplace-participant capabilities in {@link Principal.roles}.
 *
 * Platform authority is deliberately NOT a {@link Role}.
 * Folding `staff` into the participant role set would make it constructible from a
 * durable row or API field by the `role` trust boundary, and grantable through the
 * very self-service paths that hand out `builder`/`recruiter` (claiming a channel,
 * declaring recruiter intent) — turning every role grant into a privilege-
 * escalation footgun [LAW:decomposition]. Keeping staff a separate axis makes that
 * escalation unrepresentable, the same way bb2.4 kept verification out of the
 * builder-owned profile.
 *
 * No mechanism designates staff yet — there is no admin surface and no staff
 * registry — so the honest current theorem is "platform authority is a question
 * nothing yet answers yes": this is TRUE for no one. It denies by default rather
 * than guessing [LAW:no-silent-failure], and it is the SINGLE seam the staff-
 * authority mechanism plugs into later (one edit, every staff-gated decision below
 * updated at once). Until then, staff-gated actions are gate-unreachable by design.
 */
export const isPlatformStaff = (_principal: Principal): boolean => false;

/**
 * May this principal set a channel's verification status? A PLATFORM action —
 * {@link isPlatformStaff} authority only, NEVER ownership. An owner affirming
 * their own channel `official` is exactly the impersonation bb2.4 built the
 * verification field to block; authorizing it by ownership would re-open that hole
 * [LAW:decomposition]. So this asks only about platform authority and nothing
 * about who owns the channel — which is why it takes no {@link Channel} at all.
 */
export const maySetVerification = (principal: Principal): boolean => isPlatformStaff(principal);
