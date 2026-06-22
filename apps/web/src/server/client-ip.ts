/**
 * The client IP as seen at the trust boundary, read from the forwarding headers a
 * reverse proxy sets. The single place that string is derived [LAW:single-enforcer],
 * so the auth edges share one definition of "which source is this".
 *
 * SECURITY CONTRACT, stated loudly because it changes meaning silently otherwise
 * [LAW:no-silent-failure]: `X-Forwarded-For` is only trustworthy when a proxy the
 * deployment controls OVERWRITES it on ingress. Exposed without such a proxy, the
 * client sets it freely, so per-IP limiting keyed on this value can be bypassed by
 * rotating the header. That is why the auth edge pairs per-IP with a per-email
 * limit: the email key is bound to the targeted account and cannot be spoofed away.
 */
export function clientIp(headers: Headers): string {
  // X-Forwarded-For is a comma-separated proxy chain; the first hop is the
  // original client (everything after is proxies that handled the request).
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor !== null) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) return realIp;

  // No identifiable source: collapse to one shared bucket. Unattributable traffic
  // is rate-limited together rather than each request escaping the limit — a
  // deliberate, visible fallback, not a silent pass-through [LAW:no-silent-failure].
  return 'unknown';
}
