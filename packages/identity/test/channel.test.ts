import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  DEFAULT_HANDLE_POLICY,
  EMPTY_BIO,
  InMemoryAuthService,
  InMemoryChannelStore,
  StandardChannelService,
  UNVERIFIED,
  accountId,
  bio,
  channelId,
  displayName,
  email,
  handle,
  hasRole,
  recoveryToken,
  secret,
  sessionId,
  sessionToken,
  type AccountId,
  type Channel,
  type ChannelId,
  type ChannelProfile,
  type ChannelStore,
  type CredentialStore,
  type Email,
  type Handle,
  type IdMint,
  type RecoveryDelivery,
  type RecoveryToken,
  type Secret,
  type SecretMint,
  type SessionId,
  type VerificationStatus,
  type SessionToken,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const aHandle = (s: string): Handle => must(handle(s));
const aProfile = (name: string, blurb = ''): ChannelProfile => ({
  displayName: must(displayName(name)),
  bio: blurb === '' ? EMPTY_BIO : must(bio(blurb)),
});

class TestClock implements Clock {
  #at: Timestamp;
  constructor(start = 0) {
    this.#at = must(timestamp(start));
  }
  now(): Timestamp {
    return this.#at;
  }
  advance(millis: number): void {
    this.#at = must(timestamp(this.#at + millis));
  }
}

/** Monotonic mints — unique by construction. Mints account, session, channel ids and bearer tokens. */
class CountingMint implements IdMint, SecretMint {
  #n = 0;
  newAccountId(): AccountId {
    return must(accountId(`acc-${this.#n++}`));
  }
  newSessionId(): SessionId {
    return must(sessionId(`sess-${this.#n++}`));
  }
  newChannelId(): ChannelId {
    return must(channelId(`chan-${this.#n++}`));
  }
  newSessionToken(): SessionToken {
    return must(sessionToken(`stok-${this.#n++}`));
  }
  newRecoveryToken(): RecoveryToken {
    return must(recoveryToken(`rtok-${this.#n++}`));
  }
}

class PlaintextCredentials implements CredentialStore {
  readonly #byAccount = new Map<AccountId, Secret>();
  set(id: AccountId, s: Secret): Promise<void> {
    this.#byAccount.set(id, s);
    return Promise.resolve();
  }
  verify(id: AccountId, s: Secret): Promise<boolean> {
    return Promise.resolve(this.#byAccount.get(id) === s);
  }
  clear(id: AccountId): Promise<void> {
    this.#byAccount.delete(id);
    return Promise.resolve();
  }
}

class NoopDelivery implements RecoveryDelivery {
  deliver(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A harness wiring the channel service to a real {@link InMemoryAuthService} as
 * its {@link RoleGranter} — so "claiming a channel grants the builder capability"
 * is tested against the actual role write path, not a fake that always says yes.
 */
const makeHarness = () => {
  const clock = new TestClock();
  const mint = new CountingMint();
  const auth = new InMemoryAuthService({
    clock,
    ids: mint,
    secrets: mint,
    credentials: new PlaintextCredentials(),
    delivery: new NoopDelivery(),
    sessionTtlMillis: 60_000,
    recoveryTtlMillis: 30_000,
  });
  const channels = new StandardChannelService({
    clock,
    ids: mint,
    roles: auth,
    store: new InMemoryChannelStore(),
    policy: DEFAULT_HANDLE_POLICY,
  });
  return { auth, channels };
};

/** Sign up a backer account and return its id — the precondition for claiming a channel. */
const aBacker = async (auth: InMemoryAuthService, address: string): Promise<AccountId> => {
  const created = must(await auth.signUp(must(email(address)), must(secret('pw'))));
  return created.id;
};

describe('handle constructor (the trust boundary)', () => {
  test('canonicalizes to trimmed lowercase', () => {
    expect(must(handle('  Brandon_42 '))).toBe('brandon_42');
  });

  test('the same handle in any casing is one value [LAW:one-source-of-truth]', () => {
    expect(must(handle('Builder'))).toBe(must(handle('builder')));
  });

  test.each([
    ['', { kind: 'blank' }],
    ['  ', { kind: 'blank' }],
    ['ab', { kind: 'too-short', min: 3 }],
    ['a'.repeat(31), { kind: 'too-long', max: 30 }],
    ['9lives', { kind: 'malformed', value: '9lives' }],
    ['_leading', { kind: 'malformed', value: '_leading' }],
    ['has space', { kind: 'malformed', value: 'has space' }],
    ['dot.dot', { kind: 'malformed', value: 'dot.dot' }],
    ['emoji😀x', { kind: 'malformed', value: 'emoji😀x' }],
  ])('rejects %j with the most specific reason', (raw, expected) => {
    const r = handle(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual(expected);
  });

  test('property: any well-shaped handle round-trips canonical and is idempotent', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9_]{2,29}$/), (raw) => {
        const once = must(handle(raw));
        expect(must(handle(once))).toBe(once);
        // Uppercasing the same characters lands on the identical canonical value.
        expect(must(handle(raw.toUpperCase()))).toBe(once);
      }),
    );
  });
});

