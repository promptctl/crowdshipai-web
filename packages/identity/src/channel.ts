import type { Brand, Result, Timestamp } from '@crowdship/std';
import { err, ok } from '@crowdship/std';
import type { AccountId, ChannelId } from './ids.js';

/**
 * A builder channel: the stable public identity a stream points at. "The stream
 * is the resume; the channel is its cover."
 *
 * It is a *separate record from {@link Account}*, not a clutch of optional fields
 * bolted onto it [LAW:decomposition]. An account is the private login identity
 * (one email, a credential); a channel is the public on-camera identity (a handle
 * and a profile). Fusing them would make `Account` mean "login identity AND
 * public presence" — the one-phrase-without-"and" test fails — and force every
 * account that never streams to carry nullable channel fields [LAW:no-defensive-null-guards].
 *
 * Holding the `builder` capability and owning a channel answer *different*
 * questions, each with its own single source of truth [LAW:one-source-of-truth]:
 * `account.roles` is the authority for "may this account do builder things?" (what
 * the auth gate reads); the channel record is the authority for "what is this
 * account's public channel identity?". Neither is derived from the other. They are
 * *coupled* by claiming — claiming a channel grants the builder role — and that
 * coupling has one owner: `StandardChannelService.claimChannel`, which orders its
 * two writes (grant, then insert) so any partial failure leaves only the benign,
 * self-healing residue (a capability with no channel), never the harmful one
 * [LAW:no-ambient-temporal-coupling]. The writes are not yet one transaction —
 * they cross two stores, and the single-actor walking skeleton has no concurrent
 * writer to make a race real; when a concurrent store arrives, the same service
 * boundary is where one transaction will wrap them. A future relinquish (revoke +
 * delete) must run through that same single owner so the two facts stay coupled.
 */
export interface Channel {
  /**
   * The stable internal identity — minted, never the {@link handle}. Downstream
   * domains (menu, stream, settlement) reference a channel by this, so renaming
   * the public handle never cascades into them [LAW:carrying-cost].
   */
  readonly id: ChannelId;
  /** The account that holds this channel. The owner is who the channel belongs to, not an authz check. */
  readonly ownerId: AccountId;
  /** The public, unique, renameable URL slug. One canonical form per channel [LAW:one-source-of-truth]. */
  readonly handle: Handle;
  /** The mutable public presentation. Grows by adding fields, never by a rewrite [LAW:carrying-cost]. */
  readonly profile: ChannelProfile;
  /**
   * The platform's trust signal for this channel — a *sibling to {@link profile},
   * deliberately not a field inside it* [LAW:decomposition]. The profile is what
   * the *builder* edits (via `editProfile`); verification is what the *platform*
   * asserts. Folding a badge into the builder-owned profile would let a builder
   * mark themselves verified through `editProfile` — the decomposition is the
   * security boundary. The channel record is the single source of truth for "is
   * this channel platform-affirmed?" [LAW:one-source-of-truth]; it is set only
   * through the platform-only `setVerification`, never through a profile edit.
   */
  readonly verification: VerificationStatus;
  readonly createdAt: Timestamp;
}

/**
 * The mutable public face of a channel. Deliberately a small record that *grows
 * by adding fields* (avatar, links, theme) rather than forcing a rewrite when the
 * next presentation concern arrives [LAW:carrying-cost] — the same "new fields,
 * not a new type" discipline {@link Account} follows.
 */
export interface ChannelProfile {
  readonly displayName: DisplayName;
  readonly bio: Bio;
}

/**
 * The platform's trust signal for a channel — the anti-impersonation pairing to
 * reserved handles: those stop someone *claiming* an authority name, this lets the
 * platform *affirm* that a channel is who it says.
 *
 * One closed union of mutually-exclusive tiers, not two booleans
 * (`isVerified`/`isOfficial`) [LAW:types-are-the-program]: booleans would make the
 * illegal `official-but-not-verified` state representable and force every reader to
 * defend against it. A single closed tier makes "no signal", "verified builder",
 * and "official entity" the *only* three states, and `'none'` is an explicit
 * value, never the absence of one [LAW:dataflow-not-control-flow] — the same
 * discipline {@link EMPTY_BIO} follows. Adding a tier is one edit here; exhaustive
 * switches elsewhere then fail to compile until they account for it.
 *
 * Deliberately *no* `affirmedAt` timestamp yet: the trust signal the ticket asks
 * for is the tier itself; an audit timestamp is a feature not requested, and "a
 * new field, not a rewrite" is the clean path to add it later [LAW:carrying-cost].
 */
export type VerificationStatus = 'none' | 'verified' | 'official';

/**
 * Every verification tier, in ascending order of trust — the single source of
 * truth for "what tiers exist" [LAW:one-source-of-truth], mirroring {@link ROLES}.
 * The constructor below admits only a member of this set.
 */
export const VERIFICATION_STATUSES: readonly VerificationStatus[] = ['none', 'verified', 'official'];

export type VerificationStatusError = { readonly kind: 'unknown-status'; readonly value: string };

