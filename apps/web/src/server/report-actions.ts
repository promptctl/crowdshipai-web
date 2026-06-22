'use server';

import type { ReportResult } from '../data/report-result';
import { getAuditTrail } from './audit-trail';
import { currentPrincipal } from './principal';
import { performFileReport } from './report-core';

/**
 * The viewer report server action — the `'use server'` edge over
 * {@link performFileReport}. It resolves the request-bound subject (`currentPrincipal()`)
 * and the composition-root audit trail at its boundary and hands the orchestration core
 * plain values [LAW:effects-at-boundaries]. The form state (`_prev`) is unused: each
 * call recomputes its outcome from the form, so there is nothing to thread between
 * submissions [LAW:dataflow-not-control-flow].
 */
export async function fileReport(_prev: ReportResult | null, formData: FormData): Promise<ReportResult> {
  return performFileReport(
    {
      principal: await currentPrincipal(),
      audit: getAuditTrail(),
    },
    {
      target: String(formData.get('target') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    },
  );
}
