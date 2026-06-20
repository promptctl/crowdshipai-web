import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LiveBadge } from '@/components/LiveBadge';
import { StreamStage } from '@/components/StreamStage';
import { getCatalog } from '@/data/catalog';

/**
 * The builder channel page (discovery-41w.2): the three context views a builder
 * owns — their stream, their menu, their identity — on one surface. Reuses the
 * same StreamStage and reads the same menu/offer substrate as the watch surface,
 * so there is no second shop to keep in sync [LAW:one-source-of-truth].
 */
export default async function ChannelPage({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = await getCatalog().channel(slug);
  if (channel === null) notFound();
  const { stream } = channel;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-center gap-4">
        <span
          className="h-16 w-16 shrink-0 rounded-full"
          style={{ background: `hsl(${stream.accentHue} 60% 45%)` }}
          aria-hidden
        />
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
          <Link href={`/watch/${stream.slug}`} className="block transition-transform hover:-translate-y-0.5">
            <StreamStage accentHue={stream.accentHue} isLive={stream.isLive} viewerCount={stream.viewerCount} />
            <p className="mt-2 text-sm font-semibold text-chalk">{stream.title}</p>
          </Link>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fog">the menu</h2>
          <div className="flex flex-col gap-2">
            {channel.menu.map((offer) => (
              <div key={offer.id} className="rounded-md border border-edge bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-chalk">{offer.label}</span>
                  <span className="text-xs font-semibold text-accent tabular-nums">◎{offer.priceCoins}</span>
                </div>
                <p className="mt-1 text-xs text-fog">{offer.effect.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
