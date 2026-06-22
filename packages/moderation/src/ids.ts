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

export const actorRef = (raw: string): Result<ActorRef, BlankError> => nonBlank<'ActorRef'>('actorRef', raw);
export const policyRuleId = (raw: string): Result<PolicyRuleId, BlankError> =>
  nonBlank<'PolicyRuleId'>('policyRuleId', raw);
export const conductAction = (raw: string): Result<ConductAction, BlankError> =>
  nonBlank<'ConductAction'>('conductAction', raw);
export const publishedSurface = (raw: string): Result<PublishedSurface, BlankError> =>
  nonBlank<'PublishedSurface'>('publishedSurface', raw);
