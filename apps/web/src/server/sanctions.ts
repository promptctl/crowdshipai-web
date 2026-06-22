import type { Clock } from '@crowdship/std';
import {
  effectiveSanction,
  InMemorySanctionStore,
  type AccountId,
  type Sanction,
  type SanctionStore,
} from '@crowdship/identity';
import { IN_GOOD_STANDING, type ActorStanding } from '@crowdship/moderation';

/**
 * The single place the web app holds its sanction store [LAW:single-enforcer] — the
 * enforcement twin of `getPolicyBoundary()`. Conduct enforcement is recorded here and
 * read here; no surface keeps its own copy of who is banned, because a duplicated bar
 * is one that drifts. The in-memory store is the walking-skeleton stand-in; a durable
 * store swaps in behind the same `SanctionStore` seam without touching this module's
 * callers [LAW:locality-or-seam].
 */
const sanctionStore: SanctionStore = new InMemorySanctionStore();

export const getSanctions = (): SanctionStore => sanctionStore;

/**
 * Map identity's governing {@link Sanction} onto moderation's {@link ActorStanding} —
 * the identity↔moderation seam at the one composition point, exactly as `currentPrincipal`
 * maps a session onto a `Principal` and `getPolicyBoundary` maps a principal onto an
 * `ActorRef`. Pure and total: no governing sanction is good standing (the baseline,
 * a real value not a null [LAW:no-defensive-null-guards]); a governing one is a bar
 * carrying its moderator-written reason as the why the denial states [LAW:no-silent-failure].
 *
 * Only the reason crosses into the policy boundary — the structural detail of a bar (a
 * permanent ban vs a suspension until some instant, and the deadline) stays on the
 * {@link Sanction} record for a surface that shows enforcement to read directly, never
 * formatted into prose here [LAW:decomposition].
 */
export const standingFor = (governing: Sanction | null): ActorStanding =>
  governing === null ? IN_GOOD_STANDING : { kind: 'barred', reason: governing.reason };

/**
 * The conduct standing of one account as of the clock's `now` — the edge read a route
 * runs before building an `actor-conduct` subject for `decide`. It gathers the account's
 * sanctions from the store, derives the governing bar against `now`, and maps it to a
 * standing: the one effectful step (the store read + the clock) lives here at the edge so
 * the policy boundary downstream stays pure [LAW:effects-at-boundaries].
 */
export const conductStandingFor = async (
  account: AccountId,
  clock: Clock,
): Promise<ActorStanding> =>
  standingFor(effectiveSanction(await sanctionStore.forAccount(account), clock.now()));
