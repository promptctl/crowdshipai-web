import {
  DEFAULT_MENU_POLICY,
  authorMenu,
  findOffer,
  offerId,
  type JsonValue,
  type OfferDraft,
} from '@crowdship/menu';
import { describe, expect, it } from 'vitest';

import { createInMemoryPurchaseLog, createPurchaser } from '../src/index.js';
import { BACKER, BUILDER, buyRequest, countingPerformer, fundedLedger, must } from './world.js';

/**
 * The menu substrate's whole reason to exist, proven end to end: a builder composes
 * an offer the platform never anticipated, and it works without us shipping anything
 * [LAW:composability]. A backer's purchase runs author -> Menu -> findOffer ->
 * Purchaser.buy -> performer, and at every hop the effect kind is opaque data carried
 * to the edge, never a value the rail branches on [LAW:dataflow-not-control-flow]. The
 * single place that learns what a kind means is the one `EffectHandler` a builder's
 * edge registers — the founding document's "the menu belongs to the builder" made
 * checkable.
 *
 * This suite is the RUNTIME half of the guard against that openness regressing into a
 * catalog: it drives kinds that are maximally unanticipated — adversarially chosen to
 * break any code that secretly special-cases the kind — through the real pipeline and
 * proves each fires identically. A branch on the kind, an allow-list, a normalization,
 * or an object-keyed dispatch reintroduced anywhere turns one of these red. The
 * COMPILE-TIME half is a separate, complementary theorem — that `EffectKind` can never
 * be narrowed into a closed union — checked by the type system where the type is
 * defined; a runtime branch and a type-level catalog are two different regressions, so
 * they are guarded by the two checkers that can actually see them [LAW:single-enforcer].
 *
 * No production code is added for this ticket, and that is the point: the substrate was
 * built to compose, so the deliverable is the proof that it does, not more machinery
 * [LAW:carrying-cost].
 */

/** One offer as a builder's authoring surface submits it — raw primitives, untrusted,
 *  exactly the shape `authorMenu` brands. */
const draft = (id: string, price: bigint, kind: string, params: JsonValue): OfferDraft => ({
  id,
  price,
  effect: { kind, params },
});

describe('a builder composes an offer the platform never anticipated, end to end', () => {
  it('authors an invented offer in a menu and buys it — the only code that learned the kind is one edge handler', async () => {
    // 'play-a-saxophone-solo' is in no platform union. It rides into a validated Menu
    // beside an ordinary shoutout, is resolved by id like any offer, and fires on the
    // same buy path a shoutout takes. The lone edge entry below is the whole of what
    // the platform had to "learn" — authoring, the Menu, findOffer, buy, and dispatch
    // touched zero new code.
    const ledger = await fundedLedger(500n);
    const { performer, fires } = countingPerformer(['play-a-saxophone-solo']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const menu = must(
      authorMenu(
        [
          draft('sax', 200n, 'play-a-saxophone-solo', { bars: 8, key: 'Bb' }),
          draft('shout', 50n, 'shoutout', { message: 'gm' }), // an ordinary offer beside it
        ],
        DEFAULT_MENU_POLICY,
      ),
    );

    const chosen = findOffer(menu, must(offerId('sax')));
    if (chosen === undefined) throw new Error('authored offer not resolvable by id');

    const outcome = await purchaser.buy(buyRequest(chosen, 'sax-buy'));

    expect(outcome.kind).toBe('fired');
    if (outcome.kind !== 'fired') throw new Error('unreachable');
    expect(outcome.effect).toEqual({ ack: 'play-a-saxophone-solo' });
    // The invented effect fired exactly once, carrying the builder's params verbatim...
    expect(fires()).toHaveLength(1);
    expect(fires()[0]?.kind).toBe('play-a-saxophone-solo');
    expect(fires()[0]?.params).toEqual({ bars: 8, key: 'Bb' });
    // ...and real coins moved for it on the same single ledger leg any offer uses.
    expect(await ledger.balanceOf(BACKER)).toBe(300n);
    expect(await ledger.balanceOf(BUILDER)).toBe(200n);
  });

  it('an invented kind with no handler fails loud through the whole chain — extensibility is never a silent no-op', async () => {
    // Openness must not mean "a kind we do not recognize quietly vanishes." A composed,
    // authored offer whose edge has no handler still charges (money is the thing that
    // must be right) and surfaces effect-failed carrying the receipt to reconcile, never
    // a swallowed success [LAW:no-silent-failure].
    const ledger = await fundedLedger(100n);
    const { performer } = countingPerformer([]);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const menu = must(authorMenu([draft('mystery', 30n, 'invent-a-new-holiday', null)], DEFAULT_MENU_POLICY));
    const chosen = findOffer(menu, must(offerId('mystery')));
    if (chosen === undefined) throw new Error('authored offer not resolvable by id');

    const outcome = await purchaser.buy(buyRequest(chosen, 'no-handler'));

    expect(outcome.kind).toBe('effect-failed');
    if (outcome.kind !== 'effect-failed') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'unknown-effect-kind', effectKind: 'invent-a-new-holiday' });
    expect(await ledger.balanceOf(BUILDER)).toBe(30n); // the coins really moved — that is why it must be loud
  });
});

