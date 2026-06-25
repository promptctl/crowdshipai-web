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
import { findOffer, offerId, type Menu } from '@crowdship/menu';
import { ok, timestamp, type Clock, type Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { offerDisplayOf } from '../src/data/offer-display';
import { performAuthorMenu, type AuthorMenuDeps, type RawOffer } from '../src/server/menu-author-core';
import { InMemoryMenuStore } from '../src/server/menu-store';

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

/** A real-shaped account so a claim can grant the builder capability — the role write path
 *  is identity's own concern; here it only needs to succeed [LAW:behavior-not-structure]. */
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

const deps = (
  subject: Principal | null,
  channels: ChannelService,
  menus: InMemoryMenuStore,
): AuthorMenuDeps => ({
  principal: subject,
  channelOf: (ownerId) => channels.channelByOwner(ownerId),
  saveMenu: (id, menu) => menus.setMenu(id, menu),
});

const offer = (over: Partial<RawOffer>): RawOffer => ({
  id: 'shout',
  price: '50',
  kind: 'shoutout',
  label: 'Shoutout',
  summary: 'I read your name out loud.',
  ...over,
});

describe('performAuthorMenu — a builder authors a priced menu against their own channel', () => {
  it('refuses an anonymous author — you cannot author a menu as no one', async () => {
    const menus = new InMemoryMenuStore();
    const result = await performAuthorMenu(deps(null, channelService(), menus), { offers: [offer({})] });
    expect(result).toEqual({ kind: 'must-authenticate' });
  });

  it('refuses an account with no claimed channel — nothing to author against', async () => {
    const channels = channelService();
    const result = await performAuthorMenu(deps(principal('acc-x'), channels, new InMemoryMenuStore()), {
      offers: [offer({})],
    });
    expect(result).toEqual({ kind: 'no-channel' });
  });

  it('authors and persists the menu against the builder\'s OWN channel, keyed by channel id', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch');
    const menus = new InMemoryMenuStore();

    const result = await performAuthorMenu(deps(principal('acc-mara'), channels, menus), {
      offers: [offer({ id: 'shout', price: '50' }), offer({ id: 'fund', price: '1000', kind: 'bounty-pool', label: 'Fund it', summary: 'ship it' })],
    });
    expect(result).toEqual({ kind: 'saved', count: 2 });

    // The menu landed under the builder's stable channel id, and is the real domain menu
    // the buy path charges against [LAW:one-source-of-truth].
    const channel = await channels.channelByHandle(must(handle('ffmpeg_witch')));
    const stored = (await menus.menuOf(channel!.id)) as Menu;
    const fund = findOffer(stored, must(offerId('fund')));
    expect(fund?.price).toBe(1000n);
    expect(offerDisplayOf(fund!.effect.params)).toEqual({ label: 'Fund it', summary: 'ship it' });
  });

  it('reports a non-numeric price at its position, distinct from the domain non-positive check', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch');
    const result = await performAuthorMenu(deps(principal('acc-mara'), channels, new InMemoryMenuStore()), {
      offers: [offer({ id: 'a', price: '50' }), offer({ id: 'b', price: 'free' }), offer({ id: 'c', price: '1.5' })],
    });
    expect(result).toEqual({ kind: 'invalid-prices', at: [1, 2] });
  });

  it('forwards the menu domain\'s authoring problems verbatim (blank id, non-positive price)', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch');
    const result = await performAuthorMenu(deps(principal('acc-mara'), channels, new InMemoryMenuStore()), {
      offers: [offer({ id: '', price: '0' })],
    });
    expect(result.kind).toBe('invalid');
  });

  it('does not persist anything when the submission is invalid', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch');
    const menus = new InMemoryMenuStore();
    await performAuthorMenu(deps(principal('acc-mara'), channels, menus), { offers: [offer({ id: '' })] });
    const channel = await channels.channelByHandle(must(handle('ffmpeg_witch')));
    expect(await menus.menuOf(channel!.id)).toBeUndefined();
  });
});
