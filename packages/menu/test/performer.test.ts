import { coinAmount, type Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  dispatchingPerformer,
  type Effect,
  type EffectHandler,
  type EffectKind,
  effectKind,
  type JsonValue,
  offerId,
  type PricedOffer,
} from '../src/index.js';

/** Build a valid effect from raw fixture parts, failing loudly on bad input. */
function effect(rawKind: string, params: JsonValue): Effect {
  const k = effectKind(rawKind);
  if (!k.ok) throw new Error(`bad effect kind in fixture: ${rawKind}`);
  return { kind: k.value, params };
}

/** A non-blank kind to key the registry with, failing loudly on bad input. */
function kind(raw: string): EffectKind {
  const k = effectKind(raw);
  if (!k.ok) throw new Error(`bad kind in fixture: ${raw}`);
  return k.value;
}

/**
 * Unwrap a successful result or fail loudly. Receipts are `JsonValue` and so may
 * be falsy (`null`, `0`, `false`, `''`); asserting on `r.ok && r.value` would
 * short-circuit on those and check the wrong operand, so the test reads `value`
 * through this loud unwrap instead [LAW:no-silent-failure].
 */
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('dispatchingPerformer performs heterogeneous effects through one seam', () => {
  it('routes each effect to its kind handler by data, never branching on kind', async () => {
    // Each handler echoes its own label, so a result's label proves which handler
    // ran — routing correctness without a side-effect array whose order would
    // couple to handler-body shape. The rail carried `kind`; the edge interpreted it.
    const echo =
      (label: string): EffectHandler =>
      async (e) => ({ ok: true, value: { handled: label, params: e.params } });

    // The founding document's own illustrations — shoutout, comment, vote, a
    // random-goal swap, a funded feature — each a builder-authored kind the
    // platform never enumerated, registered as one map entry apiece.
    const handlers = new Map<EffectKind, EffectHandler>([
      [kind('shoutout'), echo('shoutout')],
      [kind('add-named-comment'), echo('comment')],
      [kind('feature-vote'), echo('vote')],
      [kind('replace-goal-random'), echo('goal')],
      [kind('fund-feature'), echo('fund')],
    ]);
    const performer = dispatchingPerformer(handlers);

    const effects: readonly Effect[] = [
      effect('shoutout', { message: 'gm builders' }),
      effect('feature-vote', { featureId: 'dark-mode' }),
      effect('fund-feature', { repo: 'ffmpeg', issue: 4242, poolWith: ['a', 'b'] }),
    ];

    // `Promise.all` preserves input order, so result[i] is effect[i]'s outcome.
    const results = await Promise.all(effects.map((e) => performer.perform(e)));

    expect(results.map((r) => value(r))).toEqual([
      { handled: 'shoutout', params: { message: 'gm builders' } },
      { handled: 'vote', params: { featureId: 'dark-mode' } },
      { handled: 'fund', params: { repo: 'ffmpeg', issue: 4242, poolWith: ['a', 'b'] } },
    ]);
  });

  it('performs a kind the platform never anticipated with no rail change — just one map entry', async () => {
    // 'summon-a-dragon' is in no platform enum; it is pure builder data. If this
    // ever needed a change to dispatchingPerformer to compile or pass, the
    // substrate would have regressed into the catalog we are escaping.
    const handlers = new Map<EffectKind, EffectHandler>([
      [kind('summon-a-dragon'), async (e) => ({ ok: true, value: { summoned: e.params } })],
    ]);
    const performer = dispatchingPerformer(handlers);

    const result = await performer.perform(effect('summon-a-dragon', { color: 'green', hp: 9000 }));

    expect(value(result)).toEqual({ summoned: { color: 'green', hp: 9000 } });
  });

  it('returns a falsy receipt intact — a handler that reports null is a success, not a miss', async () => {
    // EffectReceipt is JsonValue, so null/0/false/'' are valid receipts. The seam
    // must carry them as successes, never collapse a falsy receipt into a failure.
    const handlers = new Map<EffectKind, EffectHandler>([
      [kind('quiet'), async () => ({ ok: true, value: null })],
    ]);
    const performer = dispatchingPerformer(handlers);

    const result = await performer.perform(effect('quiet', null));

    expect(result).toEqual({ ok: true, value: null });
  });

  it('fails loudly on a kind with no registered handler — never a silent no-op for a paid effect', async () => {
    const performer = dispatchingPerformer(new Map());

    const result = await performer.perform(effect('nobody-handles-this', null));

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unknown-effect-kind', effectKind: 'nobody-handles-this' },
    });
  });

  it("surfaces a handler failure as handler-error carrying the edge's own open detail", async () => {
    const handlers = new Map<EffectKind, EffectHandler>([
      [kind('flaky'), async () => ({ ok: false, error: { reason: 'overlay-offline', retryable: true } })],
    ]);
    const performer = dispatchingPerformer(handlers);

    const result = await performer.perform(effect('flaky', null));

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'handler-error',
        effectKind: 'flaky',
        detail: { reason: 'overlay-offline', retryable: true },
      },
    });
  });
});

describe("a PricedOffer's effect flows through the performer seam", () => {
  it('performs the effect an offer carries — price stays on the rail, effect goes to the edge', async () => {
    // The whole substrate end to end: a priced thing (o8q.1) whose effect is
    // performed at the edge (o8q.2). The price never reaches the performer; only
    // the effect description does.
    const id = offerId('o-shout');
    const price = coinAmount(50n);
    const k = effectKind('shoutout');
    if (!id.ok || !price.ok || !k.ok) throw new Error('bad offer fixture');
    const offer: PricedOffer = {
      id: id.value,
      price: price.value,
      effect: { kind: k.value, params: { message: 'lfg' } },
    };

    const handlers = new Map<EffectKind, EffectHandler>([
      [k.value, async (e) => ({ ok: true, value: { shown: e.params } })],
    ]);
    const performer = dispatchingPerformer(handlers);

    const result = await performer.perform(offer.effect);

    expect(value(result)).toEqual({ shown: { message: 'lfg' } });
  });
});
