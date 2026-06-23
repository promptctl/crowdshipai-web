import { notFound } from 'next/navigation';

import { WatchSurface } from '@/components/WatchSurface';
import { getCatalog } from '@/data/catalog';
import { walletBalance } from '@/server/market-actions';
import { currentPrincipal } from '@/server/principal';

/**
 * The watch route. Loads the full channel view through the seam; a missing slug
 * is genuine optionality from untrusted URL input, so it routes to 404 rather
 * than being defended against everywhere downstream [LAW:no-defensive-null-guards].
 *
 * The backer's coin balance is read here, at the server edge, and handed to the
 * surface as a value [LAW:effects-at-boundaries] — `null` for a logged-out viewer,
 * a real "no wallet" absence rather than a zero that would imply an empty account
 * they do not have. Whether a session backs the request is read from the same edge
 * and handed down as `signedIn`, so the chat input reflects who may speak; the send
 * action remains the real authenticator [LAW:single-enforcer].
 */
export default async function WatchPage({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const channel = await getCatalog().channel(slug);
  if (channel === null) notFound();
  return (
    <WatchSurface
      channel={channel}
      initialBalance={await walletBalance()}
      signedIn={(await currentPrincipal()) !== null}
    />
  );
}
