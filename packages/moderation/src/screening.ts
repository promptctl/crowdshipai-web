/**
 * What a content classifier found about a piece of published media, as far as the
 * one hard line cares: either `clear` or `prohibited`, with the reason it crosses
 * the line. The hard line is the founding document's single non-negotiable —
 * no sexual content, nudity, or pornography involving people — and this is the
 * WORLD-FACT a classifier produces at the edge and hands in on the
 * {@link PolicySubject}, so the hard-line rule stays a pure read of a value rather
 * than doing image/text IO inside the boundary [LAW:effects-at-boundaries].
 *
 * Two arms, not a `prohibited: boolean` with an optional reason: a denial that
 * cannot say why is a silent one [LAW:no-silent-failure], so `prohibited` ALWAYS
 * carries a reason and `clear` carries nothing — "blocked for no reason" is
 * unrepresentable [LAW:types-are-the-program]. The reason is a free string, not a
 * closed category of {sexual-content | nudity | pornography}: nothing downstream
 * branches on which facet was detected — the deny is the same regardless — so the
 * specificity belongs in the human-facing reason, a value, not in a mode the
 * platform must enumerate and dispatch on [LAW:no-mode-explosion]. `clear` is the
 * baseline — the absence of a hit, named as its own arm rather than a null
 * [LAW:no-defensive-null-guards].
 *
 * This is categorically NOT a maturity rating (o97.2) or an age gate (o97.3): a
 * violent game or edgy-but-allowed content is `clear` here and merely rated/gated
 * elsewhere. The hard line is never-allowed regardless of rating or viewer age;
 * the classifier — not this type — draws the line between "mature but permitted"
 * and "prohibited", and reports only the latter as `prohibited`.
 */
export type HardLineVerdict =
  | { readonly kind: 'clear' }
  | { readonly kind: 'prohibited'; readonly reason: string };

/** The baseline verdict: nothing prohibited was detected. The value the edge hands
 *  in for any media a classifier passed, so "screened, found clean" is a real value,
 *  never a missing field [LAW:no-defensive-null-guards]. Frozen because it is one
 *  shared object handed in for every clear subject — its `readonly` type forbids
 *  mutation at compile time, and the freeze makes that true at runtime too, so the
 *  shared baseline can never be corrupted for all callers [LAW:no-shared-mutable-globals]. */
export const CLEAR: HardLineVerdict = Object.freeze({ kind: 'clear' });
