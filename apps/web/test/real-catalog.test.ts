import type { Clock, Result } from '@crowdship/std';
import { ok, timestamp } from '@crowdship/std';
import {
  DEFAULT_HANDLE_POLICY,
  EMPTY_BIO,
  InMemoryChannelStore,
  NO_ROLES,
  StandardChannelService,
  accountId,
  bio,
  channelId,
  displayName,
  email,
  handle,
  type Account,
  type AccountId,
  type ChannelId,
  type ChannelIdMint,
  type ChannelProfile,
  type ChannelService,
  type Role,
  type RoleChangeError,
} from '@crowdship/identity';
import {
  channelRef,
  createInMemoryIngestBroker,
  ingestEndpoint,
  ingestKey,
  ingestProtocol,
  streamId,
  type ChannelRef,
  type IngestBroker,
} from '@crowdship/stream';
import { describe, expect, it } from 'vitest';

import { authorMenu, DEFAULT_MENU_POLICY, type Menu, type OfferDraft } from '@crowdship/menu';

import { createRealCatalog } from '../src/data/real-catalog';
import { offerParams } from '../src/data/offer-display';
import { InMemoryMenuStore } from '../src/server/menu-store';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
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

/** Hands back a real-shaped account so a claim can grant the builder capability — the
 *  role write path itself is covered in identity's own tests; here it only needs to
 *  succeed so a real channel lands in the store [LAW:behavior-not-structure]. */
class StubRoleGranter {
  grantRole(id: AccountId, _role: Role): Promise<Result<Account, RoleChangeError>> {
    const account: Account = {
      id,
      email: must(email('builder@example.com')),
      createdAt: fixedClock.now(),
      roles: NO_ROLES,
    };
    return Promise.resolve(ok(account));
  }
}

/** A real channel service over an in-memory store — the SAME code path the SQLite store
 *  runs, so the catalog is exercised against real claimed channels, not a stubbed
 *  directory [LAW:behavior-not-structure]. */
const channelService = (): ChannelService =>
  new StandardChannelService({
    clock: fixedClock,
    ids: new CountingChannelMint(),
    roles: new StubRoleGranter(),
    store: new InMemoryChannelStore(),
    policy: DEFAULT_HANDLE_POLICY,
  });

/** A real in-memory broker — the same one the app falls back to when no SFU is
 *  configured — so liveness is read from genuine room state, not a stub [LAW:behavior-not-structure]. */
const broker = (): IngestBroker => {
  let ids = 0;
  let keys = 0;
  return createInMemoryIngestBroker({
    clock: fixedClock,
    newStreamId: () => must(streamId(`str_${(ids += 1)}`)),
    newIngestKey: () => must(ingestKey(`key_${(keys += 1)}`)),
    endpointFor: (channel, protocol) => must(ingestEndpoint(`${protocol}://ingest.test/${channel}`)),
  });
};

const ch = (slug: string): ChannelRef => must(channelRef(slug));
const whip = must(ingestProtocol('whip'));

/** The liveness resolver the composition root injects, here backed by the test broker:
 *  a channel is live iff the broker holds an open session for it — the one authority. */
const livenessOf = (b: IngestBroker) => async (slug: string): Promise<boolean> =>
  (await b.forChannel(ch(slug))) !== null;

const profileOf = (name: string, blurb: string): ChannelProfile => ({
  displayName: must(displayName(name)),
  bio: blurb === '' ? EMPTY_BIO : must(bio(blurb)),
});

/** Claim a channel through the REAL service for the given account — the actual claim
 *  code path that binds a handle to an owner. */
const claim = async (
  channels: ChannelService,
  owner: string,
  rawHandle: string,
  name: string,
  blurb: string,
): Promise<void> => {
  const claimed = await channels.claimChannel(
    must(accountId(owner)),
    must(handle(rawHandle)),
    profileOf(name, blurb),
  );
  if (!claimed.ok) throw new Error(`claim failed: ${JSON.stringify(claimed.error)}`);
};

