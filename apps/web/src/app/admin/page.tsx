import { notFound } from 'next/navigation';

import { isPlatformStaff } from '@crowdship/identity';

import { AdminConsole } from '@/components/AdminConsole';
import { currentPrincipal } from '@/server/principal';
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

  return <AdminConsole />;
}
