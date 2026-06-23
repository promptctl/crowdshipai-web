'use server';

import type { ChatResult } from '../data/chat-result';
import { getChannelService } from './channels';
import { announceChatMessage } from './live-feed';
import { performSendChat } from './chat-core';
import { currentPrincipal } from './principal';

/**
 * The send-chat server action — the `'use server'` edge over {@link performSendChat}.
 * It resolves the request-bound subject (`currentPrincipal()`), binds the author
 * lookup to the channel service, and binds the broadcast to this builder's live
 * topic, then hands the orchestration core plain values and capabilities
 * [LAW:effects-at-boundaries]. The `slug` names which stream's channel the line is
 * broadcast on; it is captured in the publish closure so the core never learns about
 * topics or feeds [LAW:decomposition].
 */
export async function sendChat(slug: string, text: string): Promise<ChatResult> {
  return performSendChat(
    {
      principal: await currentPrincipal(),
      ownChannelName: async (accountId) => {
        const channel = await getChannelService().channelByOwner(accountId);
        return channel === undefined ? null : channel.profile.displayName;
      },
      publish: (author, line) => announceChatMessage(slug, author, line),
    },
    { text },
  );
}
