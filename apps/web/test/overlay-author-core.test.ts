import {
  DEFAULT_HANDLE_POLICY,
  EMPTY_BIO,
  InMemoryChannelStore,
  NO_ROLES,
  StandardChannelService,
  accountId,
  channelId,
  displayName,
  email,
  handle,
  roleSet,
  type Account,
  type AccountId,
  type ChannelId,
  type ChannelIdMint,
  type ChannelProfile,
  type ChannelService,
  type Principal,
  type Role,
  type RoleChangeError,
} from '@crowdship/identity';
import { ok, timestamp, type Clock, type Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import type { OverlayStyle } from '../src/data/overlay-style';
import { performSetOverlay, type AuthorOverlayDeps, type RawOverlayStyle } from '../src/server/overlay-author-core';
import { InMemoryOverlayStore } from '../src/server/overlay-store';

/**
 * The pure overlay-authoring core, exercised over the REAL channel service and the
 * real in-memory store — the overlay twin of the menu-author-core suite. The tests
 * pin the contract: who may restyle, whose channel the style binds to, what the rail
 * refuses, and that watchers are announced exactly what the store now holds — after
 * it holds it, and never on a refusal [LAW:verifiable-goals].
 */

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got: ${JSON.stringify(r.error)}`);
  return r.value;
};

const fixedClock: Clock = { now: () => must(timestamp(1_700_000_000_000)) };

class CountingChannelMint implements ChannelIdMint {
  #n = 0;
  newChannelId(): ChannelId {
    this.#n += 1;
    return must(channelId(`chan-${this.#n}`));
  }
}

class StubRoleGranter {
  grantRole(id: AccountId, _role: Role): Promise<Result<Account, RoleChangeError>> {
    return Promise.resolve(
      ok({ id, email: must(email('b@example.com')), createdAt: fixedClock.now(), roles: NO_ROLES }),
    );
  }
}

const channelService = (): ChannelService =>
  new StandardChannelService({
    clock: fixedClock,
    ids: new CountingChannelMint(),
    roles: new StubRoleGranter(),
    store: new InMemoryChannelStore(),
    policy: DEFAULT_HANDLE_POLICY,
  });

const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

const profileOf = (name: string): ChannelProfile => ({
  displayName: must(displayName(name)),
  bio: EMPTY_BIO,
});

const claim = async (channels: ChannelService, owner: string, rawHandle: string): Promise<void> => {
  const claimed = await channels.claimChannel(must(accountId(owner)), must(handle(rawHandle)), profileOf(rawHandle));
  if (!claimed.ok) throw new Error(`claim failed: ${JSON.stringify(claimed.error)}`);
};

/** A harness over the core: real channel service, real in-memory store, and a
 *  recorder standing at the announce seam so the tests observe exactly what watchers
 *  would be nudged with, and when. */
const harness = (who: Principal | null) => {
  const channels = channelService();
  const store = new InMemoryOverlayStore();
  const announced: { slug: string; style: OverlayStyle; storedAtAnnounce: OverlayStyle | undefined }[] = [];
  const deps: AuthorOverlayDeps = {
    principal: who,
    channelOf: (ownerId) => channels.channelByOwner(ownerId),
    saveStyle: (channelId, style) => store.setStyle(channelId, style),
    announceStyle: async (slug, style) => {
      // Capture what the store held AT the announce, proving save-before-announce
      // rather than trusting call order folklore [LAW:no-ambient-temporal-coupling].
      const channel = await channels.channelByHandle(must(handle(slug)));
      const storedAtAnnounce = channel === undefined ? undefined : await store.styleOf(channel.id);
      announced.push({ slug, style, storedAtAnnounce });
    },
  };
  return { channels, store, announced, deps };
};

const LEGAL_RAW: RawOverlayStyle = { placement: 'top-right', accentHue: '280', durationSeconds: '12' };
const LEGAL_STYLE: OverlayStyle = { placement: 'top-right', accentHue: 280, durationSeconds: 12 };

describe('performSetOverlay', () => {
  it('refuses an unauthenticated restyle — you cannot restyle as no one', async () => {
    const { announced, deps } = harness(null);
    expect(await performSetOverlay(deps, LEGAL_RAW)).toEqual({ kind: 'must-authenticate' });
    expect(announced).toEqual([]);
  });

  it('refuses an account with no claimed channel — there is no overlay to style', async () => {
    const { announced, deps } = harness(principal('acct-1'));
    expect(await performSetOverlay(deps, LEGAL_RAW)).toEqual({ kind: 'no-channel' });
    expect(announced).toEqual([]);
  });

  it('saves the builder\'s style against their OWN channel and announces it after the save', async () => {
    const { channels, store, announced, deps } = harness(principal('acct-1'));
    await claim(channels, 'acct-1', 'mara');

    expect(await performSetOverlay(deps, LEGAL_RAW)).toEqual({ kind: 'saved', style: LEGAL_STYLE });

    const channel = await channels.channelByHandle(must(handle('mara')));
    expect(channel).toBeDefined();
    expect(await store.styleOf(channel!.id)).toEqual(LEGAL_STYLE);
    // One announce, on the builder's own slug, carrying the style the store ALREADY held.
    expect(announced).toEqual([{ slug: 'mara', style: LEGAL_STYLE, storedAtAnnounce: LEGAL_STYLE }]);
  });

  it('refuses an out-of-bounds style, naming every failing axis, saving and announcing nothing', async () => {
    const { channels, store, announced, deps } = harness(principal('acct-1'));
    await claim(channels, 'acct-1', 'mara');

    const result = await performSetOverlay(deps, { placement: 'center', accentHue: '999', durationSeconds: '0' });
    expect(result).toEqual({ kind: 'invalid', problems: ['placement', 'accentHue', 'durationSeconds'] });

    const channel = await channels.channelByHandle(must(handle('mara')));
    expect(await store.styleOf(channel!.id)).toBeUndefined();
    expect(announced).toEqual([]);
  });

  it('refuses non-numeric axis strings — an empty hue is a fault, never a silent zero', async () => {
    const { announced, deps, channels } = harness(principal('acct-1'));
    await claim(channels, 'acct-1', 'mara');

    expect(await performSetOverlay(deps, { ...LEGAL_RAW, accentHue: '' })).toEqual({
      kind: 'invalid',
      problems: ['accentHue'],
    });
    expect(await performSetOverlay(deps, { ...LEGAL_RAW, durationSeconds: 'soon' })).toEqual({
      kind: 'invalid',
      problems: ['durationSeconds'],
    });
    expect(announced).toEqual([]);
  });

  it('refuses a fractional axis string — coins and seconds are whole, never truncated', async () => {
    const { deps, channels } = harness(principal('acct-1'));
    await claim(channels, 'acct-1', 'mara');
    expect(await performSetOverlay(deps, { ...LEGAL_RAW, durationSeconds: '2.5' })).toEqual({
      kind: 'invalid',
      problems: ['durationSeconds'],
    });
  });
});
