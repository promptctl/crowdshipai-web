import type { Brand, BlankError, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/**
 * The opaque key naming one stream's presence — the occupancy of one live build.
 * The side that joins/leaves and the side that reads the count agree only on this
 * token; neither learns anything else about the stream from it [LAW:locality-or-seam].
 * It is minted upstream at the app's one composition point (a builder's channel slug
 * becomes a topic) and never parsed here [LAW:decomposition].
 *
 * Deliberately its OWN type, not `@crowdship/live-feed`'s `LiveTopic`: presence is a
 * sibling core, and a core may not depend on a sibling core [LAW:one-way-deps]. The
 * app maps one stream slug onto both a presence topic and a live topic at the same
 * composition point — the two key spaces stay independent so neither core reaches
 * into the other.
 */
export type PresenceTopic = Brand<string, 'PresenceTopic'>;

/**
 * Mint a presence topic from a raw label at the one trust boundary where a string
 * becomes a topic, blank rejected once so no reader re-checks [LAW:single-enforcer].
 * The non-blank-brand behavior lives once in foundation; this is its `PresenceTopic`
 * instance, exactly as `liveTopic` is the `LiveTopic` instance.
 */
export const presenceTopic = (raw: string): Result<PresenceTopic, BlankError> =>
  nonBlank<'PresenceTopic'>('presenceTopic', raw);
