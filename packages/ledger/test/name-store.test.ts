import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { createInMemoryNameStore, createSqliteNameStore, SqliteNameStore } from '../src/index.js';
import { nameStoreContract } from './name-store-contract.js';

// Both implementations honour the identical seam contract — the whole point of the
// seam is that a caller cannot tell which one it holds [LAW:behavior-not-structure].
// The SQLite store runs the contract against a fresh `:memory:` database per case, so
// the fast suite stays hermetic and leaves no files behind.
nameStoreContract('InMemoryNameStore', createInMemoryNameStore);
nameStoreContract('SqliteNameStore', () => createSqliteNameStore(':memory:'));

// The two promises the durable store makes that the in-memory one cannot — and the
// reason this ticket exists: a name survives a restart, and a name one *process*
// records is resolvable by another. These need a real file: a second `DatabaseSync`
// handle on the same file is the truest in-process stand-in for a second process —
// it shares nothing in memory with the first and reaches the name only through the
// durable file. All files land in one temp dir, closed and removed at the end.
describe('SqliteNameStore durability and cross-process sharing', () => {
  const workdir = mkdtempSync(join(tmpdir(), 'crowdship-namestore-'));
  const opened: SqliteNameStore[] = [];
  const open = (file: string): SqliteNameStore => {
    const store = createSqliteNameStore(join(workdir, file));
    opened.push(store);
    return store;
  };
  afterAll(() => {
    for (const store of opened) store.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  const big = 1234567890123456789012345678901234n; // exceeds a 64-bit integer

  test('a recorded name survives the store being closed and reopened (durable)', async () => {
    // The first handle is closed by hand to model a restart, so it is not tracked for
    // the end-of-suite cleanup — closing it twice would throw.
    const first = createSqliteNameStore(join(workdir, 'durable.db'));
    await first.record(big, 'acct:mint');
    first.close();

    const reopened = open('durable.db');
    const names = await reopened.resolve([big]);
    expect(names.get(big)).toBe('acct:mint');
  });

  test('a name one handle records is resolvable through another on the same file (shared)', async () => {
    const writer = open('shared.db');
    const reader = open('shared.db');

    await writer.record(555n, 'reason:bounty-pool-hit');
    const names = await reader.resolve([555n]);
    expect(names.get(555n)).toBe('reason:bounty-pool-hit');
  });

  test('concurrent records across two handles both land — no silent lost write', async () => {
    const a = open('concurrent.db');
    const b = open('concurrent.db');

    await Promise.all([a.record(1n, 'acct:a'), b.record(2n, 'acct:b')]);
    const names = await a.resolve([1n, 2n]);
    expect(names.get(1n)).toBe('acct:a');
    expect(names.get(2n)).toBe('acct:b');
  });
});
