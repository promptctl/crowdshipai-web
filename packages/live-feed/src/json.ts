/**
 * A JSON value — the shape of what appears live on a stream.
 *
 * What fires onto the feed is data, not behavior: a fired effect, a presence
 * change, a settlement release in view of the stream — each is a *description*
 * carried across this seam and rendered by the watcher's overlay; the feed never
 * interprets it [LAW:effects-at-boundaries]. The JSON shape (no functions, no
 * class instances, no cycles) is the strongest theorem still true of genuinely
 * open, builder-and-feature-shaped payloads, and it is exactly what must survive
 * the trip to a viewer's browser as JSON. The variety of what can appear comes
 * from the product's features, not a union this seam enumerates
 * [LAW:types-are-the-program].
 *
 * NOTE: `@crowdship/menu` carries an identical `JsonValue` for an effect's
 * builder-authored params. The two are structurally the same pure-JSON shape but
 * cannot be shared: menu is a sibling core, so this core may not depend on it
 * [LAW:one-way-deps]. Hoisting one `JsonValue` to the foundation is a focused
 * cross-cutting pass (the same shape as the deferred ledger-kernel/std merge),
 * not this seam's concern — left deliberately rather than smuggled in here.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
