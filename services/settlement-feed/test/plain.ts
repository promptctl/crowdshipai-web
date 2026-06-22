import type { SettlementEvent } from '../src/index.js';

/**
 * A settlement event flattened to plain primitives — brands erased, the party named under one
 * `party` key — so assertions read as the audience's view rather than a wall of constructors.
 * The exhaustive switch (no `default`) keeps it honest: a new event kind stops this compiling
 * until the feed's tests acknowledge it [LAW:dataflow-not-control-flow].
 */
export interface PlainEvent {
  readonly kind: SettlementEvent['kind'];
  readonly party: string;
  readonly amount: bigint;
  readonly pooledAfter: bigint;
  readonly reason: string;
  readonly at: number;
}

export const plain = (event: SettlementEvent): PlainEvent => {
  const money = {
    amount: event.amount as bigint,
    pooledAfter: event.pooledAfter,
    reason: String(event.reason),
    at: event.at as number,
  };
  switch (event.kind) {
    case 'contribution':
      return { kind: event.kind, party: String(event.backer), ...money };
    case 'release':
      return { kind: event.kind, party: String(event.builder), ...money };
    case 'cut':
      return { kind: event.kind, party: String(event.platform), ...money };
  }
};