describe('displayName and bio constructors', () => {
  test('displayName trims and rejects blank / over-long', () => {
    expect(must(displayName('  Brandon F.  '))).toBe('Brandon F.');
    expect(displayName('   ').ok).toBe(false);
    expect(displayName('x'.repeat(51))).toEqual({ ok: false, error: { kind: 'too-long', max: 50 } });
  });

  test('bio may be empty (a fresh channel has none) and is bounded', () => {
    expect(EMPTY_BIO).toBe('');
    expect(must(bio('  hello  '))).toBe('hello');
    expect(bio('x'.repeat(501))).toEqual({ ok: false, error: { kind: 'too-long', max: 500 } });
  });
});

describe('claiming a channel is what grants the builder capability', () => {
  test('a claim grants builder and the channel is retrievable three ways', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));

    // The returned account already holds the capability — claiming a channel is
    // what made this account a builder.
    expect(hasRole(claim.account.roles, 'builder')).toBe(true);

    const byId = await channels.channelById(claim.channel.id);
    const byHandle = await channels.channelByHandle(aHandle('brandon'));
    const byOwner = await channels.channelByOwner(owner);
    expect(byId).toEqual(claim.channel);
    expect(byHandle).toEqual(claim.channel);
    expect(byOwner).toEqual(claim.channel);
  });

  test('a handle is unique — and case-insensitively so', async () => {
    const { auth, channels } = makeHarness();
    const a = await aBacker(auth, 'a@ex.com');
    const b = await aBacker(auth, 'b@ex.com');
    must(await channels.claimChannel(a, aHandle('Taken'), aProfile('A')));
    // 'taken' canonicalizes to the same handle 'Taken' did.
    const collision = await channels.claimChannel(b, aHandle('taken'), aProfile('B'));
    expect(collision).toEqual({ ok: false, error: { kind: 'handle-taken' } });
  });

  test('one channel per account, for now', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    must(await channels.claimChannel(owner, aHandle('first'), aProfile('First')));
    const again = await channels.claimChannel(owner, aHandle('second'), aProfile('Second'));
    expect(again).toEqual({ ok: false, error: { kind: 'already-has-channel' } });
  });

  test('claiming for an account that does not exist is a named failure, not an orphan channel', async () => {
    const { channels } = makeHarness();
    const ghost = must(accountId('no-such-account'));
    const r = await channels.claimChannel(ghost, aHandle('ghost'), aProfile('Ghost'));
    expect(r).toEqual({ ok: false, error: { kind: 'no-such-account' } });
    // Nothing was minted for the ghost.
    expect(await channels.channelByHandle(aHandle('ghost'))).toBeUndefined();
    expect(await channels.channelByOwner(ghost)).toBeUndefined();
  });
});

