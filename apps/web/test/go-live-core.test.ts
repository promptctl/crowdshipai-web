import { accountId, roleSet, type Principal } from '@crowdship/identity';
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

/** An open-publish recorder standing in for the provider — the one effect this core has,
 *  captured as data so the test reads exactly which slug (if any) ingest was opened for. */
const recorder = (handoff: PublishHandoff) => {
  const slugs: string[] = [];
  return {
    slugs,
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
  ownChannelSlug: async () => slug,
  openPublish: rec.openPublish,
});

/** Deps for a signed-in account that has claimed no channel. */
const channelless = (subject: Principal | null, rec: ReturnType<typeof recorder>): GoLiveDeps => ({
  principal: subject,
  ownChannelSlug: async () => null,
  openPublish: rec.openPublish,
});

describe('performGoLive — a builder takes their channel live', () => {
  it('refuses an unauthenticated attempt and opens no ingest', async () => {
    const rec = recorder(READY);
    expect(await performGoLive(channelless(null, rec))).toEqual({ kind: 'must-authenticate' });
    expect(rec.slugs).toEqual([]);
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
