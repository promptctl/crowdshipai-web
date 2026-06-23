import type { Principal } from '@crowdship/identity';

import { chatAuthorLabel, CHAT_MAX_LENGTH } from '../data/chat';
import type { ChatResult } from '../data/chat-result';

/**
 * Sending a chat line, as PURE orchestration over already-resolved values — the chat
 * twin of `report-core.ts`. It takes the acting principal, a way to read the
 * sender's public channel name, and the publish capability as plain inputs, so the
 * decision and the broadcast are reproducible in a test without a session, a cookie,
 * or a live feed [LAW:effects-at-boundaries]. The `'use server'` edge
 * (`chat-actions.ts`) resolves those from the request and the composition roots and
 * hands them here.
 *
 * Authentication is checked FIRST, before the text is even read: a chat line must
 * name WHO sent it, because an anonymous back-channel is one no one can be held to.
 * Then the public author is decided ONCE here [LAW:single-enforcer] — a channel name
 * for a builder, a stable pseudonym for everyone else — so every watcher reads the
 * same voice on the line and the wire never carries a client-chosen name.
 */

export interface ChatDeps {
  readonly principal: Principal | null;
  /**
   * The sender's public channel display name, or `null` if they hold no channel —
   * the narrow slice of identity this core needs to label a builder by their chosen
   * public name [LAW:locality-or-seam]. Not the whole channel: the author policy
   * needs only the name.
   */
  ownChannelName(accountId: Principal['id']): Promise<string | null>;
  /** Broadcast the line under its decided author. The one effect, pushed to the edge. */
  publish(author: string, text: string): Promise<void>;
}

export interface ChatInput {
  /** The viewer's typed line, untrimmed — this core owns the trimming and the bounds. */
  readonly text: string;
}

export const performSendChat = async (deps: ChatDeps, input: ChatInput): Promise<ChatResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  // Trim untrusted input before measuring it: a line that is only whitespace is the
  // honest "nothing said", refused distinctly rather than broadcast as a blank line
  // [LAW:no-silent-failure]. The length bound is measured on the trimmed text — the
  // text that would actually be shown.
  const text = input.text.trim();
  if (text.length === 0) return { kind: 'empty' };
  if (text.length > CHAT_MAX_LENGTH) return { kind: 'too-long', max: CHAT_MAX_LENGTH };

  const author = chatAuthorLabel(deps.principal.id, await deps.ownChannelName(deps.principal.id));
  await deps.publish(author, text);
  return { kind: 'sent' };
};
