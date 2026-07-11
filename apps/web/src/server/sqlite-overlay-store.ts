import type { DatabaseSync } from 'node:sqlite';

import type { ChannelId } from '@crowdship/identity';
import { reqStr } from '@crowdship/node-std';

import { overlayStyleFrom, type OverlayStyle } from '../data/overlay-style';
import type { OverlayStore } from './overlay-store';

type Row = Record<string, unknown>;

/**
 * Rebuild an {@link OverlayStyle} from its durable JSON, flowing it back through the
 * ONE style validator — the same line the authoring edge and the wire parse draw —
 * so the durable form and an authored style are the same value
 * [LAW:one-source-of-truth]. A row that no longer validates (a hand-edited placement,
 * an out-of-bounds hue) halts loudly rather than silently coercing to a default look
 * the builder never chose [LAW:no-silent-failure], exactly as the durable menu
 * rebuild halts on a malformed offer.
 */
const decodeStyle = (raw: string): OverlayStyle => {
  const style = overlayStyleFrom(JSON.parse(raw));
  if (style === null) throw new Error(`overlays.style: stored value is not an overlay style: ${raw}`);
  return style;
};

/**
 * The durable {@link OverlayStore}: a builder's authored overlay style persisted in
 * SQLite, keyed by the stable {@link ChannelId} — the overlay twin of
 * {@link import('./sqlite-menu-store').SqliteMenuStore}. It owns its own `overlays`
 * table — created idempotently on construction — so the overlay schema's single home
 * is HERE in the overlay binding, never bolted into identity's schema
 * [LAW:one-way-deps][LAW:decomposition]. It runs over the shared identity DB handle,
 * so a builder's channel, their menu, and their overlay live in one file and one
 * connection.
 */
export class SqliteOverlayStore implements OverlayStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(
      'CREATE TABLE IF NOT EXISTS overlays (channel_id TEXT PRIMARY KEY, style TEXT NOT NULL)',
    );
  }

  styleOf(channelId: ChannelId): Promise<OverlayStyle | undefined> {
    const row = this.#db.prepare('SELECT style FROM overlays WHERE channel_id = ?').get(channelId);
    return Promise.resolve(row === undefined ? undefined : decodeStyle(reqStr(row as Row, 'style')));
  }

  setStyle(channelId: ChannelId, style: OverlayStyle): Promise<void> {
    // Upsert: a builder restyling replaces their whole style in one write, never a
    // second row for one channel [LAW:one-source-of-truth].
    this.#db
      .prepare(
        'INSERT INTO overlays (channel_id, style) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET style = excluded.style',
      )
      .run(channelId, JSON.stringify(style));
    return Promise.resolve();
  }
}
