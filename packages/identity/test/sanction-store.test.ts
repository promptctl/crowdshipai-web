import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  accountId,
  effectiveSanction,
  InMemorySanctionStore,
  type AccountId,
  type Sanction,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const at = (ms: number): Timestamp => must(timestamp(ms));

const alice: AccountId = must(accountId('acct-alice'));
const bob: AccountId = must(accountId('acct-bob'));

const ban: Sanction = { reason: 'banned', issuedAt: at(1_000), scope: { kind: 'permanent' } };
const suspend: Sanction = { reason: 'suspended', issuedAt: at(1_000), scope: { kind: 'until', until: at(9_000) } };

describe('InMemorySanctionStore', () => {
  it('returns no sanctions for an account that has none', async () => {
    const store = new InMemorySanctionStore();
    expect(await store.forAccount(alice)).toEqual([]);
  });

  it('records a sanction and reads it back against the right account', async () => {
    const store = new InMemorySanctionStore();
    await store.record(alice, ban);

    expect(await store.forAccount(alice)).toEqual([ban]);
    expect(await store.forAccount(bob)).toEqual([]);
  });

  it('appends — every recorded sanction is kept, in record order', async () => {
    const store = new InMemorySanctionStore();
    await store.record(alice, suspend);
    await store.record(alice, ban);

    expect(await store.forAccount(alice)).toEqual([suspend, ban]);
  });

  it('hands back a snapshot — mutating the returned list cannot corrupt the log', async () => {
    const store = new InMemorySanctionStore();
    await store.record(alice, ban);

    const snapshot = await store.forAccount(alice);
    (snapshot as Sanction[]).push(suspend);

    expect(await store.forAccount(alice)).toEqual([ban]);
  });

  it('feeds effectiveSanction — the governing bar derives from the stored log', async () => {
    const store = new InMemorySanctionStore();
    await store.record(alice, { reason: 'old', issuedAt: at(1_000), scope: { kind: 'until', until: at(2_000) } });
    await store.record(alice, ban);

    const governing = effectiveSanction(await store.forAccount(alice), at(5_000));
    expect(governing?.scope.kind).toBe('permanent');
  });
});
