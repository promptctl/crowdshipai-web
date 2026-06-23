import { TalentBoard } from '@/components/TalentBoard';
import { getCatalog } from '@/data/catalog';

/**
 * The recruiter lens (discovery-41w.5) — the third side of the market. A server
 * component that reads the full roster through the one catalog seam, the same
 * source the browse grid reads, then hands it to the board that applies the lens
 * [LAW:locality-or-seam]. It reads `liveStreams()` because that returns every
 * builder worth surfacing, offline included — a recruiter's shortlist is not
 * limited to who happens to be live this minute; an offline builder's channel is
 * still their resume.
 */
export default async function TalentPage() {
  const roster = await getCatalog().liveStreams();

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <section className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-chalk">
          surface <span className="text-accent">talent</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fog">
          the stream is the resume. pivot by craft, then watch someone think — the truest interview there is.
          reach the ones worth reaching.
        </p>
      </section>

      <TalentBoard roster={roster} />
    </main>
  );
}
