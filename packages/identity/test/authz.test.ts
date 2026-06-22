import { describe, expect, test } from 'vitest';

import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  DEFAULT_ROLES,
  EMPTY_BIO,
  EMPTY_ROSTER,
  ROLES,
  UNVERIFIED,
  accountId,
  channelId,
  displayName,
  email,
  handle,
  isPlatformStaff,
  mayManageChannel,
  maySanction,
  maySetVerification,
  roleSet,
  staffRoster,
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

describe('platform authority is the roster, a separate axis from roles', () => {
  test('the empty roster designates no one — even an account holding every capability', () => {
    expect(isPlatformStaff(withEveryCapability('acct-max'), EMPTY_ROSTER)).toBe(false);
    expect(isPlatformStaff({ id: must(accountId('acct-min')), roles: roleSet([]) }, EMPTY_ROSTER)).toBe(false);
  });

  test('a roster designates exactly the listed accounts and no others', () => {
    const roster = staffRoster([must(accountId('acct-staff'))]);
    expect(isPlatformStaff({ id: must(accountId('acct-staff')), roles: roleSet([]) }, roster)).toBe(true);
    expect(isPlatformStaff({ id: must(accountId('acct-other')), roles: roleSet([]) }, roster)).toBe(false);
  });

  test('staff is not a role: holding every capability does NOT confer authority — only the roster does', () => {
    const roster = staffRoster([must(accountId('acct-staff'))]);
    // An account with every participant capability but absent from the roster is denied;
    // an account with NO capabilities but on the roster is staff. Authority tracks the
    // roster, never the role set [LAW:decomposition].
    expect(isPlatformStaff(withEveryCapability('acct-powerful'), roster)).toBe(false);
    expect(isPlatformStaff({ id: must(accountId('acct-staff')), roles: roleSet([]) }, roster)).toBe(true);
  });

  test('every staff-gated decision reads the one roster — verify a channel, sanction an account', () => {
    const roster = staffRoster([must(accountId('acct-staff'))]);
    const staff: Principal = { id: must(accountId('acct-staff')), roles: roleSet([]) };
    const owner = anAccount('acct-owner');
    // The would-be channel owner is denied both gates (neither takes a channel — there is
    // no argument through which ownership could authorize), while staff is granted both.
    expect(maySetVerification(owner, roster)).toBe(false);
    expect(maySanction(owner, roster)).toBe(false);
    expect(maySetVerification(staff, roster)).toBe(true);
    expect(maySanction(staff, roster)).toBe(true);
  });
});
