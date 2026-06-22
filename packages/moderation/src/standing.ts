/**
 * Where an actor stands with the platform, as far as the conduct rule cares: either
 * `in-good-standing` or `barred` from acting, with the reason it is barred. It is a
 * WORLD-FACT, derived at the edge from the actor's enforcement record in identity and
 * handed in on the {@link PolicySubject}, so the conduct rule stays a pure comparison
 * over a value rather than reaching for identity (a sibling core it may not see)
 * [LAW:one-way-deps] [LAW:effects-at-boundaries].
 *
 * Two arms, not a `barred: boolean` with an optional reason: a bar that cannot say
 * why is a silent one [LAW:no-silent-failure], so `barred` ALWAYS carries a reason and
 * good standing carries nothing — "barred for no reason" is unrepresentable
 * [LAW:types-are-the-program]. The TEMPORAL detail behind a bar (a permanent ban vs a
 * suspension until some instant) is identity's enforcement record to hold and the
 * edge's to collapse against `now`; by the time a standing reaches a rule the clock has
 * already been read, so the rule never compares a deadline and never touches time
 * [LAW:no-ambient-temporal-coupling]. Good standing is the baseline — the absence of an
 * active bar, named as its own arm rather than a null [LAW:no-defensive-null-guards].
 */
export type ActorStanding =
  | { readonly kind: 'in-good-standing' }
  | { readonly kind: 'barred'; readonly reason: string };

/** The baseline standing: no active bar. The value the edge hands in for any actor
 *  whose enforcement record holds nothing active, so "no sanctions" is a real value,
 *  never a missing field [LAW:no-defensive-null-guards]. Frozen because it is one
 *  shared object handed to every actor in good standing — its `readonly` type forbids
 *  mutation at compile time, and the freeze makes that true at runtime too, so the
 *  shared baseline can never be corrupted for all callers [LAW:no-shared-mutable-globals]. */
export const IN_GOOD_STANDING: ActorStanding = Object.freeze({ kind: 'in-good-standing' });
