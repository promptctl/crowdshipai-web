import type { Brand, Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

/**
 * How many offers a menu may carry, as a type rather than a hope. A count is a
 * non-negative whole number; any other value is rejected at the one boundary that
 * mints it [LAW:types-are-the-program]. This is not pedantry: a negative cap would
 * silently INVERT the guardrail — `length > -1` is true for every menu, including
 * the empty one — and lock a builder out entirely, a failure that fires only once
 * the policy is already wrong [LAW:no-silent-failure]. The same
 * validate-at-construction idiom as `coinAmount` and every branded scalar on the
 * platform: the brand is the only way to obtain the value, so an unchecked cap is
 * unrepresentable downstream.
 */
export type MaxOffers = Brand<number, 'MaxOffers'>;

export type MaxOffersError = { readonly kind: 'not-a-count'; readonly value: number };

/** Mint a `MaxOffers` from a raw number, rejecting negatives and fractions. */
export const maxOffers = (value: number): Result<MaxOffers, MaxOffersError> =>
  Number.isInteger(value) && value >= 0 ? ok(value as MaxOffers) : err({ kind: 'not-a-count', value });

/**
 * The guardrails the platform puts around a menu — limits that protect the money
 * and the trust, never a judgment about what a builder sells or charges.
 *
 * This is the founding document's hardest line made into a type. The test it
 * demands at every rule: *does this protect the money and the trust, or does it
 * constrain the builder?* A guardrail belongs here only if it is the first.
 *
 * - `maxOffers` is the first guardrail, and it is squarely protect-side: it bounds
 *   the abuse surface — how many offers one builder can flood into a single menu —
 *   which grieves rendering, storage, and transport for everyone. It constrains
 *   neither what a builder sells (any effect kind) nor what they charge (any price),
 *   so it never crosses the line. The exact number is a knob, not a principle, the
 *   same way the coin-to-cent rate is.
 *
 * A NOTE ON WHAT IS DELIBERATELY ABSENT, so the next agent does not "complete" it:
 *
 * - There is no price cap. A price ceiling would reach straight into what a builder
 *   charges — the forbidden side — AND it would protect no money: the ledger's
 *   no-overdraft rule already protects a backer from any astronomical price, since
 *   they simply cannot afford it. A guardrail that protects nothing while
 *   constraining the builder is exactly the bloat the founding document escapes. (A
 *   genuine integrity ceiling — a price the ledger's 128-bit amount cannot move —
 *   is a property of the money primitive, not of menu policy, and belongs to its
 *   boundary, not here.)
 * - There are no refunds here. A refund is a purchase-TIME money reversal, not an
 *   authoring-time bound; it attaches to the purchase pipeline and overlaps the
 *   settlement work. A different cut, deliberately not smuggled in [LAW:decomposition].
 *
 * The policy is a plain value [LAW:dataflow-not-control-flow]: a deployment, a test,
 * or a future per-builder tier passes a different `MenuPolicy` and the same authoring
 * code runs — only the value differs. A new guardrail is one more field here plus one
 * more arm on `MenuProblem`/`OfferProblem`, which no problem consumer feels.
 */
export interface MenuPolicy {
  /** The most offers one menu may carry; a non-negative count by construction. */
  readonly maxOffers: MaxOffers;
}

const defaultMaxOffers = maxOffers(100);
if (!defaultMaxOffers.ok) {
  // Unreachable: 100 is a non-negative integer. The loud throw exists so that if this
  // literal is ever edited to an invalid cap, the platform fails at load — not silently.
  throw new Error(`DEFAULT_MENU_POLICY: ${defaultMaxOffers.error.value} is not a valid offer cap`);
}

/**
 * A sane default for a single builder's menu — generous enough that no legitimate
 * menu ever trips it, tight enough that an offer-flood cannot grief the rail. A
 * knob, not a principle: a caller that wants different bounds passes its own policy.
 */
export const DEFAULT_MENU_POLICY: MenuPolicy = { maxOffers: defaultMaxOffers.value };
