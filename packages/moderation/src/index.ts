/**
 * The single policy boundary — content and conduct enforced at exactly one place
 * [LAW:single-enforcer]. One `PolicyBoundary.decide` every surface routes through,
 * a closed `PolicyDecision` it owns, and an OPEN set of `PolicyRule`s composed into
 * it as the moderation epic lands. The boundary is a PURE function over facts
 * gathered at the edge [LAW:effects-at-boundaries], so it stays synchronous and
 * trivially testable; the real rules (hard line, conduct, maturity/age) plug in
 * without touching the path they flow through.
 */
export type { ActorRef, ConductAction, PolicyRuleId, PublishedSurface } from './ids.js';
export { actorRef, conductAction, policyRuleId, publishedSurface } from './ids.js';

export type {
  PolicyBoundary,
  PolicyDecision,
  PolicyFinding,
  PolicyGate,
  PolicyRule,
  PolicySubject,
  PolicyViolation,
} from './boundary.js';
export { createPolicyBoundary } from './boundary.js';

export { createMaturityGateRule } from './maturity-gate.js';

export type { ContentDescriptor, MaturityLevel, MaturityRating, UnknownMaturityLevel } from './maturity.js';
export {
  contentDescriptor,
  GENERAL_AUDIENCE,
  maturityAtLeast,
  maturityLevel,
  maturityRating,
  MATURITY_LEVELS,
} from './maturity.js';

/** The construction error every branded label returns; its home is foundation,
 *  re-exported so a consumer has the package's whole surface in one import. */
export type { BlankError } from '@crowdship/std';
