import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { DatabaseSync } from '@crowdship/node-std';
import type { Result } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  DEFAULT_HANDLE_POLICY,
  StandardAuthService,
  StandardChannelService,
  UNVERIFIED,
  accountId,
  bio,
  channelId,
  displayName,
  email,
  handle,
  hasRole,
  secret,
  type AccountId,
  type ChannelProfile,
  type Email,
  type RecoveryDelivery,
  type RecoveryToken,
} from '@crowdship/identity';
import {
  CryptoIdMint,
  CryptoSecretMint,
  SqliteAuthStore,
  SqliteChannelStore,
  SqliteCredentialStore,
  SystemClock,
  openIdentityDb,
  type ScryptParams,
} from '../src/index.js';

/** Low-cost scrypt for fast tests — the security of the default params is exercised elsewhere. */
const FAST: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const aProfile = (name: string, blurb = ''): ChannelProfile => ({
  displayName: must(displayName(name)),
  bio: must(bio(blurb)),
});

class NoopDelivery implements RecoveryDelivery {
  readonly delivered: Array<{ readonly email: Email; readonly token: RecoveryToken }> = [];
  deliver(to: Email, token: RecoveryToken): Promise<void> {
    this.delivered.push({ email: to, token });
    return Promise.resolve();
  }
}

/**
 * The durable seam composes: the channel service over the SQLite channel store,
 * granting roles through the real SQLite-backed auth service. Both services share
 * one database handle, so a claim's channel insert and its builder-role grant land
 * in the same file.
 */
const build = () => {
  const db = openIdentityDb(':memory:');
  const mint = new CryptoIdMint();
  const auth = new StandardAuthService({
    clock: new SystemClock(),
    ids: mint,
    secrets: new CryptoSecretMint(),
    credentials: new SqliteCredentialStore(db, FAST),
    delivery: new NoopDelivery(),
    store: new SqliteAuthStore(db),
    sessionTtlMillis: 60_000,
    recoveryTtlMillis: 30_000,
  });
  const channels = new StandardChannelService({
    clock: new SystemClock(),
    ids: mint,
    roles: auth,
    store: new SqliteChannelStore(db),
    policy: DEFAULT_HANDLE_POLICY,
  });
  return { db, auth, channels };
};

const aBacker = async (auth: StandardAuthService, address: string): Promise<AccountId> => {
  const created = must(await auth.signUp(must(email(address)), must(secret('a real password'))));
  return created.id;
};

