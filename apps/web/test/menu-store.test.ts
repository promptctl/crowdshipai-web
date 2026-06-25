import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { channelId, type ChannelId } from '@crowdship/identity';
import { openIdentityDb } from '@crowdship/identity-node';
import { authorMenu, DEFAULT_MENU_POLICY, type Menu, type OfferDraft } from '@crowdship/menu';
import { afterEach, describe, expect, it } from 'vitest';

import { offerParams } from '../src/data/offer-display';
import { InMemoryMenuStore, type MenuStore } from '../src/server/menu-store';
import { SqliteMenuStore } from '../src/server/sqlite-menu-store';

const chan = (raw: string): ChannelId => {
  const id = channelId(raw);
  if (!id.ok) throw new Error(`bad test channel id: ${raw}`);
  return id.value;
};

const menuOf = (drafts: readonly OfferDraft[]): Menu => {
  const authored = authorMenu(drafts, DEFAULT_MENU_POLICY);
  if (!authored.ok) throw new Error(`test menu did not author: ${JSON.stringify(authored.error)}`);
  return authored.value;
};

const SAMPLE = (): Menu =>
  menuOf([
    {
      id: 'shout',
      price: 50n,
      effect: { kind: 'shoutout', params: offerParams({ label: 'Shoutout', summary: 'name out loud' }) },
    },
    {
      id: 'fund',
      price: 1000n,
      effect: { kind: 'bounty-pool', params: offerParams({ label: 'Fund it', summary: 'ship the feature' }) },
    },
  ]);

// The two stores behind ONE seam must behave identically — the in-memory reference and
// the durable SQLite store run through the same parity suite [LAW:single-enforcer].
const stores: readonly (readonly [string, () => MenuStore])[] = [
  ['InMemoryMenuStore', () => new InMemoryMenuStore()],
  ['SqliteMenuStore', () => new SqliteMenuStore(openIdentityDb(':memory:'))],
];

describe.each(stores)('MenuStore parity: %s', (_name, make) => {
  it('reads back exactly the menu that was authored and stored', async () => {
    const store = make();
    const ch = chan('chan-mara');
    await store.setMenu(ch, SAMPLE());
    expect(await store.menuOf(ch)).toEqual(SAMPLE());
  });

  it('has no menu for a channel that never authored one — an honest undefined', async () => {
    expect(await make().menuOf(chan('chan-nobody'))).toBeUndefined();
  });

  it('re-authoring replaces the whole menu, never appends a second', async () => {
    const store = make();
    const ch = chan('chan-dex');
    await store.setMenu(ch, SAMPLE());
    const replacement = menuOf([
      {
        id: 'only',
        price: 75n,
        effect: { kind: 'name-thing', params: offerParams({ label: 'Name it', summary: 'you pick the name' }) },
      },
    ]);
    await store.setMenu(ch, replacement);
    expect(await store.menuOf(ch)).toEqual(replacement);
  });

  it('keeps each channel\'s menu separate', async () => {
    const store = make();
    await store.setMenu(chan('chan-a'), SAMPLE());
    expect(await store.menuOf(chan('chan-b'))).toBeUndefined();
  });
});

describe('SqliteMenuStore: a menu survives a process restart', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('an authored menu read back after the database is closed and reopened', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crowdship-menu-'));
    const file = join(dir, 'identity.db');

    const opened = openIdentityDb(file);
    await new SqliteMenuStore(opened).setMenu(chan('chan-mara'), SAMPLE());
    opened.close();

    const reopened = openIdentityDb(file);
    const after = await new SqliteMenuStore(reopened).menuOf(chan('chan-mara'));
    expect(after).toEqual(SAMPLE());
    reopened.close();
  });
});

describe('SqliteMenuStore: a malformed durable menu is surfaced loudly, never coerced', () => {
  it('halts the read rather than returning a half-built or empty menu', async () => {
    const db = openIdentityDb(':memory:');
    const store = new SqliteMenuStore(db);
    // Hand-write an offer with a blank id — a row authorMenu could never have produced.
    db.prepare('INSERT INTO menus (channel_id, offers) VALUES (?, ?)').run(
      'chan-corrupt',
      JSON.stringify([{ id: '', price: '50', effect: { kind: 'shoutout', params: { label: 'x', summary: 'y' } } }]),
    );
    await expect((async () => store.menuOf(chan('chan-corrupt')))()).rejects.toThrow(/menus\.offers/);
  });
});
