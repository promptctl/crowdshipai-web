import {
  accountId,
  handle,
  maySanction,
  maySetVerification,
  verificationStatus,
  type ChannelService,
  type Principal,
  type Sanction,
  type SanctionScope,
  type SanctionStore,
  type StaffRoster,
} from '@crowdship/identity';
import { timestamp, type Timestamp } from '@crowdship/std';

import type { SanctionResult, VerifyResult } from '../data/admin-result';

/**
 * The platform-operator actions, as PURE orchestration over already-resolved values
 * — the staff twin of `auth-edge.ts`'s `performSignUp`. Each takes the authorization
 * subject (`principal`), the authority source (`roster`), and the services it acts
 * through as plain inputs, so the decision and the effect are reproducible in a test
 * without a session, a cookie, or a framework [LAW:effects-at-boundaries]. The
 * `'use server'` edge (`admin-actions.ts`) resolves those values from the request and
 * the composition roots and hands them here.
 *
 * Authorization is checked FIRST, before input is parsed or any store is touched, and
 * it is the SAME gate the rest of identity reads [LAW:single-enforcer]: a caller
 * without authority is refused with `forbidden` having learned nothing about the
 * channel or account behind the gate, never a leak of whether the resource exists.
 */

const DAY_MILLIS = 1000 * 60 * 60 * 24;

export interface VerifyDeps {
  readonly principal: Principal | null;
  readonly roster: StaffRoster;
  readonly channels: ChannelService;
}

export interface VerifyInput {
  readonly handle: string;
  readonly status: string;
}

/**
 * Set a channel's verification tier — a platform action gated by
 * {@link maySetVerification}, never by ownership. The channel is addressed by its
 * public handle (the value staff actually hold), parsed at the trust boundary; the
 * tier is parsed against the closed status set. A `setVerification` that comes back
 * `no-such-channel` (the row vanished between lookup and write) collapses into the
 * same outcome as the lookup miss — both mean "no such channel to verify".
 */
export const performSetVerification = async (
  deps: VerifyDeps,
  input: VerifyInput,
): Promise<VerifyResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };
  if (!maySetVerification(deps.principal, deps.roster)) return { kind: 'forbidden' };

  const parsedHandle = handle(input.handle);
  if (!parsedHandle.ok) return { kind: 'invalid-handle' };
  const parsedStatus = verificationStatus(input.status);
  if (!parsedStatus.ok) return { kind: 'invalid-status' };

  const channel = await deps.channels.channelByHandle(parsedHandle.value);
  if (channel === undefined) return { kind: 'no-such-channel', handle: parsedHandle.value };

  const result = await deps.channels.setVerification(channel.id, parsedStatus.value);
  if (!result.ok) return { kind: 'no-such-channel', handle: parsedHandle.value };
  return { kind: 'set', handle: parsedHandle.value, status: parsedStatus.value };
};

export interface SanctionDeps {
  readonly principal: Principal | null;
  readonly roster: StaffRoster;
  readonly sanctions: SanctionStore;
  readonly now: Timestamp;
}

export interface SanctionInput {
  readonly account: string;
  readonly reason: string;
  readonly scope: string;
  readonly days: string;
}

/**
 * The temporal shape of a sanction, parsed from the form: a permanent bar, or a
 * suspension a whole number of days out from `now`. Pure — `now` is handed in, never
 * read here [LAW:no-ambient-temporal-coupling] — and total: any input that is not one
 * of the two valid shapes is `null`, which the caller maps to `invalid-scope` rather
 * than guessing a duration [LAW:no-silent-failure].
 */
const parseScope = (scope: string, rawDays: string, now: Timestamp): SanctionScope | null => {
  if (scope === 'permanent') return { kind: 'permanent' };
  if (scope !== 'until') return null;
  const days = Number(rawDays);
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  const until = timestamp(now + days * DAY_MILLIS);
  return until.ok ? { kind: 'until', until: until.value } : null;
};

/**
 * Impose a sanction (ban/suspension) on an account — a platform action gated by
 * {@link maySanction}, never by ownership: a builder must not unban themselves. The
 * recorded sanction immediately governs that account's conduct standing through the
 * existing enforcement read (`effectiveSanction`), so the authority and the teeth
 * meet here [LAW:single-enforcer]. The reason must be non-blank: a sanction the actor
 * and the audit trail cannot understand is a silent one [LAW:no-silent-failure].
 */
export const performIssueSanction = async (
  deps: SanctionDeps,
  input: SanctionInput,
): Promise<SanctionResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };
  if (!maySanction(deps.principal, deps.roster)) return { kind: 'forbidden' };

  // Trim the untrusted form value before parsing: an account id pasted from the
  // account page can pick up surrounding whitespace, and a minted id never contains
  // any, so trimming here can only repair a paste, never alter a real id — the same
  // edge hygiene `handle`/`reason` apply at this boundary [LAW:single-enforcer].
  const account = accountId(input.account.trim());
  if (!account.ok) return { kind: 'invalid-account' };
  const reason = input.reason.trim();
  if (reason.length === 0) return { kind: 'invalid-reason' };
  const scope = parseScope(input.scope, input.days, deps.now);
  if (scope === null) return { kind: 'invalid-scope' };

  const sanction: Sanction = { reason, issuedAt: deps.now, scope };
  await deps.sanctions.record(account.value, sanction);
  return { kind: 'sanctioned', account: account.value, scope: scope.kind };
};
