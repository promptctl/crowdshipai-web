'use server';

import type { ResolveResult } from '../data/review-result';
import { getAuditTrail } from './audit-trail';
import { currentPrincipal } from './principal';
import { performResolveItem } from './review-core';
import { getStaffRoster } from './staff';

/**
 * The review-resolve server action — the `'use server'` edge over
 * {@link performResolveItem}. It resolves the request-bound subject
 * (`currentPrincipal()`), the staff roster, and the composition-root audit trail at its
 * boundary and hands the orchestration core plain values [LAW:effects-at-boundaries].
 * The form state (`_prev`) is unused: each call recomputes its outcome from the form
 * [LAW:dataflow-not-control-flow].
 */
export async function resolveItem(_prev: ResolveResult | null, formData: FormData): Promise<ResolveResult> {
  return performResolveItem(
    {
      principal: await currentPrincipal(),
      roster: getStaffRoster(),
      audit: getAuditTrail(),
    },
    {
      entry: String(formData.get('entry') ?? ''),
      disposition: String(formData.get('disposition') ?? ''),
      note: String(formData.get('note') ?? ''),
    },
  );
}
