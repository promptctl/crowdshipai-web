import { afterAll, beforeAll, expect, test } from 'vitest';

import { createTigerBeetleLedger, type Ledger, type LedgerQuery } from '../src/index.js';
import {
  INTEGRATION_SCALE,
  ledgerLoadContract,
  loadTimeoutMs,
  runVelocityStorm,
  SUSTAINED_TARGET_PER_SEC,
} from '../test/ledger-load.js';
import { startTigerBeetle, type RunningTigerBeetle } from './tigerbeetle-harness.js';

// The load test of TigerBeetle through the `Ledger` seam at production coin velocity
// (crowdshipai-ledger-y38.7). The engine is the throughput engine; this proves our
// thin adapter neither corrupts money under sustained concurrent fire nor bottlenecks
// the engine it fronts. A live single-replica cluster is booted once for the file.
let running: RunningTigerBeetle;
let ledger: Ledger & LedgerQuery;

beforeAll(async () => {
  running = await startTigerBeetle();
  ledger = createTigerBeetleLedger(running.config);
});

afterAll(async () => {
  await ledger.close();
  await running.stop();
});

// The identical money invariants the in-memory fake passes in the fast suite, now
// proven against the real engine at production-velocity scale: conservation,
// per-account reconciliation, no-overdraft under contention, idempotent double-posts
// [LAW:behavior-not-structure].
ledgerLoadContract(() => ledger, INTEGRATION_SCALE);

// The throughput gate — integration-only because timing is only meaningful against
// the real engine [LAW:verifiable-goals]. A fresh storm is driven and timed; the
// achieved rate must clear the production-velocity floor. The measured rate is
// surfaced, never swallowed, so a passing-but-slow run is still visible
// [LAW:no-silent-failure].
test('sustains the production coin velocity floor', async () => {
  const report = await runVelocityStorm(ledger, 'velocity-', INTEGRATION_SCALE);

  // The measured rate is a load test's product, surfaced so a passing-but-slow run
  // stays visible rather than hidden behind a green check [LAW:no-silent-failure].
  console.log(
    `[load] ${report.succeeded}/${report.attempted} posts in ${report.durationMs.toFixed(0)}ms ` +
      `= ${report.achievedPerSec.toFixed(0)}/s (floor ${SUSTAINED_TARGET_PER_SEC}/s)`,
  );

  expect(report.failures).toBe(0);
  expect(report.achievedPerSec).toBeGreaterThanOrEqual(SUSTAINED_TARGET_PER_SEC);
}, loadTimeoutMs(INTEGRATION_SCALE));
