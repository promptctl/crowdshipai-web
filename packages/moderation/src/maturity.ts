import type { BlankError, Brand, Result } from '@crowdship/std';
import { err, nonBlank, ok } from '@crowdship/std';

/**
 * How mature a stream's content is, as ONE ordered classification the PLATFORM
 * owns — never a boolean per content kind [LAW:no-mode-explosion]. The founding
 * document draws the line right here: content policy is squarely our side of it, so
 * the tiers are a closed union exhaustively handled with no default arm, exactly as
 * identity's `VerificationStatus` is closed where the menu's `EffectKind` is open. A
 * backer browsing, the age gate (o97.3), and a recruiter's filter all read the SAME
 * four tiers, so "what maturity levels exist" has one answer.
 *
 * The tiers are ORDERED, ascending: general < teen < mature < adult — that order is
 * the whole reason a level is a SCALE and not a set, because age-gating derives a
 * minimum viewer standing from it. {@link MATURITY_LEVELS} is the single
 * authoritative statement of both membership and order [LAW:one-source-of-truth];
 * every comparison reads it rather than re-encoding the sequence.
 */
export type MaturityLevel = 'general' | 'teen' | 'mature' | 'adult';

/**
 * The tiers in ascending order — the one authoritative source for both membership and
 * rank [LAW:one-source-of-truth]. Reorder or extend the scale here and every reader
 * follows, because none re-encodes the order.
 */
export const MATURITY_LEVELS: readonly MaturityLevel[] = ['general', 'teen', 'mature', 'adult'];

/** The error {@link maturityLevel} returns for a value outside the closed scale —
 *  a tier the platform does not define is rejected loudly, never coerced [LAW:no-silent-failure]. */
export type UnknownMaturityLevel = { readonly kind: 'unknown-maturity-level'; readonly value: string };

/**
 * Validate a raw string into a {@link MaturityLevel} at the one trust boundary where it
 * enters — a form field, a stored value — so an undefined tier is rejected here rather
 * than defended against at every reader downstream [LAW:single-enforcer].
 */
export const maturityLevel = (raw: string): Result<MaturityLevel, UnknownMaturityLevel> =>
  (MATURITY_LEVELS as readonly string[]).includes(raw)
    ? ok(raw as MaturityLevel)
    : err({ kind: 'unknown-maturity-level', value: raw });

/**
 * Does `level` sit at or above `floor` in the canonical order? The one ordering
 * primitive readers compose on, so a gate that needs "at least 'mature'" expresses it
 * once here rather than re-deriving the sequence. The answer comes from
 * {@link MATURITY_LEVELS}, so the order lives in exactly one place [LAW:one-source-of-truth].
 */
export const maturityAtLeast = (level: MaturityLevel, floor: MaturityLevel): boolean =>
  MATURITY_LEVELS.indexOf(level) >= MATURITY_LEVELS.indexOf(floor);

/**
 * A specific KIND of mature content a stream declares — "violence", "gambling",
 * "strong-language", "drugs". An OPEN label, never a platform-closed enum, and the
 * exact antidote to the flag soup this ticket names: the wrong model is a boolean per
 * kind (`isViolent`, `isGambling`, ...), a struct that grows a field — and a test
 * combination — for every new kind [LAW:no-mode-explosion]. A set of open labels grows
 * by adding a VALUE, not a field, exactly as the menu's `EffectKind` does. The platform
 * owns the maturity LEVEL (closed, because age-gating keys off it) but NOT the
 * enumeration of every content kind a builder or classifier might describe, so the
 * descriptors stay open.
 */
export type ContentDescriptor = Brand<string, 'ContentDescriptor'>;

export const contentDescriptor = (raw: string): Result<ContentDescriptor, BlankError> =>
  nonBlank<'ContentDescriptor'>('contentDescriptor', raw);

/**
 * A stream's maturity as data other systems read: ONE ordered level plus the open set
 * of content kinds present. Two axes, each modeled to resist mode explosion — severity
 * is the single ordered {@link MaturityLevel}, the kinds are a set of open
 * {@link ContentDescriptor} labels — so neither degenerates into the boolean-per-kind
 * soup the ticket warns against. The descriptors carry no order and no duplicates: they
 * are a SET [LAW:one-source-of-truth], represented as an array for plain serialization
 * and canonicalized by {@link maturityRating}.
 */
export interface MaturityRating {
  readonly level: MaturityLevel;
  readonly descriptors: readonly ContentDescriptor[];
}

/**
 * The one home for building a rating, where two spellings of the same content kinds
 * become the SAME value [LAW:one-source-of-truth]. The level and labels arrive already
 * validated; this is the single enforcer of the one invariant their types cannot carry
 * — that `descriptors` holds a set, not a bag [LAW:single-enforcer]. (TypeScript has no
 * ordered-unique-array type, so the array stays serializable and the constructor, not
 * the type, guarantees its set-ness.)
 */
export const maturityRating = (
  level: MaturityLevel,
  descriptors: readonly ContentDescriptor[],
): MaturityRating => ({ level, descriptors: [...new Set(descriptors)] });

/**
 * A stream that declares itself broadly suitable — the baseline rating, named so
 * "general-audience, nothing flagged" has one home rather than a bare literal, like
 * identity's `UNVERIFIED`. NOT a stand-in for "unrated": the absence of a rating is
 * `null` at the carrying site, never this value, so "declared general" and "never
 * declared" stay distinct [LAW:no-silent-failure].
 *
 * Frozen because it is a shared singleton on a published surface: `readonly` is erased
 * at runtime, so without this a consumer could mutate the one shared baseline and
 * corrupt it for every reader [LAW:no-shared-mutable-globals]. The freeze makes the
 * runtime value as immutable as its type already promises.
 */
export const GENERAL_AUDIENCE: MaturityRating = Object.freeze({
  level: 'general',
  descriptors: Object.freeze([] as ContentDescriptor[]),
});
