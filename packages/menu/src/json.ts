/**
 * A JSON value — the shape of an effect's builder-authored payload.
 *
 * The payload is data, not behavior, because an offer's effect is a
 * *description* that is carried across a seam and performed at the edge — the
 * builder's overlay reads it; the rail never interprets it
 * [LAW:effects-at-boundaries]. The JSON shape (no functions, no class
 * instances, no cycles) is the strongest theorem still true of genuinely-open
 * builder data: it is exactly as open as the domain demands, because "the
 * variety comes from builders, not our roadmap" [LAW:types-are-the-program].
 * (A few `number`s — NaN, ±Infinity — are not JSON-round-trip-safe and the type
 * cannot exclude them; finiteness is a runtime check for the boundary that
 * actually serializes a payload, not a property of this type.)
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
