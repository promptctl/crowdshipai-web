import type { DatabaseSync } from 'node:sqlite';
import {
  accountId,
  bio,
  channelId,
  displayName,
  handle,
  verificationStatus,
  type AccountId,
  type Channel,
  type ChannelId,
  type ChannelProfile,
  type ChannelStore,
  type Handle,
  type VerificationStatus,
} from '@crowdship/identity';
import { timestamp } from '@crowdship/std';
import { orThrow, reqInt, reqStr } from './internal.js';

type Row = Record<string, unknown>;

const SELECT =
  'SELECT id, owner_id, handle, display_name, bio, verification, created_at FROM channels';

/**
 * Rebuild a {@link Channel} from its row, halting loudly if the durable record is
 * malformed [LAW:no-silent-failure] — a hand-edited handle that no longer parses,
 * a non-integer timestamp, are surfaced, never silently coerced. Each column flows
 * back through the same trust-boundary constructor that admitted it on the way in,
 * so the durable form and the in-memory form are the same value [LAW:one-source-of-truth].
 */
const toChannel = (row: Row): Channel => ({
  id: orThrow(channelId(reqStr(row, 'id')), 'channels.id'),
  ownerId: orThrow(accountId(reqStr(row, 'owner_id')), 'channels.owner_id'),
  handle: orThrow(handle(reqStr(row, 'handle')), 'channels.handle'),
  profile: {
    displayName: orThrow(displayName(reqStr(row, 'display_name')), 'channels.display_name'),
    bio: orThrow(bio(reqStr(row, 'bio')), 'channels.bio'),
  },
  verification: orThrow(verificationStatus(reqStr(row, 'verification')), 'channels.verification'),
  createdAt: orThrow(timestamp(reqInt(row, 'created_at')), 'channels.created_at'),
});

/**
 * The durable {@link ChannelStore}: builder channels persisted in SQLite. Pure
 * storage — every claim rule (handle uniqueness, one channel per account,
 * granting the builder capability) stays in `StandardChannelService` above the
 * seam, so this store and the in-memory one are interchangeable and the rules
 * cannot drift between them [LAW:single-enforcer].
 *
 * The `owner_id` and `handle` UNIQUE constraints are loud backstops — the service
 * has already decided both are free, but if two writers ever raced past those
 * checks the insert throws rather than silently minting a second channel for one
 * account or one handle [LAW:no-silent-failure].
 */
export class SqliteChannelStore implements ChannelStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  insertChannel(channel: Channel): Promise<void> {
    this.#db
      .prepare(
        'INSERT INTO channels (id, owner_id, handle, display_name, bio, verification, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        channel.id,
        channel.ownerId,
        channel.handle,
        channel.profile.displayName,
        channel.profile.bio,
        channel.verification,
        channel.createdAt,
      );
    return Promise.resolve();
  }

  channelById(id: ChannelId): Promise<Channel | undefined> {
    const row = this.#db.prepare(`${SELECT} WHERE id = ?`).get(id);
    return Promise.resolve(row === undefined ? undefined : toChannel(row));
  }

  channelByHandle(value: Handle): Promise<Channel | undefined> {
    const row = this.#db.prepare(`${SELECT} WHERE handle = ?`).get(value);
    return Promise.resolve(row === undefined ? undefined : toChannel(row));
  }

  channelByOwner(ownerId: AccountId): Promise<Channel | undefined> {
    const row = this.#db.prepare(`${SELECT} WHERE owner_id = ?`).get(ownerId);
    return Promise.resolve(row === undefined ? undefined : toChannel(row));
  }

  updateHandle(id: ChannelId, value: Handle): Promise<void> {
    // Row-targeted: an absent channel changes nothing rather than being silently
    // created [LAW:no-silent-failure]. The service guarantees existence first.
    this.#db.prepare('UPDATE channels SET handle = ? WHERE id = ?').run(value, id);
    return Promise.resolve();
  }

  updateProfile(id: ChannelId, profile: ChannelProfile): Promise<void> {
    this.#db
      .prepare('UPDATE channels SET display_name = ?, bio = ? WHERE id = ?')
      .run(profile.displayName, profile.bio, id);
    return Promise.resolve();
  }

  updateVerification(id: ChannelId, status: VerificationStatus): Promise<void> {
    // Row-targeted, like the other updates: an absent channel changes nothing
    // [LAW:no-silent-failure]. The service guarantees existence first.
    this.#db.prepare('UPDATE channels SET verification = ? WHERE id = ?').run(status, id);
    return Promise.resolve();
  }
}
