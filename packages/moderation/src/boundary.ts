import type { ActorRef, ConductAction, PolicyRuleId, PublishedSurface } from './ids.js';

/**
 * The thing a policy decision is ABOUT — discriminated by `kind`, seeded along the
 * founding document's own two axes, CONTENT and CONDUCT. Every arm carries only
 * the FACTS a rule needs to decide; it never carries a handle to identity or
 * stream, because moderation is core and may not reach a sibling core
 * [LAW:one-way-deps]. The app gathers the facts (an actor's standing, a text body,
 * a classifier's verdict) at the edge and hands them in as plain data — which is
 * what lets the boundary stay a PURE function [LAW:effects-at-boundaries].
 *
 * The union GROWS one arm at a time as the moderation epic lands: o97.2 (maturity
 * rating) likely adds a stream-publish arm carrying a rating; a new arm is a new
 * value the boundary already routes, never a new code path through it
 * [LAW:dataflow-not-control-flow]. A rule matches the arms it judges and returns
 * nothing for the rest, so adding an arm never disturbs an existing rule.
 */
export type PolicySubject =
  | {
      /** Author-supplied text becoming visible — the content axis. */
      readonly kind: 'published-text';
      readonly author: ActorRef;
      readonly surface: PublishedSurface;
      /** The exact text under review, verbatim — a rule (o97.6) inspects it. */
      readonly text: string;
    }
  | {
      /** An actor attempting an action — the conduct axis. */
      readonly kind: 'actor-conduct';
      readonly actor: ActorRef;
      readonly action: ConductAction;
    };

/**
 * One rule's objection to a {@link PolicySubject}, attributed to the rule that
 * raised it. `reason` is the human-facing explanation a surface can show the actor
 * and the o97.4 pipeline can record [LAW:no-silent-failure] — a denial that cannot
 * say why is a silent one. Enriching a violation (a machine code, a severity) is
 * one more field here that no existing consumer feels.
 */
export interface PolicyViolation {
  readonly rule: PolicyRuleId;
  readonly reason: string;
}

/**
 * The outcome of the one boundary: a closed union the caller destructures
 * exhaustively, never a bare boolean that drops the reasons on the floor. Unlike
 * the OPEN labels a builder authors, the platform OWNS this vocabulary — content
 * and conduct policy is squarely our side of the line, so the outcome space is
 * fixed and exhaustively handled with no default arm [LAW:types-are-the-program].
 *
 * `allowed: false` carries a NON-EMPTY list: a denial without a stated violation
 * is unrepresentable, so "denied for no reason" cannot occur [LAW:no-silent-failure].
 * Gating (o97.3 age-gating) is a FUTURE arm of this union, not a special case
 * smuggled into a deny — when it lands it is one more shape here.
 */
export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly violations: readonly [PolicyViolation, ...PolicyViolation[]] };

/**
 * A single policy rule: a named, PURE judgement over a subject. It returns every
 * objection it has (empty = no objection), so the boundary can report ALL of them
 * at once — a deny tells the actor everything wrong in one pass, the way
 * `authorMenu` surfaces every menu fault together rather than one-at-a-time.
 *
 * Purity is the contract [LAW:effects-at-boundaries]: a rule that wants to consult
 * the world (an image classifier, an actor's ban record) does NOT do IO here — the
 * fact is fetched at the edge and arrives on the {@link PolicySubject}. This keeps
 * every rule trivially testable and the whole boundary synchronous.
 */
export interface PolicyRule {
  readonly id: PolicyRuleId;
  evaluate(subject: PolicySubject): readonly PolicyViolation[];
}

/**
 * THE single policy boundary [LAW:single-enforcer]. Every content and conduct check
 * on the platform passes through one `decide` — no surface inlines its own check,
 * because a duplicated check is a check that drifts. The app holds exactly one
 * instance (see `apps/web/src/server/policy.ts`), so "where does policy live" has
 * one answer.
 */
export interface PolicyBoundary {
  /** Synchronous and pure — see {@link PolicyRule}. */
  decide(subject: PolicySubject): PolicyDecision;
}

/**
 * Compose a set of rules into the one boundary: run EVERY rule over the subject,
 * gather all violations, and allow iff none objected — most-restrictive-wins, the
 * only safe default for a policy gate. The rule order does not change the verdict
 * (allow/deny is set-membership of violations), only the order reasons are listed,
 * so the set is genuinely a set, not a sequence with hidden ordering coupling
 * [LAW:no-ambient-temporal-coupling].
 *
 * An EMPTY rule set allows everything — and that is HONEST, not a silent pass: it
 * states plainly "no policy rules are configured yet" rather than pretending to
 * enforce one [LAW:no-silent-failure]. The moderation rules (the hard line o97.6,
 * conduct o97.5, maturity/age o97.2-3) are registered here as they land; until
 * then the boundary is loudly empty, never a fake gate.
 */
export const createPolicyBoundary = (rules: readonly PolicyRule[]): PolicyBoundary => ({
  decide: (subject) => {
    const violations = rules.flatMap((rule) => rule.evaluate(subject));
    const [first, ...rest] = violations;
    // `first` is the only thing that proves the list is non-empty; building the
    // tuple from it is what makes the deny arm's NON-EMPTY type true by construction
    // rather than asserted [LAW:types-are-the-program].
    return first === undefined ? { allowed: true } : { allowed: false, violations: [first, ...rest] };
  },
});
