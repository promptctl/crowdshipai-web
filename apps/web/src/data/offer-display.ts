import type { JsonValue } from '@crowdship/menu';

/**
 * The display text a builder writes for one offer: the name a backer reads on the
 * menu card, and the human sentence describing what firing it does. These are the
 * builder's words — "the menu belongs to the builder" — not a platform-owned shape.
 */
export interface OfferDisplay {
  readonly label: string;
  readonly summary: string;
}

/**
 * Carry an offer's display text INTO its effect params, the single home for the
 * builder-authored payload [LAW:one-source-of-truth]. An offer's domain shape is
 * `price + effect{kind, params}` and the `params` is an open {@link JsonValue} the
 * rail never branches on [LAW:effects-at-boundaries]; the human label and summary
 * the watch surface renders live HERE, inside that payload, rather than in a second
 * store the menu could drift from. The rail still never interprets params — only the
 * builder's overlay and our watch display read this shape, exactly its intended
 * consumer.
 */
export const offerParams = (display: OfferDisplay): JsonValue => ({
  label: display.label,
  summary: display.summary,
});

/**
 * Read the display text back out of an offer's params — the exact inverse of
 * {@link offerParams}. Every offer authored through CrowdShip's surface carries this
 * `{label, summary}` shape, so reading it back is total for our own data. A params
 * value that is NOT this shape is corruption — a hand-edited row, a foreign payload —
 * and is surfaced loudly, never silently defaulted to blank text that would render an
 * offer with no name and no description [LAW:no-silent-failure]. This is the same
 * stance the durable channel rebuild takes: a malformed record halts rather than
 * coercing.
 */
/** A JSON object (not an array, not a scalar). The predicate is the single place the
 *  "params is a keyed record" narrowing is asserted, so the reader below stays free of
 *  casts [LAW:single-enforcer]. */
const isJsonObject = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const offerDisplayOf = (params: JsonValue): OfferDisplay => {
  if (isJsonObject(params) && typeof params.label === 'string' && typeof params.summary === 'string') {
    return { label: params.label, summary: params.summary };
  }
  throw new Error(`offer params are not a CrowdShip display payload: ${JSON.stringify(params)}`);
};
