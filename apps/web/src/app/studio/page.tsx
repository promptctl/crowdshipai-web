import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ClaimChannelForm } from '@/components/ClaimChannelForm';
import { GoLiveControl } from '@/components/GoLiveControl';
import { getChannelService } from '@/server/channels';
import { currentPrincipal } from '@/server/principal';

/**
 * The builder studio: where a builder goes live. A protected route — the gate is
 * `currentPrincipal()` in the server component itself, the same discipline the account
 * page uses, because identity storage runs on node:sqlite which only the Node runtime
 * loads [LAW:effects-at-boundaries]. No session → no studio.
 *
 * The channel the builder streams as is read HERE from their authenticated identity, the
 * single source of truth for "what is this account's channel" [LAW:one-source-of-truth] —
 * the same `channelByOwner` lookup the go-live action re-derives server-side, so the
 * slug shown here and the room published to are one. A builder who has not yet claimed a
 * channel has nothing to stream as; that is an honest absence with its own surface, not a
 * broken go-live button [LAW:dataflow-not-control-flow].
 */
export default async function StudioPage() {
  const principal = await currentPrincipal();
  if (principal === null) redirect('/login');

  const channel = await getChannelService().channelByOwner(principal.id);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-chalk">studio</h1>
      {channel === undefined ? (
        <>
          <p className="mt-4 max-w-xl text-sm text-fog">
            You need a channel before you can go live. Claim your handle to become a builder, then
            start streaming.
          </p>
          <ClaimChannelForm />
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-fog">
            Live as{' '}
            <Link href={`/c/${channel.handle}`} className="font-semibold text-accent hover:underline">
              {channel.profile.displayName}
            </Link>{' '}
            — capture your screen and start building in front of your audience.
          </p>
          <div className="mt-8">
            <GoLiveControl slug={channel.handle} />
          </div>
        </>
      )}
      <div className="mt-10">
        <Link href="/" className="text-sm text-fog hover:text-chalk">
          ← back to browse
        </Link>
      </div>
    </main>
  );
}
