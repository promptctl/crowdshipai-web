import Link from 'next/link';

import { auth, signOut } from '@/server/auth';

const pill = 'rounded-full px-3 py-1.5 text-fog transition-colors hover:bg-surface-2 hover:text-chalk';

/**
 * The header's auth-aware corner: who you are and a way out, or a way in. It is
 * an async server component so the answer comes from the real session, not
 * client guesswork — the one place the chrome reflects identity state.
 */
export async function AuthNav() {
  const session = await auth();
  if (session?.user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/account" className={`${pill} max-w-[14rem] truncate`}>
          {session.user.email}
        </Link>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button type="submit" className={pill}>
            log out
          </button>
        </form>
      </div>
    );
  }
  return (
    <Link href="/login" className={pill}>
      log in
    </Link>
  );
}
