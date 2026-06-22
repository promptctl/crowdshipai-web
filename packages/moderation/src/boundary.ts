import type { ActorRef, ConductAction, PolicyRuleId, PublishedSurface } from './ids.js';
import type { MaturityLevel, MaturityRating } from './maturity.js';
import type { HardLineVerdict } from './screening.js';
import type { ActorStanding } from './standing.js';

/**
 * The thing a policy decision is ABOUT — discriminated by `kind`, seeded along the
 * founding document's own two axes, CONTENT and CONDUCT, with viewer ACCESS added
 * as the maturity epic lands. Every arm carries only the FACTS a rule needs to
 * decide; it never carries a handle to identity or stream, because moderation is
 * core and may not reach a sibling core [LAW:one-way-deps]. The app gathers the
 * facts (an actor's standing, a text body, a viewer's age) at the edge and hands
 * them in as plain data — which is what lets the boundary stay a PURE function
 * [LAW:effects-at-boundaries].
 *
 * The union GROWS one arm at a time as the epic lands; a new arm is a new value the
 * boundary already routes, never a new code path through it
 * [LAW:dataflow-not-control-flow]. A rule matches the arms it judges and returns
 * nothing for the rest, so adding an arm never disturbs an existing rule.
 */
export type PolicySubject =
  | {
      /** Author-supplied text becoming visible — the content axis. */
      readonly kind: 'published-text';
      readonly author: ActorRef;
      readonly surface: PublishedSurface;
      /** The exact text under review, verbatim — a rule inspects it. */
      readonly text: string;
    }
  | {
      /**
       * Author-published media becoming visible — the content axis for images and
       * video, where the hard line (o97.6) lives. A SEPARATE arm from published-text,
       * not a reshaping of it: text is judged on its verbatim body, media on a
       * classifier's {@link HardLineVerdict} — different facts wanting different
       * fields, so they are different arms, forkable, never one stretched over both
       * [LAW:carrying-cost] [LAW:decomposition].
       */
      readonly kind: 'published-media';
      readonly author: ActorRef;
      readonly surface: PublishedSurface;
      /**
       * What a content classifier found about this media against the one hard line —
       * a world-fact the edge produces by running the classifier (IO) and hands in,
       * so the rule stays a pure read [LAW:effects-at-boundaries]. Required, never
       * optional: media that reaches the boundary has been screened, and a clean pass
       * is {@link CLEAR} (the baseline), never a missing field the rule must defend
       * against [LAW:no-defensive-null-guards].
       */
      readonly verdict: HardLineVerdict;
    }
  | {
      /** An actor attempting an action — the conduct axis. */
      readonly kind: 'actor-conduct';
      readonly actor: ActorRef;
      readonly action: ConductAction;
      /**
       * Where the actor stands with the platform — the fact the conduct rule (o97.5)
       * judges. It is a world-fact derived at the edge from the actor's enforcement
       * record in identity and handed in, so the boundary stays pure and never reaches
       * a sibling core [LAW:effects-at-boundaries] [LAW:one-way-deps]. Required, never
       * optional: an actor always HAS a standing, and an unknown one is the edge's to
       * resolve to {@link IN_GOOD_STANDING} (the baseline), never a missing field the
       * rule must defend against [LAW:no-defensive-null-guards].
       */
      readonly standing: ActorStanding;
    }
  | {
      /** A viewer asking to see rated content — the access axis. The age gate
       *  (o97.3) judges this arm. */
      readonly kind: 'viewer-access';
      readonly viewer: ActorRef;
      /** The content's declared maturity, the value o97.2 made canonical. */
      readonly rating: MaturityRating;
      /**
       * The highest maturity level this viewer is cleared to see. It is a world-fact
       * — derived at the edge from the viewer's age and verification — turned into a
       * level there and handed in, so the rule stays a pure comparison
       * [LAW:effects-at-boundaries]. A viewer with no standing is cleared to
       * `'general'`, never null: absence is the baseline level, not a missing field
       * [LAW:no-defensive-null-guards].
       */
      readonly clearance: MaturityLevel;
    };

/**
 * One rule's objection that a {@link PolicySubject} must not proceed AT ALL,
 * attributed to the rule that raised it. `reason` is the human-facing explanation a
 * surface can show the actor and the o97.4 pipeline can record [LAW:no-silent-failure]
 * — a denial that cannot say why is a silent one. Distinct from a {@link PolicyGate}:
 * a violation is never-allowed, a gate is allowed-with-standing.
 */
export interface PolicyViolation {
  readonly kind: 'violation';
  readonly rule: PolicyRuleId;
  readonly reason: string;
}

