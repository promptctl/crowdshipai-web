import type { PolicyFinding, PolicyRule } from './boundary.js';
import type { PolicyRuleId } from './ids.js';

/**
 * Conduct enforcement as a rule (o97.5): an actor who is `barred` may not act, and
 * the denial carries the bar's own reason so the actor is told why it was denied — a
 * bar that cannot say why is a silent one [LAW:no-silent-failure]. It judges the `actor-conduct`
 * subject and is silent on every other arm — a rule contributes nothing to the arms
 * it does not own, the pattern the boundary is built around [LAW:dataflow-not-control-flow].
 *
 * It bars regardless of the {@link ConductAction} attempted: a banned or suspended
 * actor may do NOTHING, so the rule reads only the standing, not the action. (An
 * action-specific conduct rule — say a rate limit on one surface — is a DIFFERENT
 * rule judging the same arm, not a branch inside this one [LAW:decomposition].) The
 * standing itself is a world-fact gathered at the edge: identity owns the enforcement
 * record, the app collapses it to an {@link ActorStanding} against the clock and hands
 * it in, and this rule stays pure and synchronous [LAW:effects-at-boundaries]. The id
 * is minted at the composition root and injected, so attribution traces to one place
 * [LAW:single-enforcer].
 */
export const createConductRule = (id: PolicyRuleId): PolicyRule => ({
  id,
  evaluate: (subject): readonly PolicyFinding[] => {
    if (subject.kind !== 'actor-conduct') return [];
    if (subject.standing.kind === 'in-good-standing') return [];
    return [{ kind: 'violation', rule: id, reason: subject.standing.reason }];
  },
});
