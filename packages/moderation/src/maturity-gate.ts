import type { PolicyFinding, PolicyRule } from './boundary.js';
import type { PolicyRuleId } from './ids.js';
import { maturityAtLeast } from './maturity.js';

/**
 * The age gate as a rule: a viewer may see rated content only if their clearance
 * reaches the content's level. It judges the `viewer-access` subject and is silent
 * on every other — a rule contributes nothing to the arms it does not own, the
 * pattern the boundary is built around.
 *
 * The whole judgement is one ordering question answered by {@link maturityAtLeast},
 * so the gate never re-encodes the level order — the canonical scale remains its one
 * source [LAW:one-source-of-truth]. When the viewer falls short, the finding carries
 * the content's own level as `required`: the surface prompts for exactly that
 * standing, and the gate stays a pure comparison over facts handed in at the edge
 * [LAW:effects-at-boundaries]. The id is minted at the composition root and injected,
 * so attribution traces to one place [LAW:single-enforcer].
 */
export const createMaturityGateRule = (id: PolicyRuleId): PolicyRule => ({
  id,
  evaluate: (subject): readonly PolicyFinding[] => {
    if (subject.kind !== 'viewer-access') return [];
    if (maturityAtLeast(subject.clearance, subject.rating.level)) return [];
    return [{ kind: 'gate', rule: id, required: subject.rating.level }];
  },
});
