import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  authorMenu,
  authorOffer,
  DEFAULT_MENU_POLICY,
  findOffer,
  type JsonValue,
  type Menu,
  maxOffers,
  type MenuPolicy,
  type OfferDraft,
  offerId,
} from '../src/index.js';

/** A policy generous enough that the structural tests never trip the count cap. */
const POLICY: MenuPolicy = DEFAULT_MENU_POLICY;

/** A policy with an exact offer cap, built through the branded constructor. */
function policy(cap: number): MenuPolicy {
  return { maxOffers: value(maxOffers(cap)) };
}

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
      ], POLICY),
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
    const menu = value(authorMenu([], POLICY));
    expect(menu.offers).toEqual([]);
  });

  it('locates each offer’s field faults by its position in the submitted menu', () => {
    const problems = error(
      authorMenu([
        draft('ok', 100n, 'tip'),
        draft('', 50n, 'shoutout'), // blank id at position 1
        draft('also-ok', 0n, 'vote'), // non-positive price at position 2
      ], POLICY),
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
      ], POLICY),
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
      ], POLICY),
    );
    expect(problems).toEqual([
      { kind: 'offer', at: 1, problem: { field: 'id', error: { kind: 'blank', label: 'offerId' } } },
      { kind: 'duplicate-id', id: 'dup', at: [0, 2] },
    ]);
  });
});

describe('maxOffers mints a cap only from a non-negative count', () => {
  it('accepts zero and positive integers', () => {
    expect(value(maxOffers(0))).toBe(0);
    expect(value(maxOffers(100))).toBe(100);
  });

  it('rejects a negative cap — it would invert the guardrail into a total lockout', () => {
    expect(error(maxOffers(-1))).toEqual({ kind: 'not-a-count', value: -1 });
  });

  it('rejects a fractional cap — a count of offers is a whole number', () => {
    expect(error(maxOffers(2.5))).toEqual({ kind: 'not-a-count', value: 2.5 });
  });
});

describe('authorMenu enforces the offer-count guardrail', () => {
  /** A deliberately tight cap so a small fixture can exceed it. */
  const tight: MenuPolicy = policy(2);

  it('authors a menu at exactly the cap — the limit is inclusive', () => {
    const menu = value(
      authorMenu([draft('a', 10n, 'tip'), draft('b', 20n, 'tip')], tight),
    );
    expect(menu.offers.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('rejects a menu over the cap, reporting the limit and the actual count', () => {
    const problems = error(
      authorMenu(
        [draft('a', 10n, 'tip'), draft('b', 20n, 'tip'), draft('c', 30n, 'tip')],
        tight,
      ),
    );
    expect(problems).toEqual([{ kind: 'too-many-offers', limit: 2, actual: 3 }]);
  });

  it('counts the submission, not the survivors — a flood of malformed drafts still trips the cap', () => {
    // Each draft has exactly one fault (a blank id), so each is one `offer` problem;
    // the count guardrail measures the submission regardless, and every fault — field
    // and guardrail — comes back in the one pass.
    const problems = error(
      authorMenu([draft('', 10n, 'tip'), draft('', 20n, 'tip'), draft('', 30n, 'tip')], tight),
    );
    expect(problems).toContainEqual({ kind: 'too-many-offers', limit: 2, actual: 3 });
    expect(problems.filter((p) => p.kind === 'offer')).toHaveLength(3);
  });

  it('treats an empty menu as valid even at a zero cap — zero offers does not exceed zero', () => {
    const menu = value(authorMenu([], policy(0)));
    expect(menu.offers).toEqual([]);
  });

  it('reports the count cap alongside field and duplicate faults in one pass', () => {
    // One offer is malformed (blank id), two share an id, and the whole submission
    // is over a cap of 2: a builder sees the structural faults AND the guardrail at once.
    const problems = error(
      authorMenu(
        [draft('dup', 50n, 'shoutout'), draft('', 60n, 'tip'), draft('dup', 70n, 'vote')],
        policy(2),
      ),
    );
    expect(problems).toContainEqual({
      kind: 'offer',
      at: 1,
      problem: { field: 'id', error: { kind: 'blank', label: 'offerId' } },
    });
    expect(problems).toContainEqual({ kind: 'duplicate-id', id: 'dup', at: [0, 2] });
    expect(problems).toContainEqual({ kind: 'too-many-offers', limit: 2, actual: 3 });
  });
});

describe('findOffer resolves the offer a backer chose', () => {
  const menu: Menu = value(
    authorMenu([
      draft('shout', 50n, 'shoutout'),
      draft('fund', 1000n, 'fund-feature'),
    ], POLICY),
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
