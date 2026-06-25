import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ClaimChannelForm } from '@/components/ClaimChannelForm';
import { GoLiveControl } from '@/components/GoLiveControl';
import { MenuAuthoringForm } from '@/components/MenuAuthoringForm';
import { getCatalog } from '@/data/catalog';
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
  // A builder with a channel sees their current menu, prefilled for editing — read through
  // the same catalog seam a viewer reads, so the studio edits exactly what the audience
  // sees [LAW:one-source-of-truth]. A builder with no channel has no menu to read.
  const currentMenu = channel === undefined ? [] : ((await getCatalog().channel(channel.handle))?.menu ?? []);

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
          <section className="mt-12">
            <h2 className="text-lg font-bold tracking-tight text-chalk">your menu</h2>
            <p className="mt-1 mb-5 max-w-xl text-sm text-fog">
              Wire up what your audience can buy — name it, price it, and give it an effect your
              overlay reacts to. It’s yours: sell whatever you want.
            </p>
            <MenuAuthoringForm initialOffers={currentMenu} />
          </section>
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
