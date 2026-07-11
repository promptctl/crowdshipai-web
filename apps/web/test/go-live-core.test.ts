import { accountId, roleSet, type Principal } from '@crowdship/identity';
import { policyRuleId, type PolicyDecision } from '@crowdship/moderation';
import { type Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import type { PublishHandoff } from '../src/data/go-live-result';
import { performGoLive, type GoLiveDeps } from '../src/server/go-live-core';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const principal = (id: string): Principal => ({ id: must(accountId(id)), roles: roleSet([]) });

const READY: PublishHandoff = { kind: 'ready', connection: { url: 'wss://sfu.example', token: 'jwt' } };

const ALLOWED: PolicyDecision = { outcome: 'allowed' };
const barredBy = (reason: string): PolicyDecision => ({
  outcome: 'denied',
  violations: [{ kind: 'violation', rule: must(policyRuleId('conduct')), reason }],
});

/** An open-publish recorder standing in for the provider — the one effect this core has,
 *  captured as data so the test reads exactly which slug (if any) ingest was opened for.
 *  It also records every conduct screen, so a test pins both that the boundary was
 *  consulted and that a refused actor never reaches the provider. */
const recorder = (handoff: PublishHandoff, conduct: PolicyDecision = ALLOWED) => {
  const slugs: string[] = [];
  const screened: Principal[] = [];
  return {
    slugs,
    screened,
    screenConduct: async (actor: Principal): Promise<PolicyDecision> => {
      screened.push(actor);
      return conduct;
    },
    openPublish: async (slug: string): Promise<PublishHandoff> => {
      slugs.push(slug);
      return handoff;
    },
  };
};

/** Deps for a builder who holds a channel with the given slug. The slug is what the
 *  SERVER reads from the principal — never a client value — so the test pins that the
 *  room opened is the builder's own. */
const asBuilder = (
  subject: Principal | null,
  slug: string,
  rec: ReturnType<typeof recorder>,
): GoLiveDeps => ({
  principal: subject,
  screenConduct: rec.screenConduct,
  ownChannelSlug: async () => slug,
  openPublish: rec.openPublish,
});

/** Deps for a signed-in account that has claimed no channel. */
const channelless = (subject: Principal | null, rec: ReturnType<typeof recorder>): GoLiveDeps => ({
  principal: subject,
  screenConduct: rec.screenConduct,
  ownChannelSlug: async () => null,
  openPublish: rec.openPublish,
});

describe('performGoLive — a builder takes their channel live', () => {
  it('refuses an unauthenticated attempt and opens no ingest', async () => {
    const rec = recorder(READY);
    expect(await performGoLive(channelless(null, rec))).toEqual({ kind: 'must-authenticate' });
    expect(rec.slugs).toEqual([]);
    // There is no actor to screen: the boundary is never consulted about no one.
    expect(rec.screened).toEqual([]);
  });

  it('refuses a barred builder with the bar’s own reason, before any ingest opens', async () => {
    const rec = recorder(READY, barredBy('suspended for scamming a bounty'));
    expect(await performGoLive(asBuilder(principal('acct-banned'), 'scam-channel', rec))).toEqual({
      kind: 'barred',
      reason: 'suspended for scamming a bounty',
    });
    // The refusal happened at the policy boundary — the provider was never reached.
    expect(rec.slugs).toEqual([]);
  });

  it('screens the PROVEN actor — the principal auth resolved, never a client claim', async () => {
    const rec = recorder(READY);
    const mara = principal('acct-mara');
    await performGoLive(asBuilder(mara, 'ffmpeg-witch', rec));
    expect(rec.screened).toEqual([mara]);
  });

  it('refuses a signed-in account with no channel and opens no ingest', async () => {
    const rec = recorder(READY);
    expect(await performGoLive(channelless(principal('acct-1'), rec))).toEqual({ kind: 'no-channel' });
    expect(rec.slugs).toEqual([]);
  });

  it("opens ingest for the builder's OWN channel slug and hands back the credential", async () => {
    const rec = recorder(READY);
    expect(await performGoLive(asBuilder(principal('acct-mara'), 'ffmpeg-witch', rec))).toEqual(READY);
    // The slug ingest was opened for is the one the SERVER read from the principal.
    expect(rec.slugs).toEqual(['ffmpeg-witch']);
  });

  it('passes the provider outcome through verbatim — no-sfu', async () => {
    const handoff: PublishHandoff = { kind: 'no-sfu' };
    const rec = recorder(handoff);
    expect(await performGoLive(asBuilder(principal('acct-1'), 'dex', rec))).toEqual(handoff);
    expect(rec.slugs).toEqual(['dex']);
  });

  it('passes the provider outcome through verbatim — already-live', async () => {
    const handoff: PublishHandoff = { kind: 'already-live' };
    const rec = recorder(handoff);
    expect(await performGoLive(asBuilder(principal('acct-1'), 'dex', rec))).toEqual(handoff);
  });

  it('passes the provider outcome through verbatim — provider-unavailable', async () => {
    const handoff: PublishHandoff = { kind: 'provider-unavailable' };
    const rec = recorder(handoff);
    expect(await performGoLive(asBuilder(principal('acct-1'), 'dex', rec))).toEqual(handoff);
  });
});
