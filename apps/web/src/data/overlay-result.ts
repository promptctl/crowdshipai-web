import type { OverlayStyle, OverlayStyleField } from './overlay-style';

/**
 * The outcome of a builder restyling their overlay, as a closed union the form
 * matches exhaustively [LAW:dataflow-not-control-flow] — the overlay twin of
 * `MenuAuthorResult`. Every refusal is its OWN arm carrying its own reason, never a
 * single "couldn't save" that hides which input to fix [LAW:no-silent-failure]:
 *
 * - `saved` — the style was validated, persisted, and announced to every watcher;
 *   it carries the style AS SAVED so the form shows exactly what the audience now
 *   sees, not its own unconfirmed inputs [LAW:one-source-of-truth].
 * - `must-authenticate` — no session; you cannot restyle an overlay as no one.
 * - `no-channel` — a signed-in account that has not claimed a channel has no
 *   overlay to style; claim first.
 * - `invalid` — one or more fields were out of the rail's bounds, named per field
 *   so the form says exactly which input to fix [LAW:no-silent-failure]. Only a
 *   tampered or broken client reaches this: the real form's inputs are constrained.
 *
 * Every arm is plain serializable data, so it crosses the server-action boundary
 * back to the form unchanged.
 */
export type OverlayAuthorResult =
  | { readonly kind: 'saved'; readonly style: OverlayStyle }
  | { readonly kind: 'must-authenticate' }
  | { readonly kind: 'no-channel' }
  | { readonly kind: 'invalid'; readonly problems: readonly OverlayStyleField[] };
