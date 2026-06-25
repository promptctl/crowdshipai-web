'use server';

import { redirect } from 'next/navigation';

import type { ClaimResult } from '../data/claim-result';
import { getChannelService } from './channels';
import { performClaim } from './claim-core';
import { currentPrincipal } from './principal';

/**
 * The claim server action the studio's claim form calls — the `'use server'` edge over
 * {@link performClaim}. It is the trust boundary where WHO is claiming is decided: the
 * acting principal is resolved HERE from the session, and the owner the channel binds to
 * is that principal's id (inside the core), never a value the form supplies
 * [LAW:single-enforcer][LAW:effects-at-boundaries]. The claim capability is bound to the
 * one composition-root channel service, so the role grant and channel insert land in the
 * single identity store [LAW:one-source-of-truth].
 *
 * On success the builder now has a channel, so they are sent to the studio — which
 * re-reads their channel and shows the go-live control instead of this form. The redirect
 * is the one effect of the success arm, performed at the edge; the pure core only decided
 * that the claim succeeded [LAW:effects-at-boundaries]. Every other arm is returned for
 * the form to render as an honest reason.
 */
export async function claimChannelAction(
  _prev: ClaimResult | null,
  formData: FormData,
): Promise<ClaimResult> {
  const result = await performClaim(
    {
      principal: await currentPrincipal(),
      claim: (ownerId, handle, profile) =>
        getChannelService().claimChannel(ownerId, handle, profile),
    },
    {
      handle: String(formData.get('handle') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
    },
  );
  if (result.kind === 'claimed') redirect('/studio');
  return result;
}
