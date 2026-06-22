'use server';

import { SystemClock } from '@crowdship/identity-node';

import type { SanctionResult, VerifyResult } from '../data/admin-result';
import {
  performIssueSanction,
  performSetVerification,
} from './admin-core';
import { getChannelService } from './channels';
import { currentPrincipal } from './principal';
import { getSanctions } from './sanctions';
import { getStaffRoster } from './staff';

/**
 * The platform-operator server actions — the `'use server'` edge over
 * {@link performSetVerification}/{@link performIssueSanction}. Each resolves the
 * request-bound subject (`currentPrincipal()`) and the composition-root singletons
 * (the staff roster, the channel service, the sanction store) at its boundary and
 * hands the orchestration core plain values [LAW:effects-at-boundaries]. The form
 * state (`_prev`) is unused: each call recomputes its outcome from the form, so there
 * is nothing to thread between submissions [LAW:dataflow-not-control-flow].
 */

export async function setChannelVerification(
  _prev: VerifyResult | null,
  formData: FormData,
): Promise<VerifyResult> {
  return performSetVerification(
    {
      principal: await currentPrincipal(),
      roster: getStaffRoster(),
      channels: getChannelService(),
    },
    {
      handle: String(formData.get('handle') ?? ''),
      status: String(formData.get('status') ?? ''),
    },
  );
}

export async function issueSanction(
  _prev: SanctionResult | null,
  formData: FormData,
): Promise<SanctionResult> {
  return performIssueSanction(
    {
      principal: await currentPrincipal(),
      roster: getStaffRoster(),
      sanctions: getSanctions(),
      now: new SystemClock().now(),
    },
    {
      account: String(formData.get('account') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      scope: String(formData.get('scope') ?? ''),
      days: String(formData.get('days') ?? ''),
    },
  );
}
