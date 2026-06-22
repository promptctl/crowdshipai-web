import { coinAmount } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { effectKind, type JsonValue, offerId, type PricedOffer } from '../src/index.js';

/** Build a valid offer from raw fixture parts, failing loudly on any bad input. */
function build(label: string, kind: string, priceCoins: bigint, params: JsonValue): PricedOffer {
  const id = offerId(label);
  const ek = effectKind(kind);
  const price = coinAmount(priceCoins);
  if (!id.ok) throw new Error(`bad offer id in fixture: ${label}`);
  if (!ek.ok) throw new Error(`bad effect kind in fixture: ${kind}`);
  if (!price.ok) throw new Error(`bad price in fixture: ${priceCoins}`);
  return { id: id.value, price: price.value, effect: { kind: ek.value, params } };
}

describe('PricedOffer is one type whose variety lives in values', () => {
  it('expresses wildly different builder offers as instances of the SAME type', () => {
    // The founding document's own illustrations — shoutout, vote, bounty, a
    // random-goal swap, a funded feature — built with no per-action subtype and
    // no platform enum. If this ever needs a new type or a `kind` switch to
    // compile, the substrate has regressed into the catalog we are escaping.
    const menu: readonly PricedOffer[] = [
      build('o-shout', 'shoutout', 50n, { message: 'gm builders' }),
      build('o-comment', 'add-named-comment', 100n, { name: 'Ada' }),
      build('o-vote', 'feature-vote', 200n, { featureId: 'dark-mode' }),
      build('o-goal', 'replace-goal-random', 1000n, null),
      build('o-fund', 'fund-feature', 25000n, { repo: 'ffmpeg', issue: 4242, poolWith: ['a', 'b'] }),
    ];

    expect(menu).toHaveLength(5);
    // Every entry is the one type — heterogeneous effects, uniform shape.
    for (const offer of menu) {
      expect(typeof offer.effect.kind).toBe('string');
      expect(offer.price > 0n).toBe(true);
    }
    // The effect payloads differ freely; the platform never had to know them.
    expect(menu[4]?.effect.params).toEqual({ repo: 'ffmpeg', issue: 4242, poolWith: ['a', 'b'] });
    expect(menu[3]?.effect.params).toBeNull();
  });
});

describe('offerId', () => {
  it('takes a non-blank id verbatim, with no normalization', () => {
    const padded = offerId('  keep-me-exact  ');
    expect(padded.ok && padded.value).toBe('  keep-me-exact  ');
  });

  it('rejects a blank id — empty or whitespace-only — and names the field', () => {
    expect(offerId('')).toEqual({ ok: false, error: { kind: 'blank', label: 'offerId' } });
    expect(offerId('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'offerId' } });
  });
});
