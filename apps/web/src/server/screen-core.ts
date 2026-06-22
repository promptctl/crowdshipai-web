import {
  isIncident,
  type AuditTrail,
  type ModerationEvent,
  type PolicyBoundary,
  type PolicyDecision,
  type PolicySubject,
} from '@crowdship/moderation';

/**
 * The recording edge the moderation pipeline was waiting on — the one place an
 * AUTOMATED policy decision becomes a durable trail entry, so a denial the boundary
 * reaches with no human in the loop surfaces in the SAME review queue as a human
 * report [LAW:single-enforcer]. The boundary already DECIDES (`hard-line-enforcement`
 * proved a prohibited verdict denies and classifies as an incident) and `reviewQueue`
 * already PROJECTS a denial into an incident; this seam is the wire between them that
 * `hard-line-enforcement.test.ts` names in its own words — "once the recording edge
 * logs it" — and nothing existed to log it until here.
 *
 * It is PURE orchestration over already-resolved values — the screening twin of
 * `report-core.ts`'s `performFileReport`. It takes the boundary and the trail as plain
 * inputs, so deciding a subject and appending its incident is reproducible in a test
 * without a session or the durable singleton [LAW:effects-at-boundaries]. A surface that
 * screens an action — a builder's go-live check against their conduct standing, published
 * media against a classifier's verdict — resolves those facts at its own edge, binds the
 * roots, and hands this the subject the boundary judges.
 */

export interface ScreenDeps {
  readonly boundary: PolicyBoundary;
  readonly audit: AuditTrail;
}

/**
 * The trail events an automated decision contributes: a single `policy-decided` entry
 * when the decision is an incident, NOTHING otherwise. The variability lives in the
 * length of this list, never in whether the append below runs [LAW:dataflow-not-control-flow]
 * — `performScreen` maps `record` over it unconditionally, so an `allowed` or `gated`
 * decision is an empty list and writes nothing rather than a guarded skip that hides a
 * decision was made. `isIncident` is moderation's single enforcer of "what counts as an
 * incident" (only a `denied` outcome); this leans on it rather than re-deciding, so the
 * two can never drift [LAW:one-source-of-truth].
 */
const incidentEvents = (subject: PolicySubject, decision: PolicyDecision): readonly ModerationEvent[] =>
  isIncident(decision) ? [{ kind: 'policy-decided', subject, decision }] : [];

/**
 * Screen a subject through the one boundary and record any incident it produces,
 * returning the decision the caller acts on. The decision is recorded WHOLE — subject
 * and outcome together — so the trail holds precisely what the review queue projects an
 * incident from, never a stored boolean the queue would have to trust over re-reading
 * the verdict [LAW:one-source-of-truth].
 *
 * The append is the only effect, and it is the trail's to make durable; this returns
 * the boundary's verdict unchanged so the surface still decides what to DO with a deny
 * (refuse the action, show the reason) — recording the incident and enforcing the
 * outcome are two concerns, and this owns only the first [LAW:decomposition].
 */
export const performScreen = async (deps: ScreenDeps, subject: PolicySubject): Promise<PolicyDecision> => {
  const decision = deps.boundary.decide(subject);
  await Promise.all(incidentEvents(subject, decision).map((event) => deps.audit.record(event)));
  return decision;
};
