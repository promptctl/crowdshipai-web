'use server';

import { randomUUID } from 'node:crypto';

import { viewerConnectionFor, type ViewerConnection } from './stream';

/**
 * The server action the watch surface calls to subscribe to a builder's live room.
 * It is the trust boundary where the API secret stays server-side: the browser receives
 * only the public wss URL and a short-lived subscribe-only token, never the signing key
 * [LAW:effects-at-boundaries][LAW:single-enforcer].
 *
 * The viewer's LiveKit identity is minted HERE, randomly, once per call — so any number
 * of viewers of the same builder coexist instead of evicting each other under LiveKit's
 * one-connection-per-identity rule. Randomness is an effect, so it lives at this edge,
 * not in the pure transport [LAW:effects-at-boundaries].
 *
 * Returns `null` when the app runs on the in-memory fake (no SFU) — the player reads that
 * honest absence as "not live yet" and shows the placeholder, never a fabricated token
 * [LAW:no-silent-failure].
 */
export async function viewerConnection(slug: string): Promise<ViewerConnection | null> {
  return viewerConnectionFor(slug, `viewer:${randomUUID()}`);
}
