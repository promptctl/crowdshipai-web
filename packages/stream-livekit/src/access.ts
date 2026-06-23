import type { VideoGrant } from 'livekit-server-sdk';
import { AccessToken } from 'livekit-server-sdk';

/**
 * What a LiveKit access token is allowed to do in a room. A builder PUBLISHES; a
 * viewer SUBSCRIBES. This is the single axis that distinguishes the two — a VALUE,
 * not two separate auth mechanisms [LAW:dataflow-not-control-flow]. Adding a future
 * mode (a co-host who both publishes and subscribes) is one more value here, not a
 * second token-minting path.
 */
export type LiveKitAccess = 'publish' | 'subscribe';

/**
 * Everything needed to mint one access token: which room, as whom, with what access,
 * for how long. Carried as data so the same minting seam serves publish and subscribe
 * alike — the shared-auth requirement of evf.1.1 [LAW:single-enforcer].
 */
export interface LiveKitTokenClaims {
  readonly room: string;
  readonly identity: string;
  readonly access: LiveKitAccess;
  readonly ttlSeconds: number;
}

/**
 * THE one place an access mode becomes a LiveKit grant [LAW:single-enforcer]. Publish
 * authorizes sending media (a builder going live) and nothing else; subscribe
 * authorizes receiving it (a viewer) and nothing else — neither can do the other's
 * job, so a leaked viewer token can never publish into a builder's room. Both paths —
 * the ingest broker's `open` and the viewer transport's subscribe-token mint — route
 * through here, so there is exactly one enforcer of "who may do what", never two that
 * could drift.
 */
export const grantFor = (access: LiveKitAccess, room: string): VideoGrant => ({
  roomJoin: true,
  room,
  canPublish: access === 'publish',
  canPublishData: access === 'publish',
  canSubscribe: access === 'subscribe',
});

/**
 * Mint a signed access token from claims — the effect of turning an authorization
 * decision into a bearer credential. Modeled as a function seam so the broker depends
 * on the CAPABILITY to sign, not on the SDK's `AccessToken` class: the real signer
 * (below) closes over the API secret, while a test passes a stub that records claims
 * and returns a fake token [LAW:effects-at-boundaries].
 */
export type LiveKitTokenSigner = (claims: LiveKitTokenClaims) => Promise<string>;

/**
 * The production signer: holds the LiveKit API key/secret and mints HS256 JWTs the
 * provider validates. The secret lives ONLY inside this closure, built at the app
 * composition root from server-side env — never shipped to the browser, never logged
 * [LAW:effects-at-boundaries]. The provider, not us, validates the resulting token;
 * we are only its issuer [LAW:single-enforcer].
 */
export const liveKitTokenSigner =
  (apiKey: string, apiSecret: string): LiveKitTokenSigner =>
  (claims) => {
    const token = new AccessToken(apiKey, apiSecret, {
      identity: claims.identity,
      ttl: claims.ttlSeconds,
    });
    token.addGrant(grantFor(claims.access, claims.room));
    return token.toJwt();
  };
