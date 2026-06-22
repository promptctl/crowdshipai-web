export type { Brand } from './brand.js';

export type { Result } from './result.js';
export { err, ok } from './result.js';

// The coin unit now lives in foundation (@crowdship/std); re-exported here so
// the kernel's public surface is unchanged for existing consumers
// [LAW:one-source-of-truth].
export type { CoinAmount, CoinAmountError } from '@crowdship/std';
export { coinAmount } from '@crowdship/std';

export type {
  AccountId,
  IdempotencyKey,
  IdError,
  Timestamp,
  TimestampError,
  TransactionId,
  TransactionReason,
} from './ids.js';
export { accountId, idempotencyKey, timestamp, transactionId, transactionReason } from './ids.js';

export type { Account, AccountKind } from './account.js';
export { mayGoNegative } from './account.js';

export type { Transfer, TransferError } from './transfer.js';
export { transfer } from './transfer.js';
