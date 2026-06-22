import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAuthLimiters,
  decideAuthRateLimit,
  EMAIL_LIMIT,
  IP_LIMIT,
  WINDOW_MILLIS,
  type AuthLimiters,
} from '../src/server/auth-rate-limit-core';
import { FakeClock } from './support';

/**
 * These exercise the WEB-TIER COMPOSITION — the two specific windows (per-IP at
 * IP_LIMIT, per-email at EMAIL_LIMIT) and the IP-first ordering — not the
 * sliding-window mechanics, which `@crowdship/rate-limit` already proves. The clock
 * is fake so window edges are deterministic.
 */
describe('decideAuthRateLimit (web auth throttle composition)', () => {
  let clock: FakeClock;
  let limiters: AuthLimiters;

  beforeEach(() => {
    clock = new FakeClock();
    limiters = createAuthLimiters(clock);
  });

  const decide = (ip: string, emailKey: string) => decideAuthRateLimit(limiters, { ip, email: emailKey });

  it('caps one account at EMAIL_LIMIT attempts across distinct sources, then denies', () => {
    // Distinct IPs each stay at one hit, so only the per-email window can trip —
    // this is the spoof-resistant backstop when the source IP is rotated.
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      expect(decide(`source-${i}`, 'victim@example.com').allowed).toBe(true);
    }
    expect(decide('source-final', 'victim@example.com').allowed).toBe(false);
  });

  it('caps one source at IP_LIMIT attempts across distinct accounts, then denies', () => {
    // Distinct emails each stay at one hit, so only the per-IP window can trip —
    // this is the volume lever bounding how fast one source enqueues scrypt work.
    for (let i = 0; i < IP_LIMIT; i++) {
      expect(decide('attacker', `account-${i}@example.com`).allowed).toBe(true);
    }
    expect(decide('attacker', 'account-final@example.com').allowed).toBe(false);
  });

  it('denies on the IP window first WITHOUT spending the targeted account budget', () => {
    // Saturate the attacker's IP window with decoy accounts.
    for (let i = 0; i < IP_LIMIT; i++) decide('attacker', `decoy-${i}@example.com`);

    // An 11th attempt from that IP, now aimed at a victim account never seen before,
    // is denied by the IP window. If the composition checked email first (or didn't
    // short-circuit), this would consume one of the victim's slots.
    expect(decide('attacker', 'victim@example.com').allowed).toBe(false);

    // Proof it did not: from fresh sources the victim still has a full EMAIL_LIMIT.
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      expect(decide(`fresh-${i}`, 'victim@example.com').allowed).toBe(true);
    }
    expect(decide('fresh-final', 'victim@example.com').allowed).toBe(false);
  });

  it('reports a retry delay within (0, WINDOW_MILLIS] on denial', () => {
    for (let i = 0; i < EMAIL_LIMIT; i++) decide(`source-${i}`, 'victim@example.com');
    const outcome = decide('source-final', 'victim@example.com');

    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.retryAfterMillis).toBeGreaterThan(0);
      expect(outcome.retryAfterMillis).toBeLessThanOrEqual(WINDOW_MILLIS);
    }
  });

  it('admits the account again once the window has slid past the oldest hit', () => {
    for (let i = 0; i < EMAIL_LIMIT; i++) decide(`source-${i}`, 'victim@example.com');
    expect(decide('source-final', 'victim@example.com').allowed).toBe(false);

    clock.advance(WINDOW_MILLIS + 1);

    expect(decide('source-after', 'victim@example.com').allowed).toBe(true);
  });
});
