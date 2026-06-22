import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { PolicyDecision } from '@crowdship/moderation';

import { BuilderAvatar } from '@/components/BuilderAvatar';
import { LiveBadge } from '@/components/LiveBadge';
import { MaturityGate } from '@/components/MaturityGate';
import { OfferCard } from '@/components/OfferCard';
import { StreamStage } from '@/components/StreamStage';
import { getCatalog } from '@/data/catalog';
import type { StreamSummary } from '@/data/types';
import { viewerAccessDecision } from '@/server/access';
import { currentPrincipal } from '@/server/principal';

/**
 * What occupies the stream slot, chosen by the age gate's verdict on this viewer.
 * The slot ALWAYS renders something — the page never reflows between a stream and a
 * block — so the variability lives in WHICH node, a value derived from the closed
 * `outcome`, never in whether the section appears [LAW:dataflow-not-control-flow].
 * The switch is exhaustive with no default arm: a fourth outcome would fail the
 * build here rather than fall through silently [LAW:no-silent-failure]. `gates` and
 * `violations` are non-empty by the decision's type, so the first is always present.
 */
function streamSlot(stream: StreamSummary, access: PolicyDecision) {
  switch (access.outcome) {
    case 'allowed':
      return (
        <Link href={`/watch/${stream.slug}`} className="block transition-transform hover:-translate-y-0.5">
          <StreamStage accentHue={stream.accentHue} isLive={stream.isLive} viewerCount={stream.viewerCount} />
          <p className="mt-2 text-sm font-semibold text-chalk">{stream.title}</p>
        </Link>
      );
    case 'gated':
      return <MaturityGate required={access.gates[0].required} />;
    case 'denied':
      return (
        <div
          className="grid w-full place-items-center rounded-lg border border-edge bg-surface-2 px-6 text-center"
          style={{ aspectRatio: '16 / 9' }}
        >
          <p className="max-w-sm text-sm font-semibold text-fog">{access.violations[0].reason}</p>
        </div>
      );
  }
}

/**
 * The builder channel page: the three context views a builder owns — their
 * stream, their menu, their identity — on one surface. It renders the menu
 * through the same OfferCard the watch surface uses, so the two cannot show a
 * builder's offers differently [LAW:one-source-of-truth].
 *
 * Rated content passes the o97.3 age gate before the stream shows: the viewer is
 * read at this edge (`currentPrincipal`) and the access decision made through the
 * one policy boundary (`viewerAccessDecision`). Identity and menu stay visible
 * regardless — a viewer may always see WHO a builder is and what they offer; only
 * the rated stream itself waits behind clearance.
 */
export default async function ChannelPage({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = await getCatalog().channel(slug);
  if (channel === null) notFound();
  const { stream } = channel;

  const access = viewerAccessDecision(await currentPrincipal(), stream.maturity);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-center gap-4">
        <BuilderAvatar accentHue={stream.accentHue} className="h-16 w-16" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-chalk">{stream.builderName}</h1>
          <p className="mt-0.5 max-w-xl text-sm text-fog">{channel.bio}</p>
          <div className="mt-2">
            <LiveBadge isLive={stream.isLive} viewerCount={stream.viewerCount} />
          </div>
        </div>
      </div>

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fog">the stream</h2>
          {streamSlot(stream, access)}
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fog">the menu</h2>
          <div className="flex flex-col gap-2">
            {channel.menu.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
