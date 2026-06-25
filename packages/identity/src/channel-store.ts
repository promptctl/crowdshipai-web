import type { Channel, ChannelProfile, Handle, VerificationStatus } from './channel.js';
import type { AccountId, ChannelId } from './ids.js';

/**
 * Persistence for builder channels, expressed as the smallest seam the channel
 * logic needs [LAW:locality-or-seam] — and the only axis along which channel
 * storage varies. The claim rules (handle uniqueness, one channel per account,
 * granting the builder capability) live once in the service above this seam, so
 * an in-memory map and a durable SQLite table are two *stores*, never two
 * services [LAW:single-enforcer] — the same shape {@link AuthStore} follows.
 *
 * The channel registry (keyed by {@link ChannelId}) is the authoritative record;
 * lookup-by-handle and lookup-by-owner are derived indexes into it the store
 * owns, never second sources of truth [LAW:one-source-of-truth]. `handle` is the
 * one mutable identity axis and `profile` the one mutable presentation axis, so
 * the store exposes updating *only* those — never a general overwrite that could
 * silently change a channel's id, owner, or creation time [LAW:locality-or-seam].
 *
 * Every method is async so a real database sits behind this seam unchanged
 * [LAW:effects-at-boundaries]. Write serialization is owned by the boundary above
 * (single-actor, like the auth lifecycle); a durable adapter MAY add UNIQUE
 * backstops on handle and owner, failing loudly rather than silently overwriting
 * [LAW:no-silent-failure].
 */
export interface ChannelStore {
  /**
   * Record a new channel. The service has already established the handle is free
   * and the owner has no channel; a store MAY enforce those as loud UNIQUE
   * backstops, never by silently overwriting an existing row.
   */
  insertChannel(channel: Channel): Promise<void>;
  channelById(id: ChannelId): Promise<Channel | undefined>;
  channelByHandle(handle: Handle): Promise<Channel | undefined>;
  channelByOwner(ownerId: AccountId): Promise<Channel | undefined>;
  /**
   * Every channel in the registry — the roster read discovery surfaces builders
   * through. A read of the same authoritative record the by-id/handle/owner lookups
   * index into, never a second source [LAW:one-source-of-truth]. Order is the
   * store's natural one; the canonical browse ordering is the catalog seam's concern,
   * applied above this read [LAW:decomposition].
   */
  allChannels(): Promise<readonly Channel[]>;
  /** Rename: replace only the handle. The service guarantees the new handle is free. */
  updateHandle(id: ChannelId, handle: Handle): Promise<void>;
  /** Replace only the public profile. The service guarantees the channel exists. */
  updateProfile(id: ChannelId, profile: ChannelProfile): Promise<void>;
  /**
   * Set only the platform verification status — a distinct write from
   * {@link updateProfile} because it has a distinct owner (platform, not builder)
   * [LAW:decomposition]. The service guarantees the channel exists.
   */
  updateVerification(id: ChannelId, status: VerificationStatus): Promise<void>;
}

/**
 * The reference {@link ChannelStore}: an in-memory channel registry with derived
 * handle and owner indexes. It is the walking-skeleton/test implementation; a
 * durable store (the SQLite adapter in `@crowdship/identity-node`) swaps in behind
 * the same seam without touching the channel service.
 *
 * `#channels` is the authoritative registry; `#idByHandle` and `#idByOwner` are
 * derived indexes kept in lockstep with it, never second sources of truth
 * [LAW:one-source-of-truth]. A rename rewrites the handle index in the same step
 * it rewrites the record, so the two can never disagree.
 */
export class InMemoryChannelStore implements ChannelStore {
  readonly #channels = new Map<ChannelId, Channel>();
  readonly #idByHandle = new Map<Handle, ChannelId>();
  readonly #idByOwner = new Map<AccountId, ChannelId>();

  insertChannel(channel: Channel): Promise<void> {
    this.#channels.set(channel.id, channel);
    this.#idByHandle.set(channel.handle, channel.id);
    this.#idByOwner.set(channel.ownerId, channel.id);
    return Promise.resolve();
  }

  channelById(id: ChannelId): Promise<Channel | undefined> {
    return Promise.resolve(this.#channels.get(id));
  }

  channelByHandle(handle: Handle): Promise<Channel | undefined> {
    const id = this.#idByHandle.get(handle);
    return Promise.resolve(id === undefined ? undefined : this.#channels.get(id));
  }

  channelByOwner(ownerId: AccountId): Promise<Channel | undefined> {
    const id = this.#idByOwner.get(ownerId);
    return Promise.resolve(id === undefined ? undefined : this.#channels.get(id));
  }

  allChannels(): Promise<readonly Channel[]> {
    return Promise.resolve([...this.#channels.values()]);
  }

  updateHandle(id: ChannelId, handle: Handle): Promise<void> {
    const channel = this.#channels.get(id);
    // The service has established the channel exists; a missing one is a no-op
    // rather than a silently-minted record [LAW:no-silent-failure].
    if (channel !== undefined) {
      this.#idByHandle.delete(channel.handle);
      this.#idByHandle.set(handle, id);
      this.#channels.set(id, { ...channel, handle });
    }
    return Promise.resolve();
  }

  updateProfile(id: ChannelId, profile: ChannelProfile): Promise<void> {
    const channel = this.#channels.get(id);
    if (channel !== undefined) this.#channels.set(id, { ...channel, profile });
    return Promise.resolve();
  }

  updateVerification(id: ChannelId, status: VerificationStatus): Promise<void> {
    const channel = this.#channels.get(id);
    // An absent channel changes nothing rather than being silently created
    // [LAW:no-silent-failure]; the service guarantees existence first.
    if (channel !== undefined) this.#channels.set(id, { ...channel, verification: status });
    return Promise.resolve();
  }
}
