import { notFound } from 'next/navigation';

import { WatchSurface } from '@/components/WatchSurface';
import { getCatalog } from '@/data/catalog';

/**
 * The watch route. Loads the full channel view through the seam; a missing slug
 * is genuine optionality from untrusted URL input, so it routes to 404 rather
 * than being defended against everywhere downstream [LAW:no-defensive-null-guards].
 */
export default async function WatchPage({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = await getCatalog().channel(slug);
  if (channel === null) notFound();
  return <WatchSurface channel={channel} />;
}
