import type { Clock, Result } from '@crowdship/std';
import { ok, timestamp } from '@crowdship/std';
import {
  DEFAULT_HANDLE_POLICY,
  InMemoryChannelStore,
  NO_ROLES,
  StandardChannelService,
  accountId,
  channelId,
  email,
  handle,
  type Account,
  type AccountId,
  type ChannelId,
  type ChannelIdMint,
  type ChannelService,
  type Principal,
  type Role,
  type RoleChangeError,
} from '@crowdship/identity';
import { describe, expect, it } from 'vitest';

import { performClaim, type ClaimDeps } from '../src/server/claim-core';

/** Unwrap a constructor result or fail loudly — a blank/bad test input is a broken test,
 *  never a silent skip [LAW:no-silent-failure]. */
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

/**
 * A {@link RoleGranter} that records every grant and hands back a real-shaped account —
 * so a test can assert "claiming grants the builder capability" against the actual call
 * the channel service makes [LAW:behavior-not-structure]. The role write path itself is
 * exhaustively covered in the identity package's own tests; here we only verify the claim
 * core's orchestration drives it.
 */
class RecordingRoleGranter {
  readonly granted: Array<{ readonly accountId: AccountId; readonly role: Role }> = [];
  grantRole(id: AccountId, role: Role): Promise<Result<Account, RoleChangeError>> {
    this.granted.push({ accountId: id, role });
    const account: Account = {
      id,
      email: must(email('builder@example.com')),
      createdAt: fixedClock.now(),
      roles: NO_ROLES,
    };
    return Promise.resolve(ok(account));
  }
}

/** A real channel service over an in-memory store — the same code path the SQLite store
 *  runs, so the claim rules (uniqueness, reserved handles, one-channel-per-owner) are
 *  exercised for real, not stubbed [LAW:behavior-not-structure]. */
const makeHarness = () => {
  const roles = new RecordingRoleGranter();
  const channels: ChannelService = new StandardChannelService({
    clock: fixedClock,
    ids: new CountingChannelMint(),
    roles,
    store: new InMemoryChannelStore(),
    policy: DEFAULT_HANDLE_POLICY,
  });
  return { roles, channels };
};

const aPrincipal = (id: string): Principal => ({ id: must(accountId(id)), roles: NO_ROLES });

/** Bind the claim capability to the real service — what the `'use server'` edge does. */
const depsFor = (channels: ChannelService, principal: Principal | null): ClaimDeps => ({
  principal,
  claim: (ownerId, h, profile) => channels.claimChannel(ownerId, h, profile),
});

describe('performClaim — a signed-in account claims a channel [identity-bb2.7]', () => {
  it('refuses an unauthenticated claim and never touches the store', async () => {
    const { channels } = makeHarness();
    const result = await performClaim(depsFor(channels, null), {
      handle: 'ffmpeg_witch',
      displayName: 'FFmpeg Witch',
    });
    expect(result).toEqual({ kind: 'must-authenticate' });
    // No channel was created for the (absent) actor.
    expect(await channels.channelByHandle(must(handle('ffmpeg_witch')))).toBeUndefined();
  });

  it('claims an available handle: the channel resolves by handle to the OWNER, and the builder role is granted', async () => {
    const { channels, roles } = makeHarness();
    const principal = aPrincipal('acc-owner');

    const result = await performClaim(depsFor(channels, principal), {
      handle: 'FFmpeg_Witch',
      displayName: '  FFmpeg Witch  ',
    });

    // Success carries the canonicalized handle (trimmed + lowercased at the boundary).
    expect(result).toEqual({ kind: 'claimed', handle: 'ffmpeg_witch' });

    const claimed = await channels.channelByHandle(must(handle('ffmpeg_witch')));
    expect(claimed).toBeDefined();
    // The channel binds to the PRINCIPAL's id — never a form value [LAW:single-enforcer].
    expect(claimed?.ownerId).toEqual(principal.id);
    expect(claimed?.profile.displayName).toBe('FFmpeg Witch');
    // It is retrievable by owner — the lookup go-live depends on.
    expect((await channels.channelByOwner(principal.id))?.handle).toBe('ffmpeg_witch');
    // Claiming granted the builder capability through the real role write path.
    expect(roles.granted).toEqual([{ accountId: principal.id, role: 'builder' }]);
  });

  it('binds the channel to the acting principal even if a stray owner field is smuggled in the form', async () => {
    // ClaimInput has no owner field, so this is belt-and-suspenders: the core reads the
    // owner from the principal, so an attacker-supplied field is structurally ignored.
    const { channels } = makeHarness();
    const principal = aPrincipal('acc-real');
    await performClaim(
      depsFor(channels, principal),
      { handle: 'realone', displayName: 'Real One', ownerId: 'acc-victim' } as never,
    );
    expect((await channels.channelByHandle(must(handle('realone'))))?.ownerId).toEqual(principal.id);
  });

  it('refuses a handle already taken by another account', async () => {
    const { channels } = makeHarness();
    await performClaim(depsFor(channels, aPrincipal('acc-first')), {
      handle: 'taken',
      displayName: 'First',
    });
    const result = await performClaim(depsFor(channels, aPrincipal('acc-second')), {
      handle: 'taken',
      displayName: 'Second',
    });
    expect(result).toEqual({ kind: 'handle-taken' });
  });

  it('refuses a second channel for an owner who already has one', async () => {
    const { channels } = makeHarness();
    const principal = aPrincipal('acc-owner');
    await performClaim(depsFor(channels, principal), { handle: 'first', displayName: 'First' });
    const result = await performClaim(depsFor(channels, principal), {
      handle: 'second',
      displayName: 'Second',
    });
    expect(result).toEqual({ kind: 'already-has-channel' });
  });

  it('refuses a reserved authority handle, carrying the reservation reason', async () => {
    const { channels } = makeHarness();
    const result = await performClaim(depsFor(channels, aPrincipal('acc-imposter')), {
      handle: 'admin',
      displayName: 'Imposter',
    });
    expect(result.kind).toBe('handle-reserved');
  });

  it('reports a malformed handle with its specific reason and never attempts the claim', async () => {
    const { channels, roles } = makeHarness();
    const result = await performClaim(depsFor(channels, aPrincipal('acc-owner')), {
      handle: '9lives',
      displayName: 'Nine Lives',
    });
    expect(result).toEqual({ kind: 'invalid-handle', error: { kind: 'malformed', value: '9lives' } });
    expect(roles.granted).toEqual([]);
  });

  it('reports a blank display name and never attempts the claim', async () => {
    const { channels, roles } = makeHarness();
    const result = await performClaim(depsFor(channels, aPrincipal('acc-owner')), {
      handle: 'goodhandle',
      displayName: '   ',
    });
    expect(result).toEqual({ kind: 'invalid-display-name', error: { kind: 'blank' } });
    expect(roles.granted).toEqual([]);
  });
});
