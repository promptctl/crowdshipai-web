import type { CoinAmount, Result, Timestamp } from '@crowdship/std';
import { coinAmount, timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  escrow,
  meetCondition,
  refund,
  release,
  type ConditionMet,
  type Escrowed,
  type Pledge,
  type Refunded,
  type Released,
  type SettledPledge,
} from '../src/index.js';
import { pledgeId, refundReason } from '../src/index.js';

/** Unwrap a successful result or fail loudly — never let a falsy value slip past a
 *  truthiness check [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const at = (n: number): Timestamp => must(timestamp(n));

/** Concrete, structured terms a service would supply — the lifecycle treats this as
 *  opaque, so the test proves it survives every transition byte-for-byte. */
interface DeliveryTerms {
  readonly backer: string;
  readonly builder: string;
  readonly deliverable: string;
}
const TERMS: DeliveryTerms = { backer: 'acct-backer', builder: 'acct-builder', deliverable: 'ship the dark-mode PR' };

const fresh = (): Escrowed<DeliveryTerms> => escrow(must(pledgeId('pl-1')), coins(500n), TERMS, at(1_000));

describe('escrow opens a pledge against opaque terms', () => {
  it('produces an escrowed pledge carrying id, amount, terms, and when it was escrowed', () => {
    const p = fresh();
    expect(p.status).toBe('escrowed');
    expect(p.id).toBe('pl-1');
    expect(p.amount).toBe(500n);
    expect(p.escrowedAt).toBe(1_000);
    // The lifecycle never interprets the terms — they are carried whole.
    expect(p.terms).toEqual(TERMS);
  });
});

describe('the happy path: escrowed -> condition-met -> released', () => {
  it('advances each phase, accumulating the timeline and preserving the carried facts', () => {
    const escrowed = fresh();
    const met = meetCondition(escrowed, at(2_000));
    const released = release(met, at(3_000));

    expect(escrowed.status).toBe('escrowed');
    expect(met.status).toBe('condition-met');
    expect(released.status).toBe('released');

    // A released pledge proves its whole path through its timeline...
    expect(met.metAt).toBe(2_000);
    expect(released.metAt).toBe(2_000); // retained from condition-met
    expect(released.releasedAt).toBe(3_000);

    // ...and id, amount, terms, and escrowedAt ride through untouched.
    expect(released.id).toBe('pl-1');
    expect(released.amount).toBe(500n);
    expect(released.escrowedAt).toBe(1_000);
    expect(released.terms).toEqual(TERMS);
  });

  it('does not mutate the source pledge — a transition returns a new state', () => {
    const escrowed = fresh();
    meetCondition(escrowed, at(2_000));
    expect(escrowed.status).toBe('escrowed'); // the original is unchanged
  });
});

describe('the refund path: escrowed -> refunded', () => {
  it('settles back to the backer carrying its reason, and never gains a metAt', () => {
    const refunded = refund(fresh(), at(2_500), must(refundReason('deliverable rejected')));

    expect(refunded.status).toBe('refunded');
    expect(refunded.refundedAt).toBe(2_500);
    expect(refunded.reason).toBe('deliverable rejected');
    expect(refunded.amount).toBe(500n); // the whole escrow returns; splitting the cut is the engine's job
    expect(refunded.terms).toEqual(TERMS);
    // A refund in this lifecycle only reaches an unmet pledge, so there is no metAt to carry.
    expect('metAt' in refunded).toBe(false);
  });
});

describe('pledgeId and refundReason are non-blank, verbatim brands', () => {
  it('takes the id and reason exactly as given, with no normalization', () => {
    expect(must(pledgeId('  PL-Keep-Exact  '))).toBe('  PL-Keep-Exact  ');
    expect(must(refundReason('  Pool Expired  '))).toBe('  Pool Expired  ');
  });

  it('rejects a blank id or reason and names the field', () => {
    expect(pledgeId('')).toEqual({ ok: false, error: { kind: 'blank', label: 'pledgeId' } });
    expect(pledgeId('\t \n')).toEqual({ ok: false, error: { kind: 'blank', label: 'pledgeId' } });
    expect(refundReason('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'refundReason' } });
  });
});

// Type-level theorems, checked by `tsc` rather than at runtime: the acceptance
// criterion "an illegal transition is unrepresentable" expressed as types instead of
// trusted to prose [LAW:types-are-the-program]. Each asserts that a transition's
// parameter rejects every phase except its one legal source — so the illegal call does
// not compile. If a transition is ever loosened to accept a wrong phase, the matching
// assertion flips to `false` and this file stops compiling.
type Assert<T extends true> = T;
type Rejects<Arg, State> = State extends Arg ? false : true;

// meetCondition accepts ONLY an escrowed pledge.
type _MeetParam = Parameters<typeof meetCondition>[0];
type _MeetRejectsMet = Assert<Rejects<_MeetParam, ConditionMet<unknown>>>;
type _MeetRejectsReleased = Assert<Rejects<_MeetParam, Released<unknown>>>;
type _MeetRejectsRefunded = Assert<Rejects<_MeetParam, Refunded<unknown>>>;

// release accepts ONLY a condition-met pledge — never escrow (release-before-met) nor a
// terminal state (advancing a settled pledge).
type _ReleaseParam = Parameters<typeof release>[0];
type _ReleaseRejectsEscrowed = Assert<Rejects<_ReleaseParam, Escrowed<unknown>>>;
type _ReleaseRejectsReleased = Assert<Rejects<_ReleaseParam, Released<unknown>>>;
type _ReleaseRejectsRefunded = Assert<Rejects<_ReleaseParam, Refunded<unknown>>>;

// refund accepts ONLY an escrowed pledge — once the builder is owed, or once settled,
// there is no refund through this path.
type _RefundParam = Parameters<typeof refund>[0];
type _RefundRejectsMet = Assert<Rejects<_RefundParam, ConditionMet<unknown>>>;
type _RefundRejectsReleased = Assert<Rejects<_RefundParam, Released<unknown>>>;
type _RefundRejectsRefunded = Assert<Rejects<_RefundParam, Refunded<unknown>>>;

// A settled pledge is terminal: it is exactly the two terminal arms, and no transition
// names it as a source, so it cannot be advanced.
type _SettledIsTerminal = Assert<
  SettledPledge<unknown> extends Released<unknown> | Refunded<unknown> ? true : false
>;
type _NoTransitionAdvancesSettled = Assert<
  Rejects<_MeetParam, SettledPledge<unknown>> extends true
    ? Rejects<_ReleaseParam, SettledPledge<unknown>> extends true
      ? Rejects<_RefundParam, SettledPledge<unknown>> extends true
        ? true
        : false
      : false
    : false
>;

// The union's phases are EXACTLY the four named ones: mutual assignability is set
// equality, so neither a surprise phase added nor a named one dropped escapes. The
// one-directional check would pass vacuously when an arm is removed [LAW:types-are-the-program].
type _Phases = 'escrowed' | 'condition-met' | 'released' | 'refunded';
type _PledgeCoversAllPhases = Assert<
  _Phases extends Pledge<unknown>['status']
    ? Pledge<unknown>['status'] extends _Phases
      ? true
      : false
    : false
>;
