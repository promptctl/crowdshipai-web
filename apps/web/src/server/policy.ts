import { createPolicyBoundary, type PolicyBoundary, type PolicyRule } from '@crowdship/moderation';

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

// The rule set is EMPTY today, and loudly so — there is no fake gate pretending to
// enforce a policy that is not written yet [LAW:no-silent-failure]. The real rules
// register here as their tickets land: the hard line (o97.6), conduct (o97.5),
// maturity (o97.2), age-gating (o97.3). Adding one is a push to this array, never a
// change to any caller of getPolicyBoundary() [LAW:locality-or-seam].
const RULES: readonly PolicyRule[] = [];

// One boundary per process. It is stateless — a pure decision over an immutable rule
// set — so unlike the ingest broker it carries no session state to preserve across
// HMR, and a plain module singleton is the whole of what it needs.
const policyBoundary: PolicyBoundary = createPolicyBoundary(RULES);

export const getPolicyBoundary = (): PolicyBoundary => policyBoundary;
