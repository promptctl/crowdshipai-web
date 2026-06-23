import { describe, expect, it } from 'vitest';

import { CHAT_MAX_LENGTH, chatAuthorLabel } from '../src/data/chat';

/**
 * The public author policy is the one place a chat line's name is decided, so these
 * pin both halves: a builder speaks as their channel name, everyone else as a stable
 * pseudonym that is the SAME every time they speak [LAW:one-source-of-truth] and
 * never leaks the raw account id.
 */
describe('chatAuthorLabel — the public name a line is broadcast under', () => {
  it("uses the builder's channel display name when they hold a channel", () => {
    expect(chatAuthorLabel('acct-mara', 'mara')).toBe('mara');
  });

  it('uses the channel name verbatim even when it would look like a pseudonym', () => {
    // The name is the builder's chosen public identity; the policy never second-guesses it.
    expect(chatAuthorLabel('acct-x', 'viewer-zzzzzz')).toBe('viewer-zzzzzz');
  });

  it('falls back to a viewer pseudonym for an account with no channel', () => {
    const label = chatAuthorLabel('acct-backer-1', null);
    expect(label).toMatch(/^viewer-[0-9a-z]{6}$/);
  });

  it('gives the SAME pseudonym to the same account every time — one voice, not a stranger per line', () => {
    expect(chatAuthorLabel('acct-backer-1', null)).toBe(chatAuthorLabel('acct-backer-1', null));
  });

  it('gives different accounts different pseudonyms', () => {
    expect(chatAuthorLabel('acct-backer-1', null)).not.toBe(chatAuthorLabel('acct-backer-2', null));
  });

  it('never exposes the raw account id in the pseudonym', () => {
    expect(chatAuthorLabel('super-secret-account-id', null)).not.toContain('super-secret-account-id');
  });
});

describe('CHAT_MAX_LENGTH', () => {
  it('is a positive bound the send core and the surface both read from here', () => {
    expect(CHAT_MAX_LENGTH).toBeGreaterThan(0);
  });
});
