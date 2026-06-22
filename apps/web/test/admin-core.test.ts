import {
  DEFAULT_HANDLE_POLICY,
  EMPTY_BIO,
  InMemoryChannelStore,
  InMemorySanctionStore,
  StandardChannelService,
  UNVERIFIED,
  accountId,
  channelId,
  displayName,
  effectiveSanction,
  handle,
  roleSet,
  staffRoster,
  type Account,
  type Channel,
  type ChannelIdMint,
  type ChannelService,
  type Principal,
  type RoleGranter,
} from '@crowdship/identity';
import { ok, timestamp, type Result, type Timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  performIssueSanction,
  performSetVerification,
  type SanctionDeps,
  type VerifyDeps,
} from '../src/server/admin-core';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW: Timestamp = must(timestamp(1_000_000));
const STAFF = must(accountId('acct-staff'));
const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

// A channel service backed by an in-memory store, with a role granter the verify path
// never calls — verification touches neither claiming nor role grants.
const aChannel = (handleText: string): Channel => ({
  id: must(channelId(`chan-${handleText}`)),
  ownerId: must(accountId('acct-owner')),
  handle: must(handle(handleText)),
  profile: { displayName: must(displayName('Builder')), bio: EMPTY_BIO },
  verification: UNVERIFIED,
  createdAt: NOW,
});

const channelService = async (channels: readonly Channel[]): Promise<ChannelService> => {
  const store = new InMemoryChannelStore();
  for (const channel of channels) await store.insertChannel(channel);
  const ids: ChannelIdMint = { newChannelId: () => must(channelId('unused')) };
  const roles: RoleGranter = { grantRole: () => Promise.resolve(ok({} as Account)) };
  return new StandardChannelService({ clock: { now: () => NOW }, ids, roles, store, policy: DEFAULT_HANDLE_POLICY });
};

const verifyDeps = async (
  subject: Principal | null,
  staff: readonly Principal[],
  channels: readonly Channel[],
): Promise<VerifyDeps> => ({
  principal: subject,
  roster: staffRoster(staff.map((p) => p.id)),
  channels: await channelService(channels),
});

describe('performSetVerification — staff-gated channel verification', () => {
  it('refuses an anonymous request before touching any store', async () => {
    const deps = await verifyDeps(null, [], []);
    expect(await performSetVerification(deps, { handle: 'witch', status: 'verified' })).toEqual({
      kind: 'must-authenticate',
    });
  });

  it('refuses a signed-in non-staff principal — and leaks nothing about the channel', async () => {
    const stranger = principal('acct-stranger');
    const deps = await verifyDeps(stranger, [], [aChannel('witch')]);
    // The channel exists, but a non-staff caller gets the same `forbidden` whether it
    // does or not — authority is checked before the lookup.
    expect(await performSetVerification(deps, { handle: 'witch', status: 'official' })).toEqual({
      kind: 'forbidden',
    });
  });

  it('sets the tier for staff and the channel actually carries it afterward', async () => {
    const staff = { id: STAFF, roles: roleSet([]) };
    const deps = await verifyDeps(staff, [staff], [aChannel('witch')]);
    expect(await performSetVerification(deps, { handle: 'witch', status: 'official' })).toEqual({
      kind: 'set',
      handle: 'witch',
      status: 'official',
    });
    const after = await deps.channels.channelByHandle(must(handle('witch')));
    expect(after?.verification).toBe('official');
  });

  it('reports no-such-channel when staff name a handle no channel holds', async () => {
    const staff = { id: STAFF, roles: roleSet([]) };
    const deps = await verifyDeps(staff, [staff], []);
    expect(await performSetVerification(deps, { handle: 'ghost', status: 'verified' })).toEqual({
      kind: 'no-such-channel',
      handle: 'ghost',
    });
  });

  it('rejects a malformed handle and an unknown tier as distinct input faults', async () => {
    const staff = { id: STAFF, roles: roleSet([]) };
    const deps = await verifyDeps(staff, [staff], []);
    expect((await performSetVerification(deps, { handle: 'A!', status: 'verified' })).kind).toBe('invalid-handle');
    expect((await performSetVerification(deps, { handle: 'witch', status: 'gold' })).kind).toBe('invalid-status');
  });
});

