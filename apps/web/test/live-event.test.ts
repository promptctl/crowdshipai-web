import { describe, expect, it } from 'vitest';

import { EFFECT_FIRED_EVENT, parseFiredEffect } from '../src/data/live-event';

/**
 * The watch surface's consume edge parses raw SSE frames at the wire trust boundary.
 * These tests pin the contract both ways: a faithful effect-fired frame yields the
 * effect kind to render, and every not-a-fired-effect frame yields null — honest
 * optionality, never a thrown guard or a swallowed misparse [LAW:no-silent-failure].
 */

/** The exact event shape the publish edge (`announceEffectFired`) puts on the wire:
 *  the open type label, a publisher-stamped `at`, and the `JsonValue` payload whose
 *  `effectKind` the watcher renders. Built here verbatim so this test fails loudly if
 *  the two halves of the seam ever drift apart [LAW:one-source-of-truth]. */
const firedFrame = (effectKind: string): string =>
  JSON.stringify({
    type: EFFECT_FIRED_EVENT,
    at: 1_700_000_000_000,
    payload: { effectKind, params: 'I read your name out loud, on stream.', receipt: { ok: true } },
  });

describe('parseFiredEffect', () => {
  it('reads the effect kind from a faithful effect-fired frame', () => {
    expect(parseFiredEffect(firedFrame('shoutout'))).toEqual({ effectKind: 'shoutout' });
  });

  it('carries an arbitrary builder-authored open kind through verbatim — never a closed set', () => {
    expect(parseFiredEffect(firedFrame('summon-the-goblin'))).toEqual({ effectKind: 'summon-the-goblin' });
  });

  it('is null for a future event type this build does not render', () => {
    const presence = JSON.stringify({ type: 'viewer-joined', at: 1, payload: { count: 42 } });
    expect(parseFiredEffect(presence)).toBeNull();
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseFiredEffect('not json at all')).toBeNull();
  });

  it('is null for a JSON value that is not an event object', () => {
    expect(parseFiredEffect('"just a string"')).toBeNull();
    expect(parseFiredEffect('42')).toBeNull();
    expect(parseFiredEffect('null')).toBeNull();
    expect(parseFiredEffect('[1,2,3]')).toBeNull();
  });

  it('is null when the payload is missing or not an object', () => {
    expect(parseFiredEffect(JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1 }))).toBeNull();
    expect(parseFiredEffect(JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1, payload: 'x' }))).toBeNull();
  });

  it('is null when the payload carries no usable effect kind', () => {
    const noKind = JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1, payload: { params: 'x' } });
    const blankKind = JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1, payload: { effectKind: '' } });
    const numberKind = JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1, payload: { effectKind: 7 } });
    expect(parseFiredEffect(noKind)).toBeNull();
    expect(parseFiredEffect(blankKind)).toBeNull();
    expect(parseFiredEffect(numberKind)).toBeNull();
  });
});
