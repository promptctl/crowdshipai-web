import type { Principal } from '@crowdship/identity';
import { reportTarget, type AuditTrail, type Report } from '@crowdship/moderation';

import { actorRefFor } from './actor-ref';
import type { ReportResult } from '../data/report-result';

/**
 * Filing a moderation report, as PURE orchestration over already-resolved values — the
 * report twin of `admin-core.ts`'s `performIssueSanction`. It takes the acting principal
 * and the audit trail as plain inputs, so the decision and the append are reproducible
 * in a test without a session, a cookie, or a framework [LAW:effects-at-boundaries]. The
 * `'use server'` edge (`report-actions.ts`) resolves those values from the request and
 * the composition roots and hands them here.
 *
 * Authentication is checked FIRST, before any field is parsed: a report must name WHO
 * filed it, because an anonymous flag is one the trail could never fairly weigh. The
 * reporter and the reported target are mapped onto moderation's opaque refs at this one
 * edge [LAW:single-enforcer] — moderation is core and never sees an identity handle
 * [LAW:one-way-deps].
 */

export interface ReportDeps {
  readonly principal: Principal | null;
  readonly audit: AuditTrail;
}

export interface ReportInput {
  /** What is being reported — the app's own opaque handle for the thing (a channel
   *  handle, a stream slug). Moderation owns no taxonomy of reportable kinds, so this
   *  is whatever the reporting surface names [LAW:no-mode-explosion]. */
  readonly target: string;
  /** The reporter's free-text grounds — why they are flagging it. */
  readonly reason: string;
}

export const performFileReport = async (deps: ReportDeps, input: ReportInput): Promise<ReportResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  // Trim untrusted form values before parsing: a target handle or reason pasted into
  // the form can pick up surrounding whitespace, and an all-whitespace value is the
  // honest "nothing here", refused distinctly rather than recorded as a blank report
  // [LAW:no-silent-failure].
  const target = reportTarget(input.target.trim());
  if (!target.ok) return { kind: 'invalid-target' };
  const reason = input.reason.trim();
  if (reason.length === 0) return { kind: 'invalid-reason' };

  const report: Report = { reporter: actorRefFor(deps.principal), target: target.value, reason };
  await deps.audit.record({ kind: 'report-filed', report });
  return { kind: 'filed' };
};
