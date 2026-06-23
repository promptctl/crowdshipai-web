import type { Brand, BlankError, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/**
 * The opaque key naming one live feed — the real-time overlay channel for one
 * stream. The publish side and the watch side agree only on this token; neither
 * learns anything about the other from it [LAW:locality-or-seam]. It is minted
 * upstream and never parsed: the app maps a builder's channel onto a topic at its
 * one composition point [LAW:decomposition], exactly as it maps a principal onto a
 * ledger account or a moderation `ActorRef`. The stream domain's `ChannelRef` and
 * the identity domain's `ChannelId` are deliberately NOT referenced here — this
 * core stands only on the foundation, so a topic is just an opaque, branded string
 * [LAW:one-way-deps].
 */
export type LiveTopic = Brand<string, 'LiveTopic'>;

/**
 * Mint a topic from a raw label at the one trust boundary where a string becomes a
 * topic, blank rejected once so no subscriber re-checks [LAW:single-enforcer]. The
 * non-blank-brand behavior lives once in foundation; this is its `LiveTopic` instance.
 */
export const liveTopic = (raw: string): Result<LiveTopic, BlankError> => nonBlank<'LiveTopic'>('liveTopic', raw);
