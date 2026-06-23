import { accountId, roleSet, type Principal } from '@crowdship/identity';
import { type Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { CHAT_MAX_LENGTH } from '../src/data/chat';
import { performSendChat, type ChatDeps } from '../src/server/chat-core';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

/** A publish recorder standing in for the live feed — the one effect this core has,
 *  captured as data so the test reads exactly what (if anything) was broadcast. */
const recorder = () => {
  const calls: { author: string; text: string }[] = [];
  return {
    calls,
    publish: async (author: string, text: string): Promise<void> => {
      calls.push({ author, text });
    },
  };
};

/** Deps for a sender who holds a channel with the given display name (a builder). */
const asBuilder = (subject: Principal | null, name: string, rec: ReturnType<typeof recorder>): ChatDeps => ({
  principal: subject,
  ownChannelName: async () => name,
  publish: rec.publish,
});

/** Deps for a sender who holds no channel (a backer/viewer). */
const asViewer = (subject: Principal | null, rec: ReturnType<typeof recorder>): ChatDeps => ({
  principal: subject,
  ownChannelName: async () => null,
  publish: rec.publish,
});

describe('performSendChat — an authenticated viewer speaks on a stream', () => {
  it('refuses an anonymous send and broadcasts nothing', async () => {
    const rec = recorder();
    expect(await performSendChat(asViewer(null, rec), { text: 'hello' })).toEqual({ kind: 'must-authenticate' });
    expect(rec.calls).toEqual([]);
  });

  it('refuses a blank line and broadcasts nothing', async () => {
    const rec = recorder();
    expect(await performSendChat(asViewer(principal('acct-1'), rec), { text: '   ' })).toEqual({ kind: 'empty' });
    expect(rec.calls).toEqual([]);
  });

  it('refuses a line past the length bound and broadcasts nothing', async () => {
    const rec = recorder();
    const tooLong = 'x'.repeat(CHAT_MAX_LENGTH + 1);
    expect(await performSendChat(asViewer(principal('acct-1'), rec), { text: tooLong })).toEqual({
      kind: 'too-long',
      max: CHAT_MAX_LENGTH,
    });
    expect(rec.calls).toEqual([]);
  });

  it("broadcasts a builder's line under their channel display name", async () => {
    const rec = recorder();
    expect(await performSendChat(asBuilder(principal('acct-mara'), 'mara', rec), { text: 'one cmov away' })).toEqual({
      kind: 'sent',
    });
    expect(rec.calls).toEqual([{ author: 'mara', text: 'one cmov away' }]);
  });

  it("broadcasts a viewer's line under a stable viewer pseudonym", async () => {
    const rec = recorder();
    expect(await performSendChat(asViewer(principal('acct-backer'), rec), { text: 'wen simd' })).toEqual({ kind: 'sent' });
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.author).toMatch(/^viewer-[0-9a-z]{6}$/);
    expect(rec.calls[0]!.text).toBe('wen simd');
  });

  it('trims surrounding whitespace before broadcasting — the text the audience reads', async () => {
    const rec = recorder();
    await performSendChat(asViewer(principal('acct-backer'), rec), { text: '  trimmed  ' });
    expect(rec.calls[0]!.text).toBe('trimmed');
  });
});
