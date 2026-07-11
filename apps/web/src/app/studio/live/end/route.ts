import { currentPrincipal } from '@/server/principal';
import { endLiveFor } from '@/server/stream-lifecycle';

/**
 * The closing tab's end-of-stream edge: the `navigator.sendBeacon` target the go-live
 * control fires on `pagehide` while it still holds a live room. A beacon outlives the
 * page where a server action cannot, so this is how a closed tab ends its stream
 * HONESTLY — the ingest closes and the watchers see "ended" now, instead of a badge
 * that lies "live" until the SFU reaps the empty room minutes later
 * [LAW:no-silent-failure].
 *
 * It owns NOTHING of what ending means: it resolves the acting principal from the
 * request's own cookies and hands over to the one shared end path the explicit "end
 * stream" action also rides, so the two edges cannot drift [LAW:one-source-of-truth]
 * [LAW:single-enforcer]. That path already guarantees a builder can only end their OWN
 * stream, and that ending an already-offline channel is an empty obligation — so an
 * unauthenticated, channel-less, or duplicate beacon is honestly a no-op.
 *
 * A beacon is a credentialed cross-site-POSTable request, so the one check this edge
 * adds is its trust boundary's: the caller must be OUR page — a mismatched Origin is
 * refused before anything ends [LAW:single-enforcer]. Ending a stream moves no money,
 * but a stranger ending a builder's show is still a conduct surface worth the header
 * read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Origin header is network input — a malformed value is a refused caller, not a
// crash of this edge [LAW:no-silent-failure].
const originHost = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

// Same-origin proof, from whichever witness the browser sent: an Origin header that
// names this host, or the fetch-metadata verdict for a browser that omits Origin on
// same-origin POSTs. No witness at all is a refused caller.
const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin !== null) return host !== null && originHost(origin) === host;
  return request.headers.get('sec-fetch-site') === 'same-origin';
};

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  await endLiveFor(await currentPrincipal());
  return new Response(null, { status: 204 });
}
