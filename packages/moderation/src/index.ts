/**
 * The single policy boundary — content and conduct enforced at exactly one place
 * [LAW:single-enforcer]. One `PolicyBoundary.decide` every surface routes through,
 * a closed `PolicyDecision` it owns, and an OPEN set of `PolicyRule`s composed into
 * it as the moderation epic lands. The boundary is a PURE function over facts
 * gathered at the edge [LAW:effects-at-boundaries], so it stays synchronous and
 * trivially testable; the real rules (hard line, conduct, maturity/age) plug in
 * without touching the path they flow through.
 */
export type { ActorRef, ConductAction, EntryId, PolicyRuleId, PublishedSurface, ReportTarget } from './ids.js';
export { actorRef, conductAction, entryId, policyRuleId, publishedSurface, reportTarget } from './ids.js';

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

/**
 * Conduct enforcement (o97.5): an actor `barred` from acting is denied at the one
 * boundary, with the bar's reason. {@link ActorStanding} is the world-fact the rule
 * reads — identity owns the enforcement record, the app collapses it to a standing at
 * the edge and hands it in, the rule stays pure. What an upheld review DOES (issue a
 * ban/suspension) lives in identity; this is only the rule that reads the resulting
 * standing.
 */
export type { ActorStanding } from './standing.js';
export { IN_GOOD_STANDING } from './standing.js';
export { createConductRule } from './conduct-rule.js';

/**
 * The hard line (o97.6): published media a classifier found `prohibited` is denied at
 * the one boundary, with the verdict's reason. {@link HardLineVerdict} is the world-fact
 * the rule reads, and the home of what the hard line forbids:
 * a content classifier runs at the edge (IO) and hands its finding in on the
 * `published-media` subject, the rule stays pure. {@link CLEAR} is the baseline a
 * classifier hands in when it found nothing prohibited.
 */
export type { HardLineVerdict } from './screening.js';
export { CLEAR } from './screening.js';
export { createHardLineRule } from './hard-line-rule.js';

/**
 * The moderation pipeline (o97.4): report, review, action — all recorded to one
 * append-only {@link AuditTrail}, the system of record. The trail is the single
 * source of truth for moderation history; the review queue and the incident
 * classifier are PURE projections of it, never a second store. The pipeline WRAPS the
 * policy boundary at the edge (record each incident decision) and never changes
 * `decide`'s purity.
 */
export type { Report } from './report.js';

export type { Resolution, ReviewDisposition } from './review.js';
export { REVIEW_DISPOSITIONS } from './review.js';

export type { AuditTrail, AuditTrailDeps, ModerationEvent, RecordedEvent } from './audit.js';
export { createInMemoryAuditTrail } from './audit.js';

export type { QueueItem } from './queue.js';
export { incidentViolations, isIncident, reviewQueue } from './queue.js';

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
