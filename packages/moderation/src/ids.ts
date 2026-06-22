import type { BlankError, Brand, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/**
 * Who is acting, as far as the policy boundary cares — an opaque reference to an
 * actor. Moderation is core and cannot depend on identity (a sibling core), so it
 * deliberately knows nothing of an identity `AccountId` or `ChannelId`
 * [LAW:one-way-deps]; the app maps its principal onto this ref at the one
 * composition point [LAW:decomposition], the same move `@crowdship/stream` makes
 * with its `ChannelRef`. Opaque, minted upstream, never parsed here.
 */
export type ActorRef = Brand<string, 'ActorRef'>;

/**
 * Names the rule that raised a violation, so a denial is attributable — a backer
 * told WHY, a moderator (the o97.4 pipeline) shown which rule fired, a test able
 * to assert the source of a deny rather than its mere existence. A non-blank
 * label, branded at the one boundary that mints it.
 */
export type PolicyRuleId = Brand<string, 'PolicyRuleId'>;

/**
 * What an actor is attempting — "go-live", "post-message", "claim-channel". An
 * OPEN label, never a platform-closed enum: the boundary carries it to the rules
 * that judge it and never branches on a fixed set [LAW:no-mode-explosion], exactly
 * as `@crowdship/menu`'s `EffectKind` refuses to enumerate what a builder sells.
 * A new conduct surface is a new value here, not a new code path.
 */
export type ConductAction = Brand<string, 'ConductAction'>;

/**
 * Where author-supplied text becomes visible — "display-name", "bio",
 * "stream-title", "chat-message". An OPEN label for the same reason
 * {@link ConductAction} is: the platform owns the policy OUTCOMES, never the
 * enumeration of every surface text can appear on [LAW:no-mode-explosion].
 */
export type PublishedSurface = Brand<string, 'PublishedSurface'>;

/**
 * What a report points at — an opaque handle to the reported thing (a stream, a
 * chat message, a menu item, a profile). OPEN, never a platform-closed taxonomy of
 * "reportable kinds": what can be reported is product variability the moderation
 * core has no business enumerating [LAW:no-mode-explosion], the same stance
 * {@link ConductAction} and {@link PublishedSurface} take. The app maps the real
 * entity onto this ref at the edge, exactly as it maps a principal onto an
 * {@link ActorRef}; the core never parses it.
 */
export type ReportTarget = Brand<string, 'ReportTarget'>;

/**
 * The identity of one entry in the audit trail, ASSIGNED by the trail when an event
 * is recorded — never chosen by the caller, because an id must be unique and that
 * uniqueness is the store's to guarantee [LAW:single-enforcer]. An action references
 * the entry it resolves by this id, so the human and automated paths correlate
 * through one stable handle. Branded so a raw string can never stand in for a real,
 * trail-issued id.
 */
export type EntryId = Brand<string, 'EntryId'>;

export const actorRef = (raw: string): Result<ActorRef, BlankError> => nonBlank<'ActorRef'>('actorRef', raw);
export const policyRuleId = (raw: string): Result<PolicyRuleId, BlankError> =>
  nonBlank<'PolicyRuleId'>('policyRuleId', raw);
export const conductAction = (raw: string): Result<ConductAction, BlankError> =>
  nonBlank<'ConductAction'>('conductAction', raw);
export const publishedSurface = (raw: string): Result<PublishedSurface, BlankError> =>
  nonBlank<'PublishedSurface'>('publishedSurface', raw);
export const reportTarget = (raw: string): Result<ReportTarget, BlankError> =>
  nonBlank<'ReportTarget'>('reportTarget', raw);
export const entryId = (raw: string): Result<EntryId, BlankError> => nonBlank<'EntryId'>('entryId', raw);
