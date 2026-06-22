import type { PolicyFinding, PolicyRule } from './boundary.js';
import type { PolicyRuleId } from './ids.js';

/**
 * The hard line as a rule (o97.6): the founding document's single non-negotiable,
 * the line {@link HardLineVerdict} names. Published media a classifier found
 * `prohibited` is DENIED, and the violation carries the verdict's own reason so the
 * actor is told why — a hard line that cannot say why is a silent one
 * [LAW:no-silent-failure]. It judges the `published-media` subject and is silent
 * on every other arm — a rule contributes nothing to the arms it does not own, the
 * pattern the boundary is built around [LAW:dataflow-not-control-flow].
 *
 * It is a DENY, categorically distinct from the age gate (o97.3): a gate is
 * allowed-with-standing — mature content a cleared viewer may see — whereas the hard
 * line is NEVER allowed, regardless of the content's rating or the viewer's age. The
 * boundary already folds a violation ahead of any gate (most-restrictive-wins), so
 * this deny outranks a gate automatically; and o97.4's pipeline already treats any
 * denied decision as a review-queue incident, so a hard-line hit surfaces for human
 * review with no extra plumbing.
 *
 * The verdict itself is a world-fact gathered at the edge: a content classifier
 * (image/text ML) is IO, so it runs OUTSIDE the boundary and its finding arrives on
 * the subject as a {@link HardLineVerdict}, exactly as the conduct rule reads
 * `standing` and the gate reads `clearance`. This rule stays pure and synchronous
 * [LAW:effects-at-boundaries]; where the classifier draws the line between
 * "mature but permitted" and "prohibited" is the classifier's concern, not this
 * rule's — the rule trusts the verdict and enforces the one outcome. The id is
 * minted at the composition root and injected, so attribution traces to one place
 * [LAW:single-enforcer].
 */
export const createHardLineRule = (id: PolicyRuleId): PolicyRule => ({
  id,
  evaluate: (subject): readonly PolicyFinding[] => {
    if (subject.kind !== 'published-media') return [];
    if (subject.verdict.kind === 'clear') return [];
    return [{ kind: 'violation', rule: id, reason: subject.verdict.reason }];
  },
});