describe('rename keeps the stable id, frees the old handle, guards the new', () => {
  test('a rename changes the handle but not the id, and the old handle is reusable', async () => {
    const { auth, channels } = makeHarness();
    const a = await aBacker(auth, 'a@ex.com');
    const b = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(a, aHandle('old'), aProfile('A')));

    const renamed = must(await channels.rename(claim.channel.id, aHandle('new')));
    expect(renamed.id).toBe(claim.channel.id);
    expect(renamed.handle).toBe(aHandle('new'));
    expect(await channels.channelByHandle(aHandle('new'))).toEqual(renamed);
    expect(await channels.channelByHandle(aHandle('old'))).toBeUndefined();

    // The vacated handle can now be claimed by someone else.
    expect((await channels.claimChannel(b, aHandle('old'), aProfile('B'))).ok).toBe(true);
  });

  test('renaming to a handle another channel holds is taken; to your own is an idempotent no-op', async () => {
    const { auth, channels } = makeHarness();
    const a = await aBacker(auth, 'a@ex.com');
    const b = await aBacker(auth, 'b@ex.com');
    const ca = must(await channels.claimChannel(a, aHandle('alice'), aProfile('A')));
    must(await channels.claimChannel(b, aHandle('bob'), aProfile('B')));

    expect(await channels.rename(ca.channel.id, aHandle('bob'))).toEqual({
      ok: false,
      error: { kind: 'handle-taken' },
    });
    // Renaming to the handle you already hold succeeds and changes nothing.
    expect(must(await channels.rename(ca.channel.id, aHandle('alice')))).toEqual(ca.channel);
  });

  test('renaming a channel that does not exist is a named failure', async () => {
    const { channels } = makeHarness();
    expect(await channels.rename(must(channelId('nope')), aHandle('whoever'))).toEqual({
      ok: false,
      error: { kind: 'no-such-channel' },
    });
  });
});

describe('editProfile replaces the public face', () => {
  test('a profile edit is reflected on the next read', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));

    const next = aProfile('Brandon F.', 'building crowdship live');
    const edited = must(await channels.editProfile(claim.channel.id, next));
    expect(edited.profile).toEqual(next);
    expect((await channels.channelById(claim.channel.id))?.profile).toEqual(next);
  });

  test('editing a channel that does not exist is a named failure', async () => {
    const { channels } = makeHarness();
    expect(await channels.editProfile(must(channelId('nope')), aProfile('X'))).toEqual({
      ok: false,
      error: { kind: 'no-such-channel' },
    });
  });
});

describe('the impersonation policy gates claim and rename at the one handle seam', () => {
  test('claiming a reserved authority handle is a named failure, and nothing is minted or granted', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const r = await channels.claimChannel(owner, aHandle('admin'), aProfile('Imposter'));
    expect(r).toEqual({
      ok: false,
      error: { kind: 'handle-reserved', reservation: { kind: 'reserved-word', word: 'admin' } },
    });
    // The reserved check precedes the role grant, so a rejected claim leaves no residue.
    const grant = must(await auth.logIn(must(email('b@ex.com')), must(secret('pw'))));
    expect(hasRole(grant.account.roles, 'builder')).toBe(false);
    expect(await channels.channelByOwner(owner)).toBeUndefined();
  });

  test('claiming a brand-impersonation handle is a named failure', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    expect(await channels.claimChannel(owner, aHandle('crowdship_official'), aProfile('Fake'))).toEqual({
      ok: false,
      error: { kind: 'handle-reserved', reservation: { kind: 'brand-impersonation', brand: 'crowdship' } },
    });
  });

  test('a reserved handle cannot be slipped in through a later rename', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('honest'), aProfile('Honest')));
    expect(await channels.rename(claim.channel.id, aHandle('support'))).toEqual({
      ok: false,
      error: { kind: 'handle-reserved', reservation: { kind: 'reserved-word', word: 'support' } },
    });
    // The original handle is untouched by the rejected rename.
    expect((await channels.channelById(claim.channel.id))?.handle).toBe(aHandle('honest'));
  });
});

