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
/** A keyed record (not an array, not a scalar, not null). The predicate is the single
 *  place the "params is a keyed record" narrowing is asserted, so the readers below
 *  stay free of casts [LAW:single-enforcer]. Over `unknown` rather than `JsonValue`
 *  because the wire-side reader receives bytes that have not yet been proven JSON of
 *  our shape — the same check serves both. */
const isKeyedRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the display text out of an unproven params value, or `null` when it does not
 * carry the CrowdShip `{label, summary}` shape — the TRUST-BOUNDARY face of this
 * module, for readers of the live wire where a foreign params shape is honest
 * optionality (an effect authored elsewhere still fired; it just brings no display
 * text), never corruption [LAW:no-silent-failure]. The shape knowledge lives only
 * here, beside {@link offerParams} which writes it [LAW:one-source-of-truth].
 */
export const offerDisplayIn = (params: unknown): OfferDisplay | null =>
  isKeyedRecord(params) && typeof params.label === 'string' && typeof params.summary === 'string'
    ? { label: params.label, summary: params.summary }
    : null;

export const offerDisplayOf = (params: JsonValue): OfferDisplay => {
  const display = offerDisplayIn(params);
  if (display === null) {
    throw new Error(`offer params are not a CrowdShip display payload: ${JSON.stringify(params)}`);
  }
  return display;
};
