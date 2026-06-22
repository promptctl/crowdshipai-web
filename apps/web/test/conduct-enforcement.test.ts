import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { accountId, type AccountId, type Sanction } from '@crowdship/identity';
import { actorRef, conductAction, type ActorStanding, type PolicySubject } from '@crowdship/moderation';
import { describe, expect, it } from 'vitest';

import { getPolicyBoundary } from '../src/server/policy';
import { conductStandingFor, getSanctions, standingFor } from '../src/server/sanctions';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));
const clockAt = (ms: number): Clock => ({ now: () => at(ms) });

const goLive = must(conductAction('go-live'));
const subjectFor = (standing: ActorStanding): PolicySubject => ({
  kind: 'actor-conduct',
  actor: must(actorRef('actor-1')),
  action: goLive,
  standing,
});

describe('standingFor — identity sanction mapped to moderation standing', () => {
  it('maps no governing sanction to good standing', () => {
    expect(standingFor(null)).toEqual({ kind: 'in-good-standing' });
  });

  it('maps a governing sanction to a bar carrying its reason', () => {
    const ban: Sanction = { reason: 'harassment', issuedAt: at(1_000), scope: { kind: 'permanent' } };
    expect(standingFor(ban)).toEqual({ kind: 'barred', reason: 'harassment' });
  });
});

describe('conduct enforcement through the one policy boundary', () => {
  const boundary = getPolicyBoundary();

  it('denies an actor whose identity sanctions resolve to a bar', async () => {
    const account: AccountId = must(accountId('acct-banned'));
    await getSanctions().record(account, {
      reason: 'banned: repeated abuse',
      issuedAt: at(1_000),
      scope: { kind: 'permanent' },
    });

    const standing = await conductStandingFor(account, clockAt(5_000));
    const decision = boundary.decide(subjectFor(standing));

    expect(decision.outcome).toBe('denied');
    if (decision.outcome === 'denied') {
      expect(decision.violations.map((v) => v.reason)).toContain('banned: repeated abuse');
    }
  });

  it('allows an actor with no sanctions on record', async () => {
    const account: AccountId = must(accountId('acct-clean'));

    const standing = await conductStandingFor(account, clockAt(5_000));
    expect(boundary.decide(subjectFor(standing))).toEqual({ outcome: 'allowed' });
  });

  it('allows an actor again once a suspension has expired', async () => {
    const account: AccountId = must(accountId('acct-suspended'));
    await getSanctions().record(account, {
      reason: 'temporary cooldown',
      issuedAt: at(1_000),
      scope: { kind: 'until', until: at(4_000) },
    });

    // During the suspension: barred.
    expect(boundary.decide(subjectFor(await conductStandingFor(account, clockAt(3_000)))).outcome).toBe(
      'denied',
    );
    // After it expires: allowed again, no manual lifting needed.
    expect(boundary.decide(subjectFor(await conductStandingFor(account, clockAt(5_000)))).outcome).toBe(
      'allowed',
    );
  });
});