/**
 * The trust boundary for a verification status arriving as a raw string (a durable
 * row, an API field). It admits only a member of {@link VERIFICATION_STATUSES};
 * anything else is a named failure the caller must handle, never a silently
 * coerced value [LAW:no-silent-failure] — the same shape `role()` uses.
 */
export const verificationStatus = (raw: string): Result<VerificationStatus, VerificationStatusError> =>
  (VERIFICATION_STATUSES as readonly string[]).includes(raw)
    ? ok(raw as VerificationStatus)
    : err({ kind: 'unknown-status', value: raw });

/**
 * A fresh channel's trust signal — none. Named like {@link EMPTY_BIO} and
 * {@link NO_ROLES} so "an unverified channel" has one home, never a bare `'none'`
 * literal scattered at the claim site [LAW:single-enforcer].
 */
export const UNVERIFIED: VerificationStatus = 'none';

/**
 * The public, unique handle a channel is reached by — the URL slug
 * (`crowdship.ai/@handle`). Branded so the only way to obtain one is through
 * {@link handle}, which canonicalizes it (trimmed, lowercased) so "the same
 * handle" is exactly one value regardless of the casing it was typed in
 * [LAW:one-source-of-truth] — the same discipline `Email` uses for the login
 * identity. Distinct from {@link ChannelId}: a handle is a *renameable alias*,
 * the id is the stable identity.
 */
export type Handle = Brand<string, 'Handle'>;

export type HandleError =
  | { readonly kind: 'blank' }
  | { readonly kind: 'too-short'; readonly min: number }
  | { readonly kind: 'too-long'; readonly max: number }
  | { readonly kind: 'malformed'; readonly value: string };

const HANDLE_MIN = 3;
const HANDLE_MAX = 30;
/**
 * A handle is lowercase letters, digits, and underscores, and must *begin with a
 * letter* — so a handle can never be all-numeric (mistakable for an id) or a run
 * of punctuation. URL-safe by construction; no escaping is ever needed downstream
 * [LAW:types-are-the-program].
 */
const HANDLE_SHAPE = /^[a-z][a-z0-9_]*$/;

/**
 * The trust boundary for a channel handle. Canonicalization (trim + lowercase) is
 * *defined behavior surfaced here*, never a silent mutation elsewhere
 * [LAW:no-silent-failure]; case-insensitive uniqueness follows from it. Failures
 * are named values the caller must handle, ordered so the most specific reason
 * (too short / too long / malformed shape) is reported rather than a blanket
 * "invalid".
 */
export const handle = (raw: string): Result<Handle, HandleError> => {
  const canonical = raw.trim().toLowerCase();
  if (canonical.length === 0) return err({ kind: 'blank' });
  if (canonical.length < HANDLE_MIN) return err({ kind: 'too-short', min: HANDLE_MIN });
  if (canonical.length > HANDLE_MAX) return err({ kind: 'too-long', max: HANDLE_MAX });
  if (!HANDLE_SHAPE.test(canonical)) return err({ kind: 'malformed', value: raw });
  return ok(canonical as Handle);
};

/**
 * The human-readable name shown on a channel — distinct from the {@link Handle}:
 * the handle is the unique slug in the URL, the display name is the free-form
 * label a viewer reads ("Brandon F."). Non-empty and length-bounded; the brand
 * guarantees that bound was enforced once, at this constructor.
 */
export type DisplayName = Brand<string, 'DisplayName'>;

export type DisplayNameError =
  | { readonly kind: 'blank' }
  | { readonly kind: 'too-long'; readonly max: number };

const DISPLAY_NAME_MAX = 50;

export const displayName = (raw: string): Result<DisplayName, DisplayNameError> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return err({ kind: 'blank' });
  if (trimmed.length > DISPLAY_NAME_MAX) return err({ kind: 'too-long', max: DISPLAY_NAME_MAX });
  return ok(trimmed as DisplayName);
};

/**
 * A channel's free-form blurb. Unlike a {@link DisplayName} it may be *empty* — a
 * fresh channel has no bio yet, and that absence is the empty value, not a null or
 * a special case [LAW:dataflow-not-control-flow]. The single enforced invariant is
 * a length bound; the brand certifies it.
 */
export type Bio = Brand<string, 'Bio'>;

export type BioError = { readonly kind: 'too-long'; readonly max: number };

const BIO_MAX = 500;

export const bio = (raw: string): Result<Bio, BioError> => {
  const trimmed = raw.trim();
  if (trimmed.length > BIO_MAX) return err({ kind: 'too-long', max: BIO_MAX });
  return ok(trimmed as Bio);
};

/**
 * The empty bio — a channel with nothing written yet. Minted through the
 * constructor like any other so there is one home for "an empty bio is a valid
 * bio", never an `'' as Bio` cast scattered at callsites [LAW:single-enforcer].
 */
export const EMPTY_BIO: Bio = (() => {
  const r = bio('');
  if (!r.ok) throw new Error('unreachable: the empty string is a valid bio');
  return r.value;
})();