describe('the pipeline is blind to the effect kind — a regression guard against any branch on it', () => {
  // Each kind here is an adversarial VALUE chosen to break a specific way the rail could
  // regress into a catalog: a name that mishandles under a name-keyed object table but
  // not a value-keyed Map; the keyword a `switch` falls through on; a label that must be
  // carried byte-for-byte with no charset assumption or identity-changing trim; and one
  // long enough to trip any length bound. Each row names the regression it guards, so the
  // mapping lives at one source rather than restated here. They author, resolve, buy, and
  // fire exactly like a shoutout; if any layer grows a branch on the kind, an allow-list,
  // a normalization, or an object dispatch, one of them stops firing or arrives altered
  // [LAW:no-silent-failure].
  const HAZARDS: readonly { readonly label: string; readonly kind: string; readonly params: JsonValue }[] = [
    { label: 'a name colliding with Object.prototype (__proto__)', kind: '__proto__', params: { a: 1 } },
    { label: 'a name colliding with a prototype method (constructor)', kind: 'constructor', params: null },
    { label: 'a name colliding with hasOwnProperty', kind: 'hasOwnProperty', params: { b: 2 } },
    { label: 'a name colliding with toString', kind: 'toString', params: 'tip' },
    { label: "the literal word a switch's default case uses", kind: 'default', params: { c: 3 } },
    { label: 'a non-ASCII, multi-script, emoji kind', kind: '🐉-召喚-effekt', params: { d: 4 } },
    { label: 'a whitespace-padded kind preserved verbatim', kind: '  spaced-kind  ', params: { e: 5 } },
    { label: 'a 2048-character kind', kind: 'k'.repeat(2048), params: { f: 6 } },
  ];

  for (const { label, kind, params } of HAZARDS) {
    it(`authors, resolves, buys, and fires ${label}`, async () => {
      const ledger = await fundedLedger(100n);
      const { performer, fires } = countingPerformer([kind]);
      const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

      const menu = must(authorMenu([draft('only', 10n, kind, params)], DEFAULT_MENU_POLICY));
      const chosen = findOffer(menu, must(offerId('only')));
      if (chosen === undefined) throw new Error('authored offer not resolvable by id');

      const outcome = await purchaser.buy(buyRequest(chosen, `buy-${label}`));

      expect(outcome.kind).toBe('fired');
      // Reached the edge byte-for-byte: same kind, same params, no normalization.
      expect(fires()).toHaveLength(1);
      expect(fires()[0]?.kind).toBe(kind);
      expect(fires()[0]?.params).toEqual(params);
      expect(await ledger.balanceOf(BUILDER)).toBe(10n);
    });
  }
});
