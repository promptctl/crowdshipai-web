import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  authorMenu,
  authorOffer,
  findOffer,
  type JsonValue,
  type Menu,
  type OfferDraft,
  offerId,
} from '../src/index.js';

/** A draft from raw parts — the shape a builder's authoring surface submits. */
function draft(id: string, price: bigint, kind: string, params: JsonValue = null): OfferDraft {
  return { id, price, effect: { kind, params } };
}

/**
 * Unwrap a successful result or fail loudly. Mirrors the performer suite: a
 * receipt/value may be falsy, so `r.ok && r.value` would check the wrong operand
 * [LAW:no-silent-failure].
 */
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Unwrap a failure or fail loudly — the symmetric helper for the reject cases. */
function error<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error(`expected error, got ok: ${JSON.stringify(r.value)}`);
  return r.error;
}

describe('authorOffer brands a draft at its trust boundaries', () => {
  it('produces a valid offer, taking id and kind verbatim and branding the price', () => {
    const offer = value(authorOffer(draft('  keep-exact  ', 50n, 'shoutout', { message: 'gm' })));
    // Id and kind are load-bearing keys — verbatim, never normalized.
    expect(offer.id).toBe('  keep-exact  ');
    expect(offer.effect.kind).toBe('shoutout');
    expect(offer.price).toBe(50n);
    expect(offer.effect.params).toEqual({ message: 'gm' });
  });

  it('carries a falsy effect payload through opaque — null is data, not absence', () => {
    const offer = value(authorOffer(draft('o', 10n, 'replace-goal-random', null)));
    expect(offer.effect.params).toBeNull();
  });

  it('authors a kind the platform never anticipated exactly like any other — no enum, no branch', () => {
    // 'summon-a-dragon' is in no platform union. If authoring ever had to know it,
    // the substrate would have regressed into the catalog we are escaping (o8q.6).
    const offer = value(authorOffer(draft('o', 9000n, 'summon-a-dragon', { color: 'green' })));
    expect(offer.effect.kind).toBe('summon-a-dragon');
    expect(offer.effect.params).toEqual({ color: 'green' });
  });

  it('reports EVERY invalid field at once, not just the first', () => {
    // Blank id, non-positive price, blank kind — all three faults in one offer come
    // back together so a builder fixes the whole offer in one pass.
    const problems = error(authorOffer(draft('   ', 0n, '')));
    expect(problems).toEqual([
      { field: 'id', error: { kind: 'blank', label: 'offerId' } },
      { field: 'price', error: { kind: 'not-positive', value: 0n } },
      { field: 'effect-kind', error: { kind: 'blank', label: 'effectKind' } },
    ]);
  });

  it('reports only the field that actually failed', () => {
    const problems = error(authorOffer(draft('o', -5n, 'shoutout')));
    expect(problems).toEqual([{ field: 'price', error: { kind: 'not-positive', value: -5n } }]);
  });
});

describe('authorMenu validates a whole menu and arranges it', () => {
  it('authors a varied menu and preserves the builder’s order', () => {
    // The founding document's own illustrations, as one builder would arrange them.
    const menu = value(
      authorMenu([
        draft('shout', 50n, 'shoutout', { message: 'gm' }),
        draft('vote', 200n, 'feature-vote', { featureId: 'dark-mode' }),
        draft('fund', 25000n, 'fund-feature', { repo: 'ffmpeg', issue: 4242 }),
        draft('chaos', 666n, 'replace-goal-random', null),
      ]),
    );
    expect(menu.offers.map((o) => o.id)).toEqual(['shout', 'vote', 'fund', 'chaos']);
    expect(menu.offers.map((o) => o.effect.kind)).toEqual([
      'shoutout',
      'feature-vote',
      'fund-feature',
      'replace-goal-random',
    ]);
  });

  it('treats an empty menu as valid — a builder with no offers yet is well-formed', () => {
    const menu = value(authorMenu([]));
    expect(menu.offers).toEqual([]);
  });

  it('locates each offer’s field faults by its position in the submitted menu', () => {
    const problems = error(
      authorMenu([
        draft('ok', 100n, 'tip'),
        draft('', 50n, 'shoutout'), // blank id at position 1
        draft('also-ok', 0n, 'vote'), // non-positive price at position 2
      ]),
    );
    expect(problems).toEqual([
      { kind: 'offer', at: 1, problem: { field: 'id', error: { kind: 'blank', label: 'offerId' } } },
      {
        kind: 'offer',
        at: 2,
        problem: { field: 'price', error: { kind: 'not-positive', value: 0n } },
      },
    ]);
  });

  it('rejects a duplicate id — it would make an offer ambiguous to resolve and buy', () => {
    const problems = error(
      authorMenu([
        draft('o1', 50n, 'shoutout'),
        draft('o2', 75n, 'tip'),
        draft('o1', 999n, 'fund-feature'), // same id as position 0
      ]),
    );
    expect(problems).toEqual([{ kind: 'duplicate-id', id: 'o1', at: [0, 2] }]);
  });

  it('does not count a blank-id offer as a phantom duplicate', () => {
    // Position 1 fails authoring (blank id) and so never enters duplicate detection;
    // the genuine duplicate is between the two valid 'dup' offers at 0 and 2.
    const problems = error(
      authorMenu([
        draft('dup', 50n, 'shoutout'),
        draft('', 60n, 'tip'),
        draft('dup', 70n, 'vote'),
      ]),
    );
    expect(problems).toEqual([
      { kind: 'offer', at: 1, problem: { field: 'id', error: { kind: 'blank', label: 'offerId' } } },
      { kind: 'duplicate-id', id: 'dup', at: [0, 2] },
    ]);
  });
});

describe('findOffer resolves the offer a backer chose', () => {
  const menu: Menu = value(
    authorMenu([
      draft('shout', 50n, 'shoutout'),
      draft('fund', 1000n, 'fund-feature'),
    ]),
  );

  it('returns the one offer for an id present in the menu', () => {
    const id = offerId('fund');
    expect(id.ok && findOffer(menu, id.value)?.price).toBe(1000n);
  });

  it('returns undefined for an id not on the menu — absence is a typed outcome', () => {
    const id = offerId('nope');
    expect(id.ok && findOffer(menu, id.value)).toBeUndefined();
  });
});
