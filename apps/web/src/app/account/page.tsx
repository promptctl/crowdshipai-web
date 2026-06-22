import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, signOut } from '@/server/auth';

/**
 * A protected route: the gate is `auth()` in the server component itself, not
 * edge middleware — identity storage runs on node:sqlite, which only the Node
 * runtime can load [LAW:effects-at-boundaries]. No session → no page.
 */
export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-chalk">your account</h1>
      <p className="mt-3 text-sm text-fog">
        Signed in as <span className="text-chalk">{session.user.email}</span>.
      </p>
      <p className="mt-1 text-xs text-fog">
        account id: <span className="text-chalk">{session.user.id}</span>
      </p>
      <div className="mt-8 flex items-center gap-4">
        <Link href="/" className="text-sm text-fog hover:text-chalk">
          ← back to browse
        </Link>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="rounded-full border border-edge px-4 py-2 text-sm font-semibold text-chalk transition-colors hover:bg-surface-2"
          >
            log out
          </button>
        </form>
      </div>
    </main>
  );
}