describe('platform verification is a sibling to the builder-owned profile', () => {
  test('a freshly claimed channel carries no trust signal', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));
    expect(claim.channel.verification).toBe(UNVERIFIED);
    expect((await channels.channelById(claim.channel.id))?.verification).toBe('none');
  });

  test('setVerification affirms a tier and revoking is setting it back to none', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));

    const verified = must(await channels.setVerification(claim.channel.id, 'verified'));
    expect(verified.verification).toBe('verified');
    expect((await channels.channelById(claim.channel.id))?.verification).toBe('verified');

    const promoted = must(await channels.setVerification(claim.channel.id, 'official'));
    expect(promoted.verification).toBe('official');

    // Revoking is just setting the status back to 'none' — one method, the status
    // is the value [LAW:dataflow-not-control-flow].
    const revoked = must(await channels.setVerification(claim.channel.id, 'none'));
    expect(revoked.verification).toBe('none');
    expect((await channels.channelById(claim.channel.id))?.verification).toBe('none');
  });

  test('verification is untouched by a profile edit (different owner, different write)', async () => {
    const { auth, channels } = makeHarness();
    const owner = await aBacker(auth, 'b@ex.com');
    const claim = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));
    must(await channels.setVerification(claim.channel.id, 'official'));

    must(await channels.editProfile(claim.channel.id, aProfile('Brandon F.', 'new blurb')));
    expect((await channels.channelById(claim.channel.id))?.verification).toBe('official');
  });

  test('setting verification on a channel that does not exist is a named failure', async () => {
    const { channels } = makeHarness();
    expect(await channels.setVerification(must(channelId('nope')), 'verified')).toEqual({
      ok: false,
      error: { kind: 'no-such-channel' },
    });
  });
});

/**
 * A channel store whose first {@link insertChannel} throws, then behaves normally
 * — standing in for the durable store's loud UNIQUE backstop (or any IO error)
 * firing mid-claim. Everything else delegates to a real in-memory store, so the
 * lookups a retried claim makes are honest.
 */
class FailFirstInsertStore implements ChannelStore {
  readonly #inner = new InMemoryChannelStore();
  #failed = false;
  insertChannel(channel: Channel): Promise<void> {
    if (!this.#failed) {
      this.#failed = true;
      return Promise.reject(new Error('store: simulated insert failure'));
    }
    return this.#inner.insertChannel(channel);
  }
  channelById(id: ChannelId): Promise<Channel | undefined> {
    return this.#inner.channelById(id);
  }
  channelByHandle(value: Handle): Promise<Channel | undefined> {
    return this.#inner.channelByHandle(value);
  }
  channelByOwner(ownerId: AccountId): Promise<Channel | undefined> {
    return this.#inner.channelByOwner(ownerId);
  }
  updateHandle(id: ChannelId, value: Handle): Promise<void> {
    return this.#inner.updateHandle(id, value);
  }
  updateProfile(id: ChannelId, profile: ChannelProfile): Promise<void> {
    return this.#inner.updateProfile(id, profile);
  }
  updateVerification(id: ChannelId, status: VerificationStatus): Promise<void> {
    return this.#inner.updateVerification(id, status);
  }
}

describe('a claim whose channel insert fails leaves only a benign, self-healing residue', () => {
  test('grant-first ordering: the residue is a capability with no channel, recovered by a retried claim', async () => {
    const clock = new TestClock();
    const mint = new CountingMint();
    const auth = new InMemoryAuthService({
      clock,
      ids: mint,
      secrets: mint,
      credentials: new PlaintextCredentials(),
      delivery: new NoopDelivery(),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });
    const channels = new StandardChannelService({
      clock,
      ids: mint,
      roles: auth,
      store: new FailFirstInsertStore(),
      policy: DEFAULT_HANDLE_POLICY,
    });
    const owner = await aBacker(auth, 'b@ex.com');

    // The insert throws; the claim propagates it (store IO failure is exceptional,
    // not a domain Result). The role grant already committed.
    await expect(channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon'))).rejects.toThrow();

    // The residue: the account holds builder (granted), but no channel exists.
    // Inert — the capability does nothing without a channel — never the harmful
    // inverse (a channel whose owner lacks the capability).
    const grant = must(await auth.logIn(must(email('b@ex.com')), must(secret('pw'))));
    expect(hasRole(grant.account.roles, 'builder')).toBe(true);
    expect(await channels.channelByOwner(owner)).toBeUndefined();

    // Self-heal: a retried claim re-grants idempotently and the insert now lands.
    const healed = must(await channels.claimChannel(owner, aHandle('brandon'), aProfile('Brandon')));
    expect(healed.channel.ownerId).toBe(owner);
    expect((await channels.channelByOwner(owner))?.id).toBe(healed.channel.id);
    expect(await channels.channelByHandle(aHandle('brandon'))).toEqual(healed.channel);
  });
});
