import type { CoinAmount, Result, Timestamp } from '@crowdship/std';
import { coinAmount, timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { escrow, type Pledge } from '../src/index.js';
import {
  deliverableId,
  goalId,
  isMet,
  observeDeliverable,
  observeGoal,
  observePool,
  pledgeId,
  type Condition,
  type DeliverableAccepted,
  type DeliverableObservation,
  type GoalObservation,
  type GoalResolved,
  type Observation,
  type PoolObservation,
  type PoolTargetReached,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};
const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const at = (n: number): Timestamp => must(timestamp(n));

const poolTarget: PoolTargetReached = { kind: 'pool-target-reached', target: coins(500n) };
const deliverable: DeliverableAccepted = { kind: 'deliverable-accepted', deliverable: must(deliverableId('feat-dark-mode')) };
const goal: GoalResolved = { kind: 'goal-resolved', goal: must(goalId('hit-mrr')) };

describe('observePool pairs a pool target with the coins observed against it', () => {
  it('is met once the pooled coins reach the target, and exactly at it', () => {
    expect(isMet(observePool(poolTarget, coins(499n)))).toBe(false);
    expect(isMet(observePool(poolTarget, coins(500n)))).toBe(true); // exactly at target releases
    expect(isMet(observePool(poolTarget, coins(900n)))).toBe(true);
  });

  it('carries the criterion through untouched alongside the live reading', () => {
    const obs = observePool(poolTarget, coins(700n));
    expect(obs.kind).toBe('pool-target-reached');
    expect(obs.target).toBe(500n); // the stored criterion is preserved
    expect(obs.pooled).toBe(700n); // the observed fact rides alongside
  });
});

describe('observeDeliverable and observeGoal turn a binary fact into met/unmet', () => {
  it('an accepted deliverable is met; an unaccepted one is pending', () => {
    expect(isMet(observeDeliverable(deliverable, true))).toBe(true);
    expect(isMet(observeDeliverable(deliverable, false))).toBe(false);
  });

  it('a resolved goal is met; an unresolved one is pending', () => {
    expect(isMet(observeGoal(goal, true))).toBe(true);
    expect(isMet(observeGoal(goal, false))).toBe(false);
  });

  it('preserves which entity the condition watches', () => {
    expect(observeDeliverable(deliverable, false).deliverable).toBe('feat-dark-mode');
    expect(observeGoal(goal, false).goal).toBe('hit-mrr');
  });
});

describe('deliverableId and goalId are non-blank, verbatim brands', () => {
  it('takes the identity exactly as given', () => {
    expect(must(deliverableId('  Feat-Keep-Exact  '))).toBe('  Feat-Keep-Exact  ');
    expect(must(goalId('  Goal-Keep-Exact  '))).toBe('  Goal-Keep-Exact  ');
  });

  it('rejects a blank identity and names the field', () => {
    expect(deliverableId('')).toEqual({ ok: false, error: { kind: 'blank', label: 'deliverableId' } });
    expect(goalId('\t \n')).toEqual({ ok: false, error: { kind: 'blank', label: 'goalId' } });
  });
});

describe('a condition rides inside the pledge as opaque Terms', () => {
  // The seam from e5a.1: the state machine is generic over Terms it never interprets, so a
  // condition lands additively — the composing service embeds it and escrow carries it whole.
  it('escrows a pledge whose terms embed a condition, untouched', () => {
    interface DeliveryTerms {
      readonly backer: string;
      readonly builder: string;
      readonly condition: Condition;
    }
    const terms: DeliveryTerms = { backer: 'acct-backer', builder: 'acct-builder', condition: poolTarget };
    const pledge: Pledge<DeliveryTerms> = escrow(must(pledgeId('pl-1')), coins(500n), terms, at(1_000));
    expect(pledge.terms.condition).toBe(poolTarget);
  });
});

// Type-level theorems, checked by `tsc` rather than at runtime [LAW:types-are-the-program].
type Assert<T extends true> = T;

// The union is CLOSED at exactly the three named kinds — mutual assignability is set
// equality, so neither a surprise kind added nor a named one dropped escapes.
type _Kinds = 'pool-target-reached' | 'deliverable-accepted' | 'goal-resolved';
type _ConditionCoversAllKinds = Assert<
  _Kinds extends Condition['kind'] ? (Condition['kind'] extends _Kinds ? true : false) : false
>;

// The observation kinds mirror the condition kinds EXACTLY — a reading is always for some
// condition and every condition can be read, so the engine's evaluator stays total.
type _ObservationMirrorsCondition = Assert<
  Observation['kind'] extends Condition['kind']
    ? Condition['kind'] extends Observation['kind']
      ? true
      : false
    : false
>;

// A reading is bound to its kind: the pool arm carries `pooled` and CANNOT carry a goal's
// `resolved` or a deliverable's `accepted`, so a mismatched pairing is unrepresentable —
// `observePool` can never yield a value a goal predicate would read.
type _PoolArm = Extract<Observation, { kind: 'pool-target-reached' }>;
type _PoolCarriesItsReading = Assert<'pooled' extends keyof _PoolArm ? true : false>;
// Each foreign reading rejected on its own — a union on the left of `extends` is not
// distributive, so a single leaked key must be asserted independently to be caught.
type _PoolRejectsResolved = Assert<'resolved' extends keyof _PoolArm ? false : true>;
type _PoolRejectsAccepted = Assert<'accepted' extends keyof _PoolArm ? false : true>;
type _PoolArmIsNotGoalArm = Assert<
  _PoolArm extends Extract<Observation, { kind: 'goal-resolved' }> ? false : true
>;

// The predicate is total over the closed union: its parameter is exactly `Observation`,
// nothing wider, so every constructible reading has a verdict.
type _IsMetParam = Parameters<typeof isMet>[0];
type _IsMetTakesExactlyObservation = Assert<
  _IsMetParam extends Observation ? (Observation extends _IsMetParam ? true : false) : false
>;

// Each observation type exposes its own reading field — guards the `extends` wiring above.
type _DeliverableCarriesAccepted = Assert<DeliverableObservation['accepted'] extends boolean ? true : false>;
type _GoalCarriesResolved = Assert<GoalObservation['resolved'] extends boolean ? true : false>;
type _PoolCarriesPooled = Assert<PoolObservation['pooled'] extends CoinAmount ? true : false>;
