import { describe, expect, test } from 'vitest';

import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  DEFAULT_ROLES,
  EMPTY_BIO,
  ROLES,
  UNVERIFIED,
  accountId,
  channelId,
  displayName,
  email,
  handle,
  isPlatformStaff,
  mayManageChannel,
  maySetVerification,
  roleSet,
  type Account,
  type Channel,
  type Principal,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at0: Timestamp = must(timestamp(0));

const anAccount = (id: string): Account => ({
  id: must(accountId(id)),
  email: must(email(`${id}@example.com`)),
  createdAt: at0,
  roles: DEFAULT_ROLES,
});

const aChannelOwnedBy = (ownerId: string): Channel => ({
  id: must(channelId('chan-1')),
  ownerId: must(accountId(ownerId)),
  handle: must(handle('builderhandle')),
  profile: { displayName: must(displayName('Builder')), bio: EMPTY_BIO },
  verification: UNVERIFIED,
  createdAt: at0,
});

const withEveryCapability = (id: string): Principal => ({
  id: must(accountId(id)),
  roles: roleSet([...ROLES]),
});

describe('mayManageChannel authorizes by ownership, never by role', () => {
  test('the owner may manage their own channel', () => {
    const owner = anAccount('acct-owner');
    expect(mayManageChannel(owner, aChannelOwnedBy('acct-owner'))).toBe(true);
  });

  test('a non-owner may NOT — even holding every capability there is', () => {
    const stranger = withEveryCapability('acct-stranger');
    expect(mayManageChannel(stranger, aChannelOwnedBy('acct-owner'))).toBe(false);
  });

  test('a full Account is structurally a Principal (no adapter needed)', () => {
    const owner = anAccount('acct-owner');
    expect(mayManageChannel(owner, aChannelOwnedBy('acct-owner'))).toBe(true);
  });
});

describe('platform authority is held by no one yet — and never by ownership', () => {
  test('no principal is platform staff, regardless of capabilities held', () => {
    expect(isPlatformStaff(withEveryCapability('acct-max'))).toBe(false);
    expect(isPlatformStaff({ id: must(accountId('acct-min')), roles: roleSet([]) })).toBe(false);
  });

  test('maySetVerification is staff-only: the channel owner cannot self-verify', () => {
    // maySetVerification takes NO channel — there is no argument through which
    // ownership could authorize it, which is exactly the impersonation guard. So
    // even the would-be owner is denied while staff authority is held by no one.
    expect(maySetVerification(anAccount('acct-owner'))).toBe(false);
  });
});
