import type { BlankError, Brand, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

import type { JsonValue } from './json.js';

/**
 * What an offer fires when it is bought, named by the builder.
 *
 * `kind` is an OPEN label, never a platform-closed enum. A shoutout, a vote, a
 * feature bounty, "replace my goal with a random one" — these are values a
 * builder authors, not a union the platform enumerates and must extend for
 * every new idea [LAW:no-mode-explosion]. The rail never branches on `kind`; it
 * carries it to the edge where the builder's overlay gives it meaning
 * [LAW:dataflow-not-control-flow]. (The ledger took the same stance with
 * `TransactionReason` — an open label, not a closed enum.)
 *
 * The moment this becomes a `'shoutout' | 'vote' | 'bounty'` union, stop and
 * reread the founding document's menu section: that union is the bloat we are
 * escaping and the point where we start deciding what builders are allowed to
 * sell.
 */
export type EffectKind = Brand<string, 'EffectKind'>;

export interface Effect {
  readonly kind: EffectKind;
  readonly params: JsonValue;
}

/**
 * An effect kind is a non-blank, verbatim label — the overlay matches on it, so
 * it is taken exactly as given, with blank rejected at the one trust boundary
 * where a raw string enters [LAW:single-enforcer]. The non-blank-brand behavior
 * lives once in foundation; this is just its `EffectKind` instance.
 */
export const effectKind = (raw: string): Result<EffectKind, BlankError> =>
  nonBlank<'EffectKind'>('effectKind', raw);
