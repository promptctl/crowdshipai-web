import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ClaimChannelForm } from '@/components/ClaimChannelForm';
import { GoLiveControl } from '@/components/GoLiveControl';
import { MenuAuthoringForm } from '@/components/MenuAuthoringForm';
import { OverlayStyleForm } from '@/components/OverlayStyleForm';
import { PoolAuthoringForm } from '@/components/PoolAuthoringForm';
import { getCatalog } from '@/data/catalog';
import { getChannelService } from '@/server/channels';
import { listPools } from '@/server/market-actions';
import { overlayStyleOf } from '@/server/overlay-actions';
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
  // The builder's live pools — their escrow balances are the ledger's truth at the
  // instant of this render; the client component keeps the list live as new pools open.
  const currentPools = channel === undefined ? [] : await listPools(channel.handle);

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
          <section className="mt-12">
            <h2 className="text-lg font-bold tracking-tight text-chalk">your overlay</h2>
            <p className="mt-1 mb-5 max-w-xl text-sm text-fog">
              When someone buys from your menu, the effect fires on your stream. Shape how it
              lands — the corner, the color, how long it stays. The look is yours; we just carry
              it.
            </p>
            <OverlayStyleForm initialStyle={await overlayStyleOf(channel.handle)} />
          </section>
          <section className="mt-12">
            <h2 className="text-lg font-bold tracking-tight text-chalk">funding pools</h2>
            <p className="mt-1 mb-5 max-w-xl text-sm text-fog">
              Open a pool and let your audience crowd-fund a feature. The instant the target is
              reached, the whole pool auto-releases to you — the backer who tips it watches it
              ship live.
            </p>
            <PoolAuthoringForm initialPools={currentPools} />
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