/**
 * One rule's finding that a {@link PolicySubject} is allowable but only to a viewer
 * who clears a maturity standing — the age gate's output. It carries `required`, the
 * level a viewer must be cleared to, so a surface can prompt for exactly that
 * ("verify you can view mature content") rather than guess. Categorically NOT a
 * {@link PolicyViolation}: the content is fine, this viewer simply may not see it
 * yet, and the gate names the resolvable standing rather than refusing outright.
 */
export interface PolicyGate {
  readonly kind: 'gate';
  readonly rule: PolicyRuleId;
  readonly required: MaturityLevel;
}

/**
 * Everything a rule can raise about a subject: a hard {@link PolicyViolation} or a
 * {@link PolicyGate}. A discriminated union so the boundary folds the two kinds into
 * the right outcome by `kind` alone, never by which rule produced them
 * [LAW:dataflow-not-control-flow]. Empty means "no objection".
 */
export type PolicyFinding = PolicyViolation | PolicyGate;

/**
 * The outcome of the one boundary: a closed union the caller destructures
 * exhaustively on `outcome`, never a bare boolean — three states cannot live in a
 * boolean without lying, and the platform OWNS this vocabulary [LAW:types-are-the-program].
 * The three are ordered by restriction: `denied` (never allowed) ≻ `gated` (allowed
 * to a cleared viewer) ≻ `allowed`. o97.1 designed for the gated arm to land as the
 * third shape; here it does, as one more value the boundary returns rather than a
 * special case smuggled into a deny.
 *
 * `denied` carries a NON-EMPTY list of violations and `gated` a NON-EMPTY list of
 * gates: an outcome that restricts without a stated reason is unrepresentable, so
 * "blocked for no reason" cannot occur [LAW:no-silent-failure].
 */
export type PolicyDecision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'denied'; readonly violations: readonly [PolicyViolation, ...PolicyViolation[]] }
  | { readonly outcome: 'gated'; readonly gates: readonly [PolicyGate, ...PolicyGate[]] };

/**
 * A single policy rule: a named, PURE judgement over a subject. It returns every
 * finding it has (empty = no objection), so the boundary can report ALL of them at
 * once — a verdict tells the actor everything relevant in one pass.
 *
 * Purity is the contract [LAW:effects-at-boundaries]: a rule that wants to consult
 * the world (an image classifier, a viewer's age) does NOT do IO here — the fact is
 * fetched at the edge and arrives on the {@link PolicySubject}. This keeps every rule
 * trivially testable and the whole boundary synchronous.
 */
export interface PolicyRule {
  readonly id: PolicyRuleId;
  evaluate(subject: PolicySubject): readonly PolicyFinding[];
}

/**
 * THE single policy boundary [LAW:single-enforcer]. Every content, conduct, and
 * access check on the platform passes through one `decide` — no surface inlines its
 * own check, because a duplicated check is a check that drifts. The app holds exactly
 * one instance (see `apps/web/src/server/policy.ts`), so "where does policy live" has
 * one answer.
 */
export interface PolicyBoundary {
  /** Synchronous and pure — see {@link PolicyRule}. */
  decide(subject: PolicySubject): PolicyDecision;
}

/**
 * Compose a set of rules into the one boundary: run EVERY rule over the subject,
 * gather all findings, and fold them most-restrictive-wins — any violation denies;
 * else any gate gates; else allow. The rule order does not change the verdict
 * (each outcome is set-membership of findings), only the order reasons are listed,
 * so the set is genuinely a set, not a sequence with hidden ordering coupling
 * [LAW:no-ambient-temporal-coupling].
 *
 * An EMPTY rule set allows everything — and that is HONEST, not a silent pass: it
 * states plainly "no policy rules are configured yet" rather than pretending to
 * enforce one [LAW:no-silent-failure]. The moderation rules (the hard line o97.6,
 * conduct o97.5, the maturity gate o97.3) are registered as they land; until then
 * the boundary is loudly empty, never a fake gate.
 */
export const createPolicyBoundary = (rules: readonly PolicyRule[]): PolicyBoundary => ({
  decide: (subject) => {
    const findings = rules.flatMap((rule) => rule.evaluate(subject));

    // `first` is the only thing that proves a list is non-empty; building each
    // tuple from it is what makes the restricting arms' NON-EMPTY type true by
    // construction rather than asserted [LAW:types-are-the-program]. Violation
    // beats gate beats allow — the one safe precedence for a policy gate.
    const violations = findings.filter((f): f is PolicyViolation => f.kind === 'violation');
    const [firstViolation, ...restViolations] = violations;
    if (firstViolation !== undefined) {
      return { outcome: 'denied', violations: [firstViolation, ...restViolations] };
    }

    const gates = findings.filter((f): f is PolicyGate => f.kind === 'gate');
    const [firstGate, ...restGates] = gates;
    if (firstGate !== undefined) {
      return { outcome: 'gated', gates: [firstGate, ...restGates] };
    }

    return { outcome: 'allowed' };
  },
});
