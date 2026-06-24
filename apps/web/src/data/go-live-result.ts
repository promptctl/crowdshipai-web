import type { LiveKitConnection } from './live-connection';

/**
 * What opening a builder's publish credential surrenders — the honest, closed set of
 * outcomes the media provider boundary can produce [LAW:types-are-the-program]. The
 * builder's go-live UI matches it exhaustively, so a new arm is a compile error at
 * every site rather than a silently unhandled state [LAW:dataflow-not-control-flow].
 *
 * `ready` carries the credential to publish with. `no-sfu` is the in-memory fake's
 * honest absence — no real SFU backs this environment, so there is nothing to publish
 * to, the exact publish-side twin of the viewer transport's `null`
 * [LAW:no-silent-failure]. `already-live` and `provider-unavailable` mirror the ingest
 * broker's two `OpenIngestError` arms: a channel holds at most one open ingest, and the
 * provider can be unreachable.
 */
export type PublishHandoff =
  | { readonly kind: 'ready'; readonly connection: LiveKitConnection }
  | { readonly kind: 'no-sfu' }
  | { readonly kind: 'already-live' }
  | { readonly kind: 'provider-unavailable' };

/**
 * A go-live attempt distilled to what the builder's control must do: the provider
 * outcomes above, plus the two the authorization edge adds before the provider is ever
 * reached — `must-authenticate` (no live session) and `no-channel` (signed in, but no
 * claimed channel to stream as). One closed union over BOTH boundaries
 * [LAW:decomposition], exhaustively matched by the control so every outcome has a
 * defined surface and none falls through [LAW:no-silent-failure].
 */
export type GoLiveResult =
  | PublishHandoff
  | { readonly kind: 'must-authenticate' }
  | { readonly kind: 'no-channel' };
