import type { StreamSummary } from './types';

/**
 * The canonical browse-roster order the {@link CrowdCatalog} seam promises: live
 * builders first, then by audience. It lives here ONCE so every catalog
 * implementation — the in-memory fake, the real channel-backed one — orders
 * identically and the "sorted live-first" contract can never drift between them
 * [LAW:single-enforcer][LAW:one-source-of-truth]. It sorts over DERIVED liveness;
 * it never filters — an offline builder stays in the roster (their channel is still
 * a resume).
 */
export const liveFirst = (a: StreamSummary, b: StreamSummary): number =>
  Number(b.isLive) - Number(a.isLive) || b.viewerCount - a.viewerCount;
