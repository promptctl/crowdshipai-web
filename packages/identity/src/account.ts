import type { Timestamp } from '@crowdship/std';
import type { AccountId, Email } from './ids.js';
import type { RoleSet } from './roles.js';

/**
 * The base identity record: who-is-who, and what they may do. Deliberately
 * minimal and readonly with room to grow [LAW:decomposition] [LAW:carrying-cost]
 * — the concerns that orbit an account arrive as *new fields, not a rewrite*:
 * `roles` is bb2.2's addition; the builder channel handle/profile (bb2.3) and
 * trust signals (bb2.4) will land the same way. bb2.1 owned only the account's
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
  /**
   * What this account may do, as capability data on the one account — never a
   * separate user subtype [LAW:one-type-per-behavior]. One person can build,
   * back, and recruit at once: that is one account holding three capabilities,
   * not three users.
   */
  readonly roles: RoleSet;
}
