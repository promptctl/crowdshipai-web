import type { Timestamp } from '@crowdship/std';

/**
 * How long a {@link Sanction} bars an actor — the one structural axis that
 * distinguishes a ban from a suspension. Rather than a `'ban' | 'suspend' | …` label
 * soup we would forever extend [LAW:no-mode-explosion], a sanction is expressed by its
 * EFFECT: barred forever, or barred until an instant. "Ban" and "suspend" are then
 * just which scope was chosen — the platform never enumerates a closed taxonomy of
 * enforcement names, while the temporal shape stays a closed two-arm union the edge
 * can collapse exhaustively [LAW:types-are-the-program].
 */
export type SanctionScope =
  | { readonly kind: 'permanent' }
  | { readonly kind: 'until'; readonly until: Timestamp };

/**
 * One enforcement action against an account — a ban or a suspension — recorded
 * against IDENTITY so it survives channel and session churn (a banned actor cannot
 * shed the ban by abandoning a channel or signing in afresh): the account is the
 * durable thing a sanction attaches to [LAW:one-source-of-truth]. `reason` is the
 * human-facing why, kept as prose because an enforcement the actor and the audit trail
 * cannot understand is a silent one [LAW:no-silent-failure]; `issuedAt` is when it was
 * imposed, so the record is attributable in time. WHO may impose one (platform staff)
 * is the auth gate's call at the edge, not this record's — the sanction is the fact,
 * not the authority to create it.
 */
export interface Sanction {
  readonly reason: string;
  readonly issuedAt: Timestamp;
  readonly scope: SanctionScope;
}

/** Is this sanction in force as of `now`? A permanent one always is; a timed one until
 *  its instant passes. The clock is read at the edge and handed in, so this stays a pure
 *  comparison over a value [LAW:no-ambient-temporal-coupling] [LAW:effects-at-boundaries]. */
const isActive = (sanction: Sanction, now: Timestamp): boolean =>
  sanction.scope.kind === 'permanent' || now < sanction.scope.until;

/** Is `a` at least as restrictive as `b`? Permanent outranks any timed bar; between two
 *  timed bars the one reaching further into the future restricts longer. The single place
 *  sanction severity is ordered [LAW:single-enforcer], so the governing sanction is chosen
 *  the same way everywhere. */
const atLeastAsRestrictive = (a: Sanction, b: Sanction): boolean => {
  if (a.scope.kind === 'permanent') return true;
  if (b.scope.kind === 'permanent') return false;
  return a.scope.until >= b.scope.until;
};

/**
 * The single sanction that GOVERNS an account as of `now` — the most restrictive of its
 * active sanctions — or `null` when none is active. This is the derived view the conduct
 * edge needs: the account's sanction list is the source of truth, the governing bar is
 * computed from it on demand, never stored as a second copy that could drift
 * [LAW:one-source-of-truth]. `null` is a genuine "no active bar", an exhaustively-handled
 * optional the edge maps to good standing, not a missing field [LAW:no-defensive-null-guards].
 */
export const effectiveSanction = (
  sanctions: readonly Sanction[],
  now: Timestamp,
): Sanction | null =>
  sanctions
    .filter((sanction) => isActive(sanction, now))
    .reduce<Sanction | null>(
      (governing, sanction) =>
        governing === null || atLeastAsRestrictive(sanction, governing) ? sanction : governing,
      null,
    );
