import type { Handle } from './channel.js';

/**
 * Why a *well-formed* handle is nonetheless not claimable by an arbitrary account.
 *
 * This is a different question from {@link HandleError}, and the distinction is the
 * whole point [LAW:decomposition]: `handle()` answers "is this a well-formed
 * handle?" (shape — lowercase, `^[a-z][a-z0-9_]*$`, length), and `@admin` passes
 * it — it is a perfectly valid `Handle` value the platform itself might use. This
 * answers the separate question "may the *public* claim this valid handle?", which
 * is policy, the same category as "is it already taken?". Fusing the two into
 * `handle()` would conflate well-formed with claimable and make `@official` an
 * unconstructable value even for internal use; keeping them apart lets the shape
 * rule stay lexical and the impersonation rule stay policy, each with one home.
 */
export type HandleReservation =
  /** The handle is (or contains, as a whole token) an authority term — `admin`, `support`, `official`. */
  | { readonly kind: 'reserved-word'; readonly word: string }
  /** The handle embeds a platform brand term — claiming it implies false platform affiliation. */
  | { readonly kind: 'brand-impersonation'; readonly brand: string };

/**
 * The claimability policy for handles: given a well-formed {@link Handle}, is it
 * reserved against public claiming? Expressed as the smallest seam the channel
 * service needs [LAW:locality-or-seam] and injected as a dependency, so the
 * reserved set is a *swappable value* — a deployment tunes it, a test pins a tiny
 * one — without the claim/rename rules above it changing. `undefined` means
 * claimable; a {@link HandleReservation} names exactly why it is not.
 */
export interface HandlePolicy {
  reservationOf(handle: Handle): HandleReservation | undefined;
}

/**
 * The leetspeak confusable fold: digits to the latin letter they most commonly
 * stand in for. So `4dm1n` and `0fficial` are recognized as the authority terms
 * they imitate. This is a deliberate *heuristic*, not exhaustive confusable
 * detection — it folds the handful of digit substitutions reachable inside a
 * handle's `[a-z0-9_]` alphabet, which is the realistic squatting surface here;
 * richer Unicode-confusable analysis is a later hardening the policy seam leaves
 * room for, never something this fold silently pretends to cover [LAW:no-silent-failure].
 */
const LEET_FOLD: ReadonlyMap<string, string> = new Map([
  ['0', 'o'],
  ['1', 'i'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
]);

/** Fold a handle to its confusable-canonical form: each leet digit mapped to its letter. */
const foldConfusables = (value: string): string =>
  [...value].map((char) => LEET_FOLD.get(char) ?? char).join('');

/**
 * The default reserved authority terms — names that imply platform staff or
 * system endpoints. Matched per *token* (split on `_`), never as a substring, so
 * `admin` reserves `admin`, `the_admin`, and `admin_official` but leaves
 * `adminion` and `administrate` claimable [LAW:types-are-the-program]: the policy
 * rejects the impersonation shapes by construction without eating ordinary words
 * that merely contain the letters. The exact set is a tunable knob, not a
 * principle — this is the value the seam exists to let us swap.
 */
export const DEFAULT_RESERVED_WORDS: readonly string[] = [
  'admin',
  'administrator',
  'official',
  'support',
  'staff',
  'moderator',
  'mod',
  'security',
  'system',
  'root',
  'help',
  'api',
  'billing',
  'payments',
  'team',
];

/**
 * The default platform brand terms. Matched by *containment*, not by token: a
 * distinctive coined brand has a near-zero rate of innocent collision, so any
 * handle embedding it (`mycrowdship`, `crowdship_help`, `cr0wdsh1p`) is taken as
 * an affiliation claim. This is the deliberate asymmetry with reserved words,
 * whose generic nature demands the narrower token match.
 */
export const DEFAULT_BRAND_TERMS: readonly string[] = ['crowdship'];

export interface HandlePolicyConfig {
  readonly reservedWords: Iterable<string>;
  readonly brandTerms: Iterable<string>;
}

/**
 * THE reserved-handle policy: a pure, data-driven check that every handle a
 * claim or rename proposes is routed through, in one place
 * [LAW:single-enforcer][LAW:effects-at-boundaries]. It holds no state and touches
 * no store — claimability is a function of the handle and the configured sets
 * alone, so it composes into the channel service as one injected value and is
 * testable in complete isolation.
 *
 * The two checks run in the same order every call [LAW:dataflow-not-control-flow]:
 * a brand-impersonation containment match is the stronger signal and reported
 * first, then a per-token reserved-word match. Both run against the
 * confusable-folded handle so leetspeak imitations are caught.
 */
export class StandardHandlePolicy implements HandlePolicy {
  readonly #reservedWords: ReadonlySet<string>;
  readonly #brandTerms: readonly string[];

  constructor(config: HandlePolicyConfig) {
    this.#reservedWords = new Set(config.reservedWords);
    this.#brandTerms = [...config.brandTerms];
  }

  reservationOf(handle: Handle): HandleReservation | undefined {
    const folded = foldConfusables(handle);
    // Brand match runs on the underscore-collapsed handle so a separator cannot
    // smuggle the brand past containment (`crow_dship` reads as the brand). The
    // reserved-word match keeps the underscores — it splits on them into tokens,
    // the very thing that lets `adminion` through while reserving `the_admin`.
    const brand = this.#brandTerms.find((term) => folded.replace(/_/g, '').includes(term));
    if (brand !== undefined) return { kind: 'brand-impersonation', brand };
    const reserved = folded.split('_').find((token) => this.#reservedWords.has(token));
    if (reserved !== undefined) return { kind: 'reserved-word', word: reserved };
    return undefined;
  }
}

/**
 * The default policy: the curated authority and brand sets above. The wiring an
 * edge reaches for when it has no reason to vary the reserved set — production and
 * the channel-page edge use this; a test pins its own to keep assertions small.
 */
export const DEFAULT_HANDLE_POLICY: HandlePolicy = new StandardHandlePolicy({
  reservedWords: DEFAULT_RESERVED_WORDS,
  brandTerms: DEFAULT_BRAND_TERMS,
});
