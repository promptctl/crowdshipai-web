import type { Clock, Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';
import type { Account } from './account.js';
import type { Channel, ChannelProfile, Handle } from './channel.js';
import type { ClaimError, EditProfileError, RenameError, RoleChangeError } from './errors.js';
import type { AccountId, ChannelId } from './ids.js';
import type { Role } from './roles.js';
import type { ChannelStore } from './channel-store.js';

/**
 * The capability of minting opaque channel ids. Separate from the auth
 * {@link IdMint} so the channel service asks for exactly what it needs and no
 * adapter is forced to mint channel ids it never uses [LAW:decomposition]. An id
 * need only be unique, not unguessable — it is not a bearer secret.
 */
export interface ChannelIdMint {
  newChannelId(): ChannelId;
}

/**
 * The narrow slice of identity the channel service depends on: the ability to
 * grant a capability to an account [LAW:locality-or-seam]. Claiming a channel
 * grants the `builder` role, so the channel service needs *this and only this*
 * from identity — not the whole auth lifecycle. The dependency points one way
 * (channel → identity) with no cycle [LAW:one-way-deps]; `AuthService` satisfies
 * this port structurally, so production wires the real service in and tests wire a
 * fake without either knowing about the other.
 */
export interface RoleGranter {
  grantRole(accountId: AccountId, role: Role): Promise<Result<Account, RoleChangeError>>;
}

/**
 * What a successful claim surrenders: the new channel and the account that now
 * holds the `builder` capability. Both are returned because both changed — the
 * caller (an edge handler, then the channel page) sees the public identity *and*
 * the granted capability in one value, with no second lookup [LAW:one-source-of-truth].
 */
export interface ChannelClaim {
  readonly channel: Channel;
  readonly account: Account;
}

/**
 * The builder-channel seam: claim a channel, look one up (by id, handle, or
 * owner), rename it, and edit its profile — the whole channel-identity lifecycle
 * as one port [LAW:locality-or-seam]. Inputs are already-validated domain values
 * (`Handle`, `ChannelProfile`), never raw strings: parsing untrusted input is the
 * edge's job, so by the time a call reaches this port the trust boundary has been
 * crossed [LAW:single-enforcer].
 *
 * Authorization — *who* may claim, rename, or edit — is deliberately NOT here, the
 * same choice `grantRole` makes: it lives at the single auth gate (bb2.5), which
 * reads `channel.ownerId` (via the lookups below) to authorize the request. These
 * methods trust that the gate already authorized the caller.
 */
export interface ChannelService {
  /**
   * Claim a builder channel for an account, granting it the `builder` capability.
   * `ownerId` is the data of who the channel belongs to (the authenticated
   * account), not an authz check. Idempotent on the role; not on the channel —
   * a second claim by an owner who already has one is a named failure.
   */
  claimChannel(
    ownerId: AccountId,
    handle: Handle,
    profile: ChannelProfile,
  ): Promise<Result<ChannelClaim, ClaimError>>;

  channelById(id: ChannelId): Promise<Channel | undefined>;
  channelByHandle(handle: Handle): Promise<Channel | undefined>;
  channelByOwner(ownerId: AccountId): Promise<Channel | undefined>;

  /** Rename the public handle. The stable {@link ChannelId} is unchanged, so no reference downstream breaks. */
  rename(id: ChannelId, handle: Handle): Promise<Result<Channel, RenameError>>;

  /** Replace the public profile (display name, bio, and whatever it grows to hold). */
  editProfile(id: ChannelId, profile: ChannelProfile): Promise<Result<Channel, EditProfileError>>;
}

/** The injected world the channel service runs against — every effect and store it needs, declared. */
export interface ChannelServiceDeps {
  readonly clock: Clock;
  readonly ids: ChannelIdMint;
  /** How the builder capability is granted on claim — the narrow identity slice [LAW:locality-or-seam]. */
  readonly roles: RoleGranter;
  /** Where channels live — the one swappable storage axis [LAW:locality-or-seam]. */
  readonly store: ChannelStore;
}

/**
 * THE implementation of the channel lifecycle — the single home of the claim
 * rules: handle uniqueness, one channel per account (for now), and "claiming a
 * channel is what grants the builder capability". These live here ONCE and run
 * over any {@link ChannelStore}, so the in-memory skeleton and the durable SQLite
 * store are the same code path with a different store [LAW:single-enforcer].
 */
export class StandardChannelService implements ChannelService {
  readonly #deps: ChannelServiceDeps;

  constructor(deps: ChannelServiceDeps) {
    this.#deps = deps;
  }

  async claimChannel(
    ownerId: AccountId,
    handle: Handle,
    profile: ChannelProfile,
  ): Promise<Result<ChannelClaim, ClaimError>> {
    // Cheap precondition checks first, before the role grant that would otherwise
    // leave a granted capability with no channel behind it.
    if ((await this.#deps.store.channelByOwner(ownerId)) !== undefined) {
      return err({ kind: 'already-has-channel' });
    }
    if ((await this.#deps.store.channelByHandle(handle)) !== undefined) {
      return err({ kind: 'handle-taken' });
    }
    // Grant the builder capability through identity's single write path, then
    // insert the channel. The two writes are NOT one transaction (the role lives
    // behind the account store, the channel behind this one), so this service is
    // the explicit owner of their ordering [LAW:no-ambient-temporal-coupling], and
    // the order is chosen so any partial failure self-heals. Grant first: if the
    // owner is not a real account the grant fails as a value before any channel is
    // minted [LAW:no-silent-failure]. If the insert then throws (the store's loud
    // UNIQUE backstop on a race, or IO), the residue is an account holding builder
    // with no channel — inert (the capability does nothing without a channel) and
    // self-healing: a retried claim re-grants idempotently and re-inserts, or
    // surfaces the real conflict. The harmful residue — a channel whose owner
    // lacks the capability — is made unreachable by granting first. The grant
    // failure value is forwarded, not collapsed: ClaimError is a superset of
    // RoleChangeError, so a new grant-failure variant becomes a compile error here
    // until it is handled, never a silently mislabeled one [LAW:no-silent-failure].
    const granted = await this.#deps.roles.grantRole(ownerId, 'builder');
    if (!granted.ok) return err(granted.error);
    const channel: Channel = {
      id: this.#deps.ids.newChannelId(),
      ownerId,
      handle,
      profile,
      createdAt: this.#deps.clock.now(),
    };
    await this.#deps.store.insertChannel(channel);
    return ok({ channel, account: granted.value });
  }

  channelById(id: ChannelId): Promise<Channel | undefined> {
    return this.#deps.store.channelById(id);
  }

  channelByHandle(handle: Handle): Promise<Channel | undefined> {
    return this.#deps.store.channelByHandle(handle);
  }

  channelByOwner(ownerId: AccountId): Promise<Channel | undefined> {
    return this.#deps.store.channelByOwner(ownerId);
  }

  async rename(id: ChannelId, handle: Handle): Promise<Result<Channel, RenameError>> {
    const existing = await this.#deps.store.channelById(id);
    if (existing === undefined) return err({ kind: 'no-such-channel' });
    const holder = await this.#deps.store.channelByHandle(handle);
    // Renaming to the handle this channel already holds is an idempotent no-op
    // success; renaming to one another channel holds is taken.
    if (holder !== undefined && holder.id !== id) return err({ kind: 'handle-taken' });
    await this.#deps.store.updateHandle(id, handle);
    return ok({ ...existing, handle });
  }

  async editProfile(
    id: ChannelId,
    profile: ChannelProfile,
  ): Promise<Result<Channel, EditProfileError>> {
    const existing = await this.#deps.store.channelById(id);
    if (existing === undefined) return err({ kind: 'no-such-channel' });
    await this.#deps.store.updateProfile(id, profile);
    return ok({ ...existing, profile });
  }
}
