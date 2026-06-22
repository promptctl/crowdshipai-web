import type { AccountId } from './ids.js';

/**
 * The set of accounts that hold platform-operator authority — the durable
 * designation behind {@link isPlatformStaff}. It answers exactly one question,
 * "does this account act AS the platform?", and nothing else [LAW:decomposition].
 *
 * Staff is a SEPARATE axis from the participant capabilities in a `RoleSet`, and
 * this type is what keeps it separate. Folding `staff` into {@link Role} would make
 * it constructible at the `role` trust boundary (from a durable row or API field)
 * and grantable through the self-service paths that hand out `builder`/`recruiter`
 * — turning every role grant into a privilege-escalation footgun [LAW:decomposition].
 * A roster is never granted through those paths: it is an explicitly-owned
 * allowlist, resolved from a durable, auditable source (configuration, not a
 * self-service table) at the one composition point and handed to the gate as a
 * value. So platform authority can only ever be conferred by editing the roster's
 * source, never by anything a user can reach.
 *
 * It is a pure value — a membership predicate over a closed set, no IO — so the
 * authorization gate that reads it stays a total function of its inputs and the
 * effect of LOADING the roster lives at the boundary, never inside the decision
 * [LAW:effects-at-boundaries]. The representation (a set today, an indexed store
 * behind the same `includes` tomorrow) is hidden so a reader depends only on the
 * question, not the storage [LAW:locality-or-seam].
 */
export interface StaffRoster {
  /** Whether `account` holds platform-operator authority. */
  includes(account: AccountId): boolean;
}

/**
 * Build a {@link StaffRoster} from the accounts designated as staff. The inputs are
 * already-branded {@link AccountId}s — parsing raw configuration strings into ids is
 * the composition root's job at the trust boundary, so by the time a roster is built
 * the boundary has been crossed [LAW:single-enforcer]. Deduplication is the set's;
 * order is irrelevant to a membership test.
 */
export const staffRoster = (accounts: readonly AccountId[]): StaffRoster => {
  const designated = new Set<AccountId>(accounts);
  return { includes: (account) => designated.has(account) };
};

/**
 * The roster that designates no one — the honest default when no staff source is
 * configured. With it, every staff-gated decision denies by default rather than
 * guessing [LAW:no-silent-failure]: platform authority is a question this answers
 * yes for no account, exactly the floor the deny-all seam held before a mechanism
 * existed. A misconfigured deployment thus fails CLOSED (no one is staff), never
 * open.
 */
export const EMPTY_ROSTER: StaffRoster = { includes: () => false };