describe('createRealCatalog — the surfaced world read from real claimed channels [discovery-41w.6]', () => {
  it('surfaces a claimed builder in the roster, projected from the channel store', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch', 'FFmpeg Witch', 'i make video pipelines misbehave');
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(broker()));

    const roster = await catalog.roster();
    expect(roster).toHaveLength(1);
    const [card] = roster;
    expect(card.slug).toBe('ffmpeg_witch');
    expect(card.builderName).toBe('FFmpeg Witch');
    // A fresh claim has not authored a title, tags, or audience — honest absences, and a
    // GENERAL_AUDIENCE baseline rating, never an invented value.
    expect(card.title).toBe('');
    expect(card.tags).toEqual([]);
    expect(card.viewerCount).toBe(0);
    expect(card.maturity.level).toBe('general');
    // Offline: no ingest is open, so the derived liveness is false, not a fabricated badge.
    expect(card.isLive).toBe(false);
  });

  it('resolves a claimed handle to its full channel view, and the handle resolves to the OWNER account', async () => {
    const channels = channelService();
    await claim(channels, 'acc-dex', 'rustlang_raccoon', 'Rustlang Raccoon', 'borrow checker therapy');
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(broker()));

    const view = await catalog.channel('rustlang_raccoon');
    expect(view).not.toBeNull();
    expect(view?.stream.builderName).toBe('Rustlang Raccoon');
    expect(view?.bio).toBe('borrow checker therapy');
    // No menu authored yet — an empty menu, not a missing one.
    expect(view?.menu).toEqual([]);

    // Acceptance: resolving the channel's handle yields its owner AccountId — the seam the
    // recruiter-reach contact path lands on.
    const channel = await channels.channelByHandle(must(handle('rustlang_raccoon')));
    expect(channel?.ownerId).toEqual(must(accountId('acc-dex')));
  });

  it('returns null for a handle that names no claimed channel', async () => {
    const channels = channelService();
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(broker()));
    expect(await catalog.channel('nobody_home')).toBeNull();
  });

  it('returns null for a slug that is not a well-formed handle, so fake seed slugs never resolve', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch', 'FFmpeg Witch', '');
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(broker()));
    // Hyphenated seed-style slugs are not valid handles — disjoint namespaces by construction.
    expect(await catalog.channel('ffmpeg-witch')).toBeNull();
  });

  it('reads liveness from real broker room state and orders the roster live-first', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch', 'FFmpeg Witch', '');
    await claim(channels, 'acc-dex', 'rustlang_raccoon', 'Rustlang Raccoon', '');
    const b = broker();
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(b));

    // Go live for the raccoon: their room now holds an open session.
    await b.open(ch('rustlang_raccoon'), whip);

    const roster = await catalog.roster();
    expect(roster[0].slug).toBe('rustlang_raccoon');
    expect(roster[0].isLive).toBe(true);
    expect(roster.find((s) => s.slug === 'ffmpeg_witch')?.isLive).toBe(false);

    // The single-channel read agrees with the roster — both read the one authority.
    expect((await catalog.channel('rustlang_raccoon'))?.stream.isLive).toBe(true);
  });

  it('has nothing purchasable on a claimed channel until a menu is authored', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch', 'FFmpeg Witch', '');
    const catalog = createRealCatalog(channels, new InMemoryMenuStore(), livenessOf(broker()));
    expect(await catalog.purchasable('ffmpeg_witch', 'o1')).toBeNull();
  });

  it('an empty store surfaces an empty roster, not an error', async () => {
    const catalog = createRealCatalog(channelService(), new InMemoryMenuStore(), livenessOf(broker()));
    expect(await catalog.roster()).toEqual([]);
  });

  it('surfaces a claimed builder\'s authored menu in the channel view AND charges from the same offer [41w.7]', async () => {
    const channels = channelService();
    await claim(channels, 'acc-mara', 'ffmpeg_witch', 'FFmpeg Witch', '');
    const menus = new InMemoryMenuStore();
    const catalog = createRealCatalog(channels, menus, livenessOf(broker()));

    // The builder authors a menu against their channel's stable id — the same path the
    // authoring core takes; here we drive the store directly to keep this test about the
    // catalog read [LAW:behavior-not-structure].
    const channel = await channels.channelByHandle(must(handle('ffmpeg_witch')));
    const drafts: readonly OfferDraft[] = [
      { id: 'shout', price: 50n, effect: { kind: 'shoutout', params: offerParams({ label: 'Shoutout', summary: 'name out loud' }) } },
      { id: 'fund', price: 1000n, effect: { kind: 'bounty-pool', params: offerParams({ label: 'Fund it', summary: 'ship it' }) } },
    ];
    const authored = authorMenu(drafts, DEFAULT_MENU_POLICY);
    if (!authored.ok) throw new Error(`menu did not author: ${JSON.stringify(authored.error)}`);
    const menu: Menu = authored.value;
    await menus.setMenu(channel!.id, menu);

    // The watch view now shows the real offers, projected from the stored domain menu.
    const view = await catalog.channel('ffmpeg_witch');
    expect(view?.menu).toEqual([
      { id: 'shout', label: 'Shoutout', priceCoins: 50, effect: { kind: 'shoutout', summary: 'name out loud' } },
      { id: 'fund', label: 'Fund it', priceCoins: 1000, effect: { kind: 'bounty-pool', summary: 'ship it' } },
    ]);

    // purchasable returns the DOMAIN offer the buy pipeline charges against — the SAME
    // price the view showed, read from one source [LAW:one-source-of-truth].
    const offer = await catalog.purchasable('ffmpeg_witch', 'fund');
    expect(offer?.price).toBe(1000n);
    expect(offer?.effect.kind).toBe('bounty-pool');
    // An offer id naming nothing on this menu resolves to null, never a fabricated offer.
    expect(await catalog.purchasable('ffmpeg_witch', 'no-such')).toBeNull();
  });
});
