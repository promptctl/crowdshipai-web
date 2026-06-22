import { afterAll, beforeAll } from 'vitest';

import { createTigerBeetleLedger, type Ledger } from '../src/index.js';
import { ledgerContract } from '../test/ledger-contract.js';
import { startTigerBeetle, type RunningTigerBeetle } from './tigerbeetle-harness.js';

// The real engine, proven against the identical contract the in-memory fake passes
// in the fast suite. This is where "the money rules are TigerBeetle's" is verified
// against TigerBeetle itself — no-overdraft, idempotent replay, conflict refusal,
// atomic multi-leg movements — so the fake can never silently drift from production
// [LAW:behavior-not-structure]. A live cluster is booted once for the file.
let running: RunningTigerBeetle;
let ledger: Ledger;

beforeAll(async () => {
  running = await startTigerBeetle();
  ledger = createTigerBeetleLedger(running.config);
});

afterAll(async () => {
  await ledger.close();
  await running.stop();
});

ledgerContract(() => ledger);
