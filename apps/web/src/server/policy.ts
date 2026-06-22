import {
  createConductRule,
  createMaturityGateRule,
  createPolicyBoundary,
  policyRuleId,
  type PolicyBoundary,
  type PolicyRule,
  type PolicyRuleId,
} from '@crowdship/moderation';

/**
 * The single place the web app holds its policy boundary [LAW:single-enforcer] —
 * the moderation twin of `getAuthService()`, `getCatalog()`, and `getIngestBroker()`.
 * Every content and conduct check on every surface routes through this one
 * `decide`; no route or action inlines its own check, because a duplicated check is
 * one that drifts.
 *
 * Mapping note: the boundary speaks in `@crowdship/moderation`'s opaque `ActorRef`,
 * not an identity `AccountId` — moderation is core and cannot see identity (a
 * sibling core) [LAW:one-way-deps]. A surface that calls `decide` maps its principal
 * onto an `ActorRef` HERE, the one composition point, exactly as `getIngestBroker()`
 * maps onto stream's `ChannelRef`.
 */

// A rule id is a non-blank label; minting one for a hard-coded rule can only fail by
// programmer error, so we unwrap it loudly at boot rather than let a misconfigured
// rule silently fall out of the boundary [LAW:no-silent-failure]. This is the one
// composition point where rule ids are coined, as more rules land.
const ruleId = (raw: string): PolicyRuleId => {
  const id = policyRuleId(raw);
  if (!id.ok) throw new Error(`policy: invalid rule id ${JSON.stringify(raw)}: ${JSON.stringify(id.error)}`);
  return id.value;
};

// The rules register here as their tickets land — the hard line (o97.6) is the one
// still to come — each a push to this array, never a change to any caller of
// getPolicyBoundary() [LAW:locality-or-seam]. The age gate (o97.3) gates any
// viewer-access subject by the content's rating; the conduct rule (o97.5) denies any
// actor-conduct subject whose `standing` is barred — the actor's bar is resolved from
// their identity sanctions at the edge (see `./sanctions`) and handed in.
const RULES: readonly PolicyRule[] = [
  createMaturityGateRule(ruleId('maturity-gate')),
  createConductRule(ruleId('conduct')),
];

// One boundary per process. It is stateless — a pure decision over an immutable rule
// set — so unlike the ingest broker it carries no session state to preserve across
// HMR, and a plain module singleton is the whole of what it needs.
const policyBoundary: PolicyBoundary = createPolicyBoundary(RULES);

export const getPolicyBoundary = (): PolicyBoundary => policyBoundary;
