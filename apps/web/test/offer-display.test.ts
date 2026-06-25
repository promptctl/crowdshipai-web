import { describe, expect, it } from 'vitest';

import { offerDisplayOf, offerParams } from '../src/data/offer-display';

describe("offer-display — a builder's display text round-trips through effect params", () => {
  it('reads back exactly the label and summary that were written', () => {
    const params = offerParams({ label: 'Shoutout', summary: 'I read your name out loud, on stream.' });
    expect(offerDisplayOf(params)).toEqual({
      label: 'Shoutout',
      summary: 'I read your name out loud, on stream.',
    });
  });

  it('preserves empty strings — blankness is the authoring boundary\'s call, not this codec\'s', () => {
    expect(offerDisplayOf(offerParams({ label: '', summary: '' }))).toEqual({ label: '', summary: '' });
  });

  it('halts loudly on params that are not a CrowdShip display payload, never blank-defaulting', () => {
    // A bare string, a foreign object, null, an array — each is corruption a reader must
    // not paper over with empty text [LAW:no-silent-failure].
    expect(() => offerDisplayOf('just a string')).toThrow(/display payload/);
    expect(() => offerDisplayOf({ label: 'only a label' })).toThrow(/display payload/);
    expect(() => offerDisplayOf({ label: 1, summary: 2 })).toThrow(/display payload/);
    expect(() => offerDisplayOf(null)).toThrow(/display payload/);
    expect(() => offerDisplayOf(['label', 'summary'])).toThrow(/display payload/);
  });
});
