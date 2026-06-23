import type { DatabaseSync } from 'node:sqlite';
import type { AccountId, Sanction, SanctionScope, SanctionStore } from '@crowdship/identity';
import { show, timestamp } from '@crowdship/std';
import { orThrow, reqInt, reqStr } from '@crowdship/node-std';

type Row = Record<string, unknown>;

const SELECT = 'SELECT reason, issued_at, scope_kind, until FROM sanctions';

/**
 * Rebuild a {@link SanctionScope} from its denormalized columns. SQLite has no sum
 * type, so the closed two-arm union is stored as a discriminant (`scope_kind`) plus a
 * nullable `until` payload; this reverses that exactly, dispatching on the discriminant
 * and reconstructing the precise arm [LAW:types-are-the-program]. Any `scope_kind` that
 * is neither arm, or a timed scope whose `until` is missing, is corruption surfaced
 * loudly — never a guessed permanence or a coerced deadline [LAW:no-silent-failure].
 */
const toScope = (row: Row): SanctionScope => {
  const kind = reqStr(row, 'scope_kind');
  // The arms are symmetric: a permanent bar carries no deadline and a timed one
  // always carries one, so each rejects the other's payload shape. A permanent row
  // holding an `until` is as corrupt as a timed row missing one — surfaced, never
  // silently dropped to a plausible-but-wrong sanction [LAW:no-silent-failure].
  if (kind === 'permanent') {
    if (row['until'] !== null) {
      throw new Error(`identity-node: sanctions.until set on a permanent scope: ${show(row['until'])}`);
    }
    return { kind: 'permanent' };
  }
  if (kind === 'until') return { kind: 'until', until: orThrow(timestamp(reqInt(row, 'until')), 'sanctions.until') };
  throw new Error(`identity-node: sanctions.scope_kind is not a known scope: ${show(kind)}`);
};

/**
 * Rebuild a {@link Sanction} from its row, each column flowing back through the same
 * trust-boundary constructor that admitted it, so the durable form and the in-memory
 * form are the same value [LAW:one-source-of-truth]. A non-integer `issued_at` or an
 * unparseable scope halts loudly rather than reading back a malformed enforcement
 * record [LAW:no-silent-failure].
 */
const toSanction = (row: Row): Sanction => ({
  reason: reqStr(row, 'reason'),
  issuedAt: orThrow(timestamp(reqInt(row, 'issued_at')), 'sanctions.issued_at'),
  scope: toScope(row),
});

/**
 * The durable {@link SanctionStore}: enforcement actions persisted in SQLite, the
 * sanction twin of {@link SqliteChannelStore}. Pure storage — WHO may sanction stays
 * the auth gate's call at the edge and WHICH sanction governs stays `effectiveSanction`'s
 * pure derivation, so this store and the in-memory one are interchangeable and neither
 * the authority nor the severity ordering can drift between them [LAW:single-enforcer].
 *
 * Append-only is the table's shape, not merely a convention: there is no UPDATE and no
 * DELETE here, because a {@link Sanction} is a historical fact — a lifted ban is a new
 * sanction or a timed one expiring, never a row mutated away [LAW:no-silent-failure].
 * Records read back in insertion order (the monotonic `seq` rowid), the order the log
 * was written.
 */
export class SqliteSanctionStore implements SanctionStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  record(account: AccountId, sanction: Sanction): Promise<void> {
    // Value-variability, not a guard: the INSERT below is unconditional, the arm
    // rides in the `until` value [LAW:dataflow-not-control-flow].
    const until: number | null = sanction.scope.kind === 'until' ? sanction.scope.until : null;
    this.#db
      .prepare('INSERT INTO sanctions (account_id, reason, issued_at, scope_kind, until) VALUES (?, ?, ?, ?, ?)')
      .run(account, sanction.reason, sanction.issuedAt, sanction.scope.kind, until);
    return Promise.resolve();
  }

  forAccount(account: AccountId): Promise<readonly Sanction[]> {
    const rows = this.#db.prepare(`${SELECT} WHERE account_id = ? ORDER BY seq`).all(account);
    return Promise.resolve(rows.map(toSanction));
  }
}
