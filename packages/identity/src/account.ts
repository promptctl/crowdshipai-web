import type { Timestamp } from '@crowdship/std';
import type { AccountId, Email } from './ids.js';

/**
 * The base identity record: who-is-who, and nothing else. Deliberately minimal
 * and readonly with room to grow [LAW:decomposition] [LAW:carrying-cost] — the
 * concerns that orbit an account live in sibling tickets and arrive as *new
 * fields, not a rewrite*: roles-as-capabilities (bb2.2), the builder channel
 * handle/profile (bb2.3), trust signals (bb2.4). bb2.1 owns only the account's
 * existence and its login identity.
 *
 * The credential secret is NOT here: a password hash is the adopted auth
 * library's to hold, reached through the `CredentialStore` seam, never a field
 * on the domain record [LAW:effects-at-boundaries].
 */
export interface Account {
  readonly id: AccountId;
  /** The canonical login identity. One mailbox, one account [LAW:one-source-of-truth]. */
  readonly email: Email;
  readonly createdAt: Timestamp;
}
