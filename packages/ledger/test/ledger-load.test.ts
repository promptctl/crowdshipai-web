import { createInMemoryLedger } from '../src/index.js';
import { FAST_SCALE, ledgerLoadContract } from './ledger-load.js';

// The load invariants proven fast against the in-memory fake: conservation,
// per-account reconciliation, no-overdraft under contention, and idempotent
// double-posting — all at a small scale with no engine to stand up. The identical
// contract runs at production-velocity scale against the real TigerBeetle engine
// under integration, so the fake cannot drift from production under load
// [LAW:behavior-not-structure]. A fresh fake per test keeps the runs disjoint.
ledgerLoadContract(() => createInMemoryLedger(), FAST_SCALE);
