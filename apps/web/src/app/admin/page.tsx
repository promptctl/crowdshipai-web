import { notFound } from 'next/navigation';

import { isPlatformStaff } from '@crowdship/identity';
import { reviewQueue } from '@crowdship/moderation';

import { AdminConsole } from '@/components/AdminConsole';
import { getAuditTrail } from '@/server/audit-trail';
import { currentPrincipal } from '@/server/principal';
import { toQueueView } from '@/server/review-core';
import { getStaffRoster } from '@/server/staff';

/**
 * The staff console, visible only to platform staff. The gate is `isPlatformStaff`
 * over the configured roster, read at this server edge from the one authority source
 * every staff decision reads [LAW:single-enforcer] — a non-staff request (signed in
 * or not) gets `notFound()`, so the console's existence leaks nothing to someone who
 * may not use it. This page check is presentation; the binding enforcement is each
 * server action's own gate (`maySetVerification`/`maySanction`), which refuses a
 * crafted POST regardless of what the page rendered [LAW:no-silent-failure].
 */
export default async function AdminPage() {
  const principal = await currentPrincipal();
  if (principal === null || !isPlatformStaff(principal, getStaffRoster())) notFound();

  // The review queue is a PROJECTION of the one trail [LAW:one-source-of-truth], read at
  // this server edge and flattened to serializable views so no domain handle crosses into
  // the client [LAW:effects-at-boundaries].
  const queue = reviewQueue(await getAuditTrail().entries()).map(toQueueView);

  return <AdminConsole queue={queue} />;
}
