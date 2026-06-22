import { timestamp, type Timestamp } from '@crowdship/ledger-kernel';

import { createInMemoryLedger, type Clock } from '../src/index.js';
import { ledgerQueryContract } from './ledger-query-contract.js';

// A strictly-increasing clock so the fake stamps each movement with a distinct,
// ordered moment — the same property the real engine's nanosecond clock has — and
// the point-in-time assertions exercise genuinely separated times rather than a
// wall clock that might return the same millisecond twice [LAW:no-ambient-temporal-coupling].
let tick = 1_700_000_000_000;
const monotonic: Clock = (): Timestamp => {
  tick += 1000;
  const t = timestamp(tick);
  if (!t.ok) throw new Error('unreachable: a positive safe integer is a valid timestamp');
  return t.value;
};

// The fake honours the same audit/query contract as the real engine, proven here in
// the fast hermetic run; the TigerBeetle integration suite proves the identical
// contract against the live engine [LAW:behavior-not-structure].
const ledger = createInMemoryLedger(monotonic);
ledgerQueryContract(() => ledger);
