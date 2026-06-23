/**
 * The production LiveKit binding for the `IngestBroker` seam: a real WebRTC SFU behind
 * the same port the in-memory fake implements, so every caller composes with either and
 * no caller changes when the app swaps one for the other [LAW:locality-or-seam]. This is
 * an adapter — it binds a vendor SDK (livekit-server-sdk) to a core (`@crowdship/stream`)
 * and depends on no other adapter or service [LAW:one-way-deps]. The media bytes flow
 * through LiveKit's SFU, never this package; we only broker rooms and mint the tokens
 * that authorize a builder to publish and a viewer to subscribe [LAW:effects-at-boundaries].
 *
 * The API key/secret are touched in exactly one place — the signer built at the app
 * composition root from server-side env — and never reach the browser or a log
 * [LAW:single-enforcer]. Publish (a builder going live) and subscribe (a viewer
 * watching) are two VALUES of one access type routed through one signer, not two auth
 * systems [LAW:dataflow-not-control-flow]; the viewer transport (evf.2.1) reuses
 * {@link mintSubscribeToken} so the shared auth has a single enforcer.
 */
export type { LiveKitAccess, LiveKitTokenClaims, LiveKitTokenSigner } from './access.js';
export { grantFor, liveKitTokenSigner } from './access.js';

export type { LiveKitRooms, LiveKitIngestDeps } from './livekit-broker.js';
export { createLiveKitIngestBroker, liveKitRooms, mintSubscribeToken, roomNameOf } from './livekit-broker.js';
