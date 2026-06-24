/**
 * Everything a browser needs to join a builder's LiveKit room, and nothing it does
 * not: the PUBLIC wss endpoint and a short-lived, server-signed token. The two travel
 * as ONE value because they are useless apart [LAW:decomposition].
 *
 * There is ONE connection type, not a `ViewerConnection` and a `PublishConnection`:
 * the browser does the identical `room.connect(url, token)` with either, and what the
 * token AUTHORIZES — subscribe for a viewer, publish for the builder — lives in the
 * token's signed grants, not in the shape of this value [LAW:one-type-per-behavior].
 * The role distinction lives in the names of the seams that MINT each
 * (`viewerConnectionFor` vs `publishConnectionFor`), where it is real, rather than in a
 * structural difference TypeScript could not actually enforce.
 *
 * The API secret is NEVER here: it stays server-side in the signer and only its
 * signature crosses to the browser [LAW:effects-at-boundaries].
 */
export interface LiveKitConnection {
  readonly url: string;
  readonly token: string;
}
