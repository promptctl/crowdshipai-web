import { StreamCard } from '@/components/StreamCard';
import { getCatalog } from '@/data/catalog';

/**
 * Browse — the entry to the product (discovery-41w.1). A server component that
 * reads through the single catalog seam; it has no idea whether the data came
 * from an in-memory fake or a real stream service [LAW:locality-or-seam].
 */
export default async function BrowsePage() {
  const streams = await getCatalog().liveStreams();
  const liveCount = streams.filter((s) => s.isLive).length;

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <section className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-chalk">
          watch someone <span className="text-accent">build</span>
        </h1>
        <p className="mt-1 text-sm text-fog">
          {liveCount} {liveCount === 1 ? 'builder is' : 'builders are'} live right now. pull up a chair, heckle, fund
          the thing you want shipped.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {streams.map((stream) => (
          <StreamCard key={stream.slug} stream={stream} />
        ))}
      </div>
    </main>
  );
}