describe('SqliteChannelStore: claiming a channel persists it and grants builder durably', () => {
  test('a claim round-trips through SQLite and survives across store instances', async () => {
    const { db, auth, channels } = build();
    const owner = await aBacker(auth, 'builder@crowdship.dev');
    const claim = must(
      await channels.claimChannel(owner, must(handle('brandon')), aProfile('Brandon', 'building live')),
    );
    expect(hasRole(claim.account.roles, 'builder')).toBe(true);

    // A second channel store over the SAME handle has no in-process state — if it
    // reads the channel back, it came from the database, not memory.
    const reread = new SqliteChannelStore(db);
    expect(await reread.channelById(claim.channel.id)).toEqual(claim.channel);
    expect(await reread.channelByHandle(must(handle('brandon')))).toEqual(claim.channel);
    expect(await reread.channelByOwner(owner)).toEqual(claim.channel);

    // The builder capability is on the account in the durable account store too.
    const account = await new SqliteAuthStore(db).accountById(owner);
    expect(account?.roles).toEqual(['backer', 'builder']);
  });

  test('handle uniqueness and one-per-account hold over the durable store', async () => {
    const { auth, channels } = build();
    const a = await aBacker(auth, 'a@crowdship.dev');
    const b = await aBacker(auth, 'b@crowdship.dev');
    must(await channels.claimChannel(a, must(handle('shared')), aProfile('A')));

    expect(await channels.claimChannel(b, must(handle('shared')), aProfile('B'))).toEqual({
      ok: false,
      error: { kind: 'handle-taken' },
    });
    expect(await channels.claimChannel(a, must(handle('another')), aProfile('A2'))).toEqual({
      ok: false,
      error: { kind: 'already-has-channel' },
    });
  });

  test('rename and profile edit persist; the stable id never moves', async () => {
    const { db, auth, channels } = build();
    const owner = await aBacker(auth, 'rename@crowdship.dev');
    const claim = must(await channels.claimChannel(owner, must(handle('before')), aProfile('Name')));

    must(await channels.rename(claim.channel.id, must(handle('after'))));
    const nextProfile = aProfile('New Name', 'updated blurb');
    must(await channels.editProfile(claim.channel.id, nextProfile));

    const reread = new SqliteChannelStore(db);
    const got = await reread.channelById(claim.channel.id);
    expect(got?.id).toBe(claim.channel.id);
    expect(got?.handle).toBe(must(handle('after')));
    expect(got?.profile).toEqual(nextProfile);
    expect(await reread.channelByHandle(must(handle('before')))).toBeUndefined();
  });

  test('allChannels reads back every claimed channel from disk — the roster read', async () => {
    const { db, auth, channels } = build();
    const a = await aBacker(auth, 'one@crowdship.dev');
    const b = await aBacker(auth, 'two@crowdship.dev');
    const first = must(await channels.claimChannel(a, must(handle('builder_one')), aProfile('One', 'first')));
    const second = must(await channels.claimChannel(b, must(handle('builder_two')), aProfile('Two')));

    // A fresh store with no in-process state reads both channels from the database,
    // each rebuilt through the same trust boundary a single lookup uses.
    const reread = new SqliteChannelStore(db);
    const all = await reread.allChannels();
    expect(new Set(all)).toEqual(new Set([first.channel, second.channel]));

    // An empty table is an empty roster, not an error.
    expect(await new SqliteChannelStore(openIdentityDb(':memory:')).allChannels()).toEqual([]);
  });

  test('a channel with an empty bio round-trips', async () => {
    const { db, auth, channels } = build();
    const owner = await aBacker(auth, 'nobio@crowdship.dev');
    const claim = must(await channels.claimChannel(owner, must(handle('nobio')), aProfile('No Bio')));
    const got = await new SqliteChannelStore(db).channelById(claim.channel.id);
    expect(got?.profile.bio).toBe('');
  });

  test('verification defaults to none on claim and a set status persists durably', async () => {
    const { db, auth, channels } = build();
    const owner = await aBacker(auth, 'verify@crowdship.dev');
    const claim = must(await channels.claimChannel(owner, must(handle('toverify')), aProfile('To Verify')));
    // A fresh claim is unverified, and that reads back from the database.
    expect(claim.channel.verification).toBe('none');
    expect((await new SqliteChannelStore(db).channelById(claim.channel.id))?.verification).toBe('none');

    must(await channels.setVerification(claim.channel.id, 'official'));
    // A second store with no in-process state reads the affirmed tier from disk.
    expect((await new SqliteChannelStore(db).channelById(claim.channel.id))?.verification).toBe('official');

    must(await channels.setVerification(claim.channel.id, 'none'));
    expect((await new SqliteChannelStore(db).channelById(claim.channel.id))?.verification).toBe('none');
  });

  test('the durable claim path also rejects a reserved handle, minting nothing', async () => {
    const { db, auth, channels } = build();
    const owner = await aBacker(auth, 'imposter@crowdship.dev');
    expect(await channels.claimChannel(owner, must(handle('admin')), aProfile('Imposter'))).toEqual({
      ok: false,
      error: { kind: 'handle-reserved', reservation: { kind: 'reserved-word', word: 'admin' } },
    });
    expect(await new SqliteChannelStore(db).channelByOwner(owner)).toBeUndefined();
  });

  test('the UNIQUE backstops throw loudly on a duplicate handle or owner, never overwrite', async () => {
    // The service pre-checks free handle / one-per-account, so these backstops fire
    // only if two writers raced past those checks. They must be LOUD, not silent
    // [LAW:no-silent-failure] — proven here by inserting straight into the store.
    const db = openIdentityDb(':memory:');
    const store = new SqliteChannelStore(db);
    const mint = new CryptoIdMint();
    const base = {
      ownerId: must(accountId('owner-a')),
      handle: must(handle('taken')),
      profile: aProfile('A'),
      verification: UNVERIFIED,
      createdAt: must(timestamp(1)),
    };
    await store.insertChannel({ id: mint.newChannelId(), ...base });

    // The store rejects (its INSERT throws synchronously on the constraint; the
    // async thunk turns that into the rejection `claimChannel`'s `await` sees).
    // Same handle, different id and owner → UNIQUE(handle).
    await expect(
      (async () =>
        store.insertChannel({ id: mint.newChannelId(), ...base, ownerId: must(accountId('owner-b')) }))(),
    ).rejects.toThrow(/UNIQUE/);
    // Same owner, different id and handle → UNIQUE(owner_id).
    await expect(
      (async () => store.insertChannel({ id: mint.newChannelId(), ...base, handle: must(handle('different')) }))(),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('the verification column migrates onto a pre-bb2.4 channels table', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('an old database lacking the column gets it, and legacy rows read as unverified', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crowdship-mig-'));
    const file = join(dir, 'identity.db');

    // Stand up a database with the EXACT pre-bb2.4 channels schema — no
    // verification column — and seed one legacy channel row.
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE channels (
        id           TEXT    PRIMARY KEY,
        owner_id     TEXT    NOT NULL UNIQUE,
        handle       TEXT    NOT NULL UNIQUE,
        display_name TEXT    NOT NULL,
        bio          TEXT    NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL
      );
    `);
    legacy
      .prepare('INSERT INTO channels (id, owner_id, handle, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('chan-legacy', 'owner-legacy', 'legacy', 'Legacy Builder', 1);
    legacy.close();

    // Reopen through the real opener: the migration runs and adds the column,
    // never silently leaving reads to fail [LAW:no-silent-failure].
    const db = openIdentityDb(file);
    const reread = new SqliteChannelStore(db);
    const got = await reread.channelById(must(channelId('chan-legacy')));
    expect(got?.handle).toBe(must(handle('legacy')));
    // The legacy row takes the column default — the honest "no trust signal",
    // never a guessed badge.
    expect(got?.verification).toBe('none');

    // The migration is idempotent: opening the already-migrated file again is fine.
    openIdentityDb(file);
    expect((await new SqliteChannelStore(db).channelById(must(channelId('chan-legacy'))))?.verification).toBe(
      'none',
    );
  });
});
