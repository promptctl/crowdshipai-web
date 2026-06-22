import type { Brand, Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

/**
 * The three ways one person participates in CrowdShip. They are *values of one
 * type*, not three types: at the identity layer a role is identical behavior —
 * a capability token an account either holds or does not — so minting
 * BuilderUser / BackerUser / RecruiterUser would be the same behavior wearing
 * three names [LAW:one-type-per-behavior]. The behavior that actually differs
 * per role lives in other domains (the builder's menu, the backer's pledges,
 * the recruiter's lens) and is gated by asking whether the account holds the
 * capability — never by which subtype it is.
 *
 * A closed union, not `string`: an unknown role is unrepresentable, so no
 * downstream switch needs a "default" arm and the constructor below is the one
 * place external input is admitted [LAW:types-are-the-program].
 */
export type Role = 'builder' | 'backer' | 'recruiter';

/**
 * Every role, in canonical order — the single source of truth for "what roles
 * exist" [LAW:one-source-of-truth]. The order defines the canonical ordering of
 * a {@link RoleSet}, so two sets with the same members are byte-identical when
 * serialized and deep-equal in a test. Adding a role here is the one edit that
 * introduces a new capability; exhaustive `Role` switches elsewhere then fail to
 * compile until they account for it, which is the intended signal.
 */
export const ROLES: readonly Role[] = ['backer', 'builder', 'recruiter'];

export type RoleError = { readonly kind: 'unknown-role'; readonly value: string };

/**
 * The trust boundary for a role arriving as a raw string (a durable row, an API
 * field). It admits only a member of {@link ROLES}; anything else is a named
 * failure the caller must handle, never a silently dropped or coerced value
 * [LAW:no-silent-failure].
 */
export const role = (raw: string): Result<Role, RoleError> =>
  (ROLES as readonly string[]).includes(raw)
    ? ok(raw as Role)
    : err({ kind: 'unknown-role', value: raw });

/**
 * An account's capabilities: the set of roles it holds. Branded so the only way
 * to obtain one is through {@link roleSet}, which makes the representation
 * canonical — deduplicated and ordered by {@link ROLES} [LAW:one-source-of-truth].
 * A bare `Role[]` (which could carry duplicates or arbitrary order) is therefore
 * not a `RoleSet`, so "the same capabilities" is exactly one value, comparable by
 * deep equality and serializable to one canonical string [LAW:types-are-the-program].
 */
export type RoleSet = Brand<readonly Role[], 'RoleSet'>;

/**
 * Canonicalize any collection of roles into a {@link RoleSet}: each role at most
 * once, ordered by {@link ROLES}. Total — every input of valid `Role` values is
 * a valid set of capabilities — so it returns a `RoleSet` directly, not a
 * `Result`. Building from `ROLES` rather than sorting the input is what makes the
 * order canonical regardless of the order roles were granted in.
 */
export const roleSet = (roles: Iterable<Role>): RoleSet => {
  const held = new Set<Role>(roles);
  // The one place a `RoleSet` is minted. The brand is phantom (no runtime value
  // can carry it), so branding the canonical array is an unavoidable assertion —
  // confined to this single checked constructor, which is exactly what makes a
  // bare `Role[]` unable to masquerade as a canonical set everywhere else.
  return ROLES.filter((r) => held.has(r)) as unknown as RoleSet;
};

/** An account with no capabilities — the empty {@link RoleSet}. */
export const NO_ROLES: RoleSet = roleSet([]);

/**
 * The capabilities a brand-new account starts with [LAW:one-source-of-truth for
 * the signup policy]. Everyone who signs up can *back* — backing is just
 * spending coins to support a stream, the universal participation — so a fresh
 * account is a backer. Building and recruiting are opted into later by granting
 * the capability (a builder claims a channel, a recruiter declares intent), not
 * chosen at signup. Changing the starting capabilities is this one edit.
 */
export const DEFAULT_ROLES: RoleSet = roleSet(['backer']);

/** Whether a set of capabilities includes a given role. */
export const hasRole = (set: RoleSet, r: Role): boolean => set.includes(r);

/**
 * The capabilities `set` plus `r`. Pure and idempotent: granting a role already
 * held returns an equal canonical set, so callers need not check membership
 * first [LAW:dataflow-not-control-flow].
 */
export const withRole = (set: RoleSet, r: Role): RoleSet => roleSet([...set, r]);

/**
 * The capabilities `set` minus `r`. Pure and idempotent: revoking a role not
 * held returns an equal canonical set.
 */
export const withoutRole = (set: RoleSet, r: Role): RoleSet =>
  roleSet(set.filter((held) => held !== r));
