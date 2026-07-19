import { NextResponse, type NextRequest } from 'next/server';

/**
 * The host boundary a validating ingress would own — enforced in-app because this
 * deployment currently serves its origin directly, with no reverse proxy in front
 * [LAW:single-enforcer]. Auth.js runs with `trustHost: true` (self-hosted v5 requires it,
 * or it throws UntrustedHost on every request), which means it constructs redirect and
 * cookie scope from the incoming Host header. This middleware makes that safe by ensuring
 * only ONE Host ever reaches the app: the canonical origin AUTH_URL pins. A request bearing
 * any other Host is refused at the edge, closing the Host-header surface [LAW:no-silent-failure].
 *
 * The allowed host is DERIVED from AUTH_URL, so "our host" has one source [LAW:one-source-of-truth].
 * With AUTH_URL unset (local dev), there is no canonical origin to pin and the guard is inert —
 * variability carried in the value, not a branch that conditionally skips the check
 * [LAW:dataflow-not-control-flow].
 */
const allowedHost = (): string | undefined => {
  const authUrl = process.env.AUTH_URL;
  if (authUrl === undefined || authUrl === '') return undefined;
  try {
    return new URL(authUrl).host;
  } catch {
    // A malformed AUTH_URL is a deployment error to surface, not to swallow into
    // "allow everything" — an unparseable pin fails closed [LAW:no-silent-failure].
    return '\0no-valid-host';
  }
};

export function middleware(request: NextRequest): NextResponse {
  const canonical = allowedHost();
  if (canonical === undefined) return NextResponse.next();
  return request.headers.get('host') === canonical
    ? NextResponse.next()
    : new NextResponse('Bad host', { status: 400 });
}

export const config = {
  // Every request except Next's own static assets — the host invariant is app-wide.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
