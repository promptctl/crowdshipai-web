import type { DatabaseSync } from 'node:sqlite';

import type { ChannelId } from '@crowdship/identity';
import {
  authorMenu,
  DEFAULT_MENU_POLICY,
  type JsonValue,
  type Menu,
  type OfferDraft,
} from '@crowdship/menu';
import { orThrow, reqStr } from '@crowdship/node-std';

import type { MenuStore } from './menu-store';

type Row = Record<string, unknown>;

/**
 * Serialize a validated {@link Menu} to the durable form: its offers as draft
 * records. Each offer's branded fields are surfaced as the same primitives the draft
 * carried — the `CoinAmount` price as a decimal string, since JSON has no bigint
 * [LAW:effects-at-boundaries]. The params are already a {@link JsonValue} and cross
 * unchanged. This is the exact inverse of {@link decodeMenu}, so a round trip yields
 * the same menu [LAW:one-source-of-truth].
 */
const encodeMenu = (menu: Menu): string =>
  JSON.stringify(
    menu.offers.map((offer) => ({
      id: offer.id as string,
      price: offer.price.toString(),
      effect: { kind: offer.effect.kind as string, params: offer.effect.params },
    })),
  );

/** Pull one structurally-required field from a decoded record, halting loudly if the
 *  durable JSON is malformed rather than coercing a missing field to a default
 *  [LAW:no-silent-failure]. */
const field = (record: Record<string, unknown>, key: string): unknown => {
  if (key in record) return record[key];
  throw new Error(`menus.offers: stored offer is missing "${key}"`);
};

/**
 * Rebuild a {@link Menu} from its durable JSON, flowing every offer back through
 * `authorMenu` — the menu's single trust boundary — so the durable form and an
 * in-memory authored menu are the same value [LAW:one-source-of-truth]. A record that
 * no longer authors (a hand-edited blank id, a non-integer price) halts loudly via
 * `orThrow`, never silently dropping an offer or a whole menu [LAW:no-silent-failure],
 * exactly as the durable channel rebuild halts on a malformed row.
 */
const decodeMenu = (raw: string): Menu => {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`menus.offers: stored value is not an array: ${raw}`);
  const drafts: OfferDraft[] = parsed.map((entry): OfferDraft => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`menus.offers: stored offer is not an object: ${JSON.stringify(entry)}`);
    }
    const record = entry as Record<string, unknown>;
    const effect = field(record, 'effect');
    if (typeof effect !== 'object' || effect === null) {
      throw new Error(`menus.offers: stored effect is not an object: ${JSON.stringify(effect)}`);
    }
    const effectRecord = effect as Record<string, unknown>;
    return {
      id: String(field(record, 'id')),
      price: BigInt(String(field(record, 'price'))),
      effect: {
        kind: String(field(effectRecord, 'kind')),
        params: field(effectRecord, 'params') as JsonValue,
      },
    };
  });
  return orThrow(authorMenu(drafts, DEFAULT_MENU_POLICY), 'menus.offers');
};

/**
 * The durable {@link MenuStore}: a builder's authored menu persisted in SQLite,
 * keyed by the stable {@link ChannelId}. It owns its own `menus` table — created
 * idempotently on construction — so the menu schema's single home is HERE in the menu
 * binding, never bolted into identity's schema, keeping `@crowdship/identity-node`
 * free of any menu concept [LAW:one-way-deps][LAW:decomposition]. It runs over the
 * shared identity DB handle, so a builder's channel and their menu live in one file
 * and one connection (the busy-timeout/WAL posture set when that handle opened applies
 * here too).
 *
 * Pure storage: the {@link Menu} written in is already valid (authored by
 * `authorMenu`), so this store only serializes and rebuilds it through that same
 * boundary — the menu rules cannot drift between this store and the in-memory one
 * [LAW:single-enforcer].
 */
export class SqliteMenuStore implements MenuStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(
      'CREATE TABLE IF NOT EXISTS menus (channel_id TEXT PRIMARY KEY, offers TEXT NOT NULL)',
    );
  }

  menuOf(channelId: ChannelId): Promise<Menu | undefined> {
    const row = this.#db.prepare('SELECT offers FROM menus WHERE channel_id = ?').get(channelId);
    return Promise.resolve(row === undefined ? undefined : decodeMenu(reqStr(row as Row, 'offers')));
  }

  setMenu(channelId: ChannelId, menu: Menu): Promise<void> {
    // Upsert: a builder re-authoring replaces their whole menu in one write, never a
    // second row for one channel [LAW:one-source-of-truth].
    this.#db
      .prepare(
        'INSERT INTO menus (channel_id, offers) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET offers = excluded.offers',
      )
      .run(channelId, encodeMenu(menu));
    return Promise.resolve();
  }
}
