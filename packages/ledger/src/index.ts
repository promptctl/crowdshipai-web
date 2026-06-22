export type { LedgerView, PostingRejection } from './posting.js';
export { decidePosting } from './posting.js';

export { foldBalances, resultingBalances } from './balances.js';

export type { BalanceDrift, LedgerIntegrity } from './audit.js';
export { auditLedger, LedgerIntegrityError } from './audit.js';

export type {
  IdempotencyConflict,
  IdempotencyDecision,
} from './idempotency.js';
export { decideIdempotency } from './idempotency.js';

export type { AccountConflict, LedgerStore } from './store.js';
export { InMemoryLedgerStore } from './store.js';

export type {
  Clock,
  LedgerCapabilities,
  PostError,
  PostReceipt,
  PostRequest,
  TransactionIdSource,
} from './ledger.js';
export { createLedger, Ledger } from './ledger.js';
