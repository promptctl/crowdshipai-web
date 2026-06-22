import { describe, expect, it } from 'vitest';

import { err, ok } from '@crowdship/std';
import type { SessionError } from '@crowdship/identity';

import { resolveRequest } from '../src/server/auth-gate';
import { anEmail, loginGrant, recordingAuthService } from './support';

/**
 * The single authentication boundary's framework-free core. These tests pin the
 * security-shaped behavior that makes revocation real: a request resolves against
 * the DOMAIN session every call, and anything short of a live session is "not
 * authenticated" — never silently waved through [LAW:no-silent-failure]. The two
 * short-circuit cases (no token, malformed token) must NOT consult the resolver.
 */
describe('resolveRequest — the single authentication boundary', () => {
  it('returns null for a request with no carried token, never touching the resolver', async () => {
    const { service, calls } = recordingAuthService({});
    expect(await resolveRequest(service, undefined)).toBeNull();
    expect(calls.resolveSession).toHaveLength(0);
  });

  it('returns null for a malformed carried token, never touching the resolver', async () => {
    const { service, calls } = recordingAuthService({});
    expect(await resolveRequest(service, '   ')).toBeNull();
    expect(calls.resolveSession).toHaveLength(0);
  });

  it('resolves a live session to its principal', async () => {
    const grant = loginGrant(anEmail('builder@example.com'));
    const principal = { account: grant.account, session: grant.session };
    const { service, calls } = recordingAuthService({ resolveSession: ok(principal) });

    expect(await resolveRequest(service, 'a-live-token')).toEqual(principal);
    expect(calls.resolveSession).toHaveLength(1);
  });

  it.each([{ kind: 'unknown' }, { kind: 'expired' }] satisfies SessionError[])(
    'returns null when the resolver reports a dead session (%j)',
    async (reason) => {
      const { service, calls } = recordingAuthService({ resolveSession: err(reason) });

      expect(await resolveRequest(service, 'a-dead-token')).toBeNull();
      expect(calls.resolveSession).toHaveLength(1);
    },
  );
});