const sanctionDeps = (subject: Principal | null, staff: readonly Principal[], store: InMemorySanctionStore): SanctionDeps => ({
  principal: subject,
  roster: staffRoster(staff.map((p) => p.id)),
  sanctions: store,
  now: NOW,
});

describe('performIssueSanction — staff-gated sanction authority', () => {
  it('refuses an anonymous request and records nothing', async () => {
    const store = new InMemorySanctionStore();
    const target = must(accountId('acct-target'));
    expect(
      await performIssueSanction(sanctionDeps(null, [], store), {
        account: 'acct-target',
        reason: 'spam',
        scope: 'permanent',
        days: '',
      }),
    ).toEqual({ kind: 'must-authenticate' });
    expect(await store.forAccount(target)).toEqual([]);
  });

  it('refuses a non-staff principal and records nothing', async () => {
    const store = new InMemorySanctionStore();
    const target = must(accountId('acct-target'));
    expect(
      await performIssueSanction(sanctionDeps(principal('acct-rando'), [], store), {
        account: 'acct-target',
        reason: 'spam',
        scope: 'permanent',
        days: '',
      }),
    ).toEqual({ kind: 'forbidden' });
    expect(await store.forAccount(target)).toEqual([]);
  });

  it('records a permanent ban for staff that immediately governs the account', async () => {
    const store = new InMemorySanctionStore();
    const staff = { id: STAFF, roles: roleSet([]) };
    const target = must(accountId('acct-target'));
    expect(
      await performIssueSanction(sanctionDeps(staff, [staff], store), {
        account: 'acct-target',
        reason: 'repeated abuse',
        scope: 'permanent',
        days: '',
      }),
    ).toEqual({ kind: 'sanctioned', account: 'acct-target', scope: 'permanent' });
    const governing = effectiveSanction(await store.forAccount(target), NOW);
    expect(governing?.reason).toBe('repeated abuse');
    expect(governing?.scope.kind).toBe('permanent');
  });

  it('records a timed suspension with an until instant a whole number of days out', async () => {
    const store = new InMemorySanctionStore();
    const staff = { id: STAFF, roles: roleSet([]) };
    const target = must(accountId('acct-target'));
    expect(
      (
        await performIssueSanction(sanctionDeps(staff, [staff], store), {
          account: 'acct-target',
          reason: 'cooling off',
          scope: 'until',
          days: '3',
        })
      ).kind,
    ).toBe('sanctioned');
    const governing = effectiveSanction(await store.forAccount(target), NOW);
    expect(governing?.scope).toEqual({ kind: 'until', until: NOW + 3 * 24 * 60 * 60 * 1000 });
  });

  it('trims surrounding whitespace off a pasted account id rather than barring a spaced literal', async () => {
    const store = new InMemorySanctionStore();
    const staff = { id: STAFF, roles: roleSet([]) };
    const target = must(accountId('acct-target'));
    expect(
      await performIssueSanction(sanctionDeps(staff, [staff], store), {
        account: '  acct-target  ',
        reason: 'pasted with spaces',
        scope: 'permanent',
        days: '',
      }),
    ).toEqual({ kind: 'sanctioned', account: 'acct-target', scope: 'permanent' });
    expect(effectiveSanction(await store.forAccount(target), NOW)?.reason).toBe('pasted with spaces');
  });

  it('rejects a blank account, a blank reason, and a non-positive duration distinctly', async () => {
    const store = new InMemorySanctionStore();
    const staff = { id: STAFF, roles: roleSet([]) };
    const base = { account: 'acct-target', reason: 'why', scope: 'permanent', days: '' };
    expect((await performIssueSanction(sanctionDeps(staff, [staff], store), { ...base, account: '  ' })).kind).toBe(
      'invalid-account',
    );
    expect((await performIssueSanction(sanctionDeps(staff, [staff], store), { ...base, reason: '   ' })).kind).toBe(
      'invalid-reason',
    );
    expect(
      (await performIssueSanction(sanctionDeps(staff, [staff], store), { ...base, scope: 'until', days: '0' })).kind,
    ).toBe('invalid-scope');
  });
});
