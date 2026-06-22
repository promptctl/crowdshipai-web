import type { Account } from './account.js';
import type { Channel } from './channel.js';
import type { AccountId } from './ids.js';
import type { Role, RoleSet } from './roles.js';
import type { StaffRoster } from './staff.js';

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
 * the platform (verify a channel, sanction an account), as distinct from the
 * marketplace-participant capabilities in {@link Principal.roles}.
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
 * Authority is the question, the {@link StaffRoster} is the answer: a principal is
 * staff exactly when the roster designates their account. The roster is resolved
 * from its durable, auditable source at the composition boundary and handed in as a
 * value, so this stays a pure decision [LAW:effects-at-boundaries] and the SINGLE
 * seam every staff-gated check below reads — designate an account once, in the
 * roster's source, and every decision here answers yes for it at once
 * [LAW:single-enforcer]. An absent or empty roster denies everyone, so a
 * misconfigured deployment fails closed rather than guessing [LAW:no-silent-failure].
 */
export const isPlatformStaff = (principal: Principal, roster: StaffRoster): boolean =>
  roster.includes(principal.id);

/**
 * May this principal set a channel's verification status? A PLATFORM action —
 * {@link isPlatformStaff} authority only, NEVER ownership. An owner affirming
 * their own channel `official` is exactly the impersonation bb2.4 built the
 * verification field to block; authorizing it by ownership would re-open that hole
 * [LAW:decomposition]. So this asks only about platform authority and nothing
 * about who owns the channel — which is why it takes no {@link Channel} at all.
 */
export const maySetVerification = (principal: Principal, roster: StaffRoster): boolean =>
  isPlatformStaff(principal, roster);

/**
 * May this principal impose or lift a `Sanction` against an account — a ban or
 * suspension? PLATFORM authority only, NEVER ownership: a builder must not be
 * able to unban themselves, so this asks solely whether the principal acts AS the
 * platform and takes no account-being-sanctioned at all [LAW:decomposition]. The
 * teeth (recording the sanction) live in the conduct path; this is the one gate on
 * WHO may pull them, reading the same roster as every other staff decision so
 * authority cannot drift between verifying a channel and sanctioning an account
 * [LAW:single-enforcer].
 */
export const maySanction = (principal: Principal, roster: StaffRoster): boolean =>
  isPlatformStaff(principal, roster);
