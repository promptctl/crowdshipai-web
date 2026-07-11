import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_EVENT,
  EFFECT_FIRED_EVENT,
  OVERLAY_STYLE_EVENT,
  PRESENCE_EVENT,
  SETTLEMENT_EVENT,
  STREAM_LIFECYCLE_EVENT,
  parseChatMessage,
  parseFiredEffect,
  parseOverlayStyle,
  parseSettlement,
  parseStreamLifecycle,
  parseViewerPresence,
} from '../src/data/live-event';

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

  it('surfaces the builder\'s words when the open params carry the CrowdShip display shape', () => {
    const frame = JSON.stringify({
      type: EFFECT_FIRED_EVENT,
      at: 1,
      payload: { effectKind: 'shoutout', params: { label: 'Shoutout', summary: 'name out loud' } },
    });
    expect(parseFiredEffect(frame)).toEqual({
      effectKind: 'shoutout',
      display: { label: 'Shoutout', summary: 'name out loud' },
    });
  });

  it('keeps the effect but carries no display for a foreign params shape — optionality, not rejection', () => {
    const shapes = [undefined, 'a string', ['a'], {}, { label: 'x' }, { label: 1, summary: 'y' }];
    for (const params of shapes) {
      const frame = JSON.stringify({ type: EFFECT_FIRED_EVENT, at: 1, payload: { effectKind: 'zap', params } });
      expect(parseFiredEffect(frame)).toEqual({ effectKind: 'zap' });
    }
  });
});

/** The exact event shape the publish edge (`announceChatMessage`) puts on the wire:
 *  the open chat type label, a publisher-stamped `at`, and the `{author, text}`
 *  payload the watcher renders. Built here verbatim so this test fails loudly if the
 *  two halves of the seam ever drift apart [LAW:one-source-of-truth]. */
const chatFrame = (author: string, text: string): string =>
  JSON.stringify({ type: CHAT_MESSAGE_EVENT, at: 1_700_000_000_000, payload: { author, text } });

describe('parseChatMessage', () => {
  it('reads the author and text from a faithful chat frame', () => {
    expect(parseChatMessage(chatFrame('mara', 'one cmov away'))).toEqual({ author: 'mara', text: 'one cmov away' });
  });

  it('carries a viewer pseudonym author through verbatim', () => {
    expect(parseChatMessage(chatFrame('viewer-3f9a1c', 'wen simd'))).toEqual({
      author: 'viewer-3f9a1c',
      text: 'wen simd',
    });
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseChatMessage('not json at all')).toBeNull();
  });

  it('is null for a JSON value that is not an event object', () => {
    expect(parseChatMessage('"just a string"')).toBeNull();
    expect(parseChatMessage('[1,2,3]')).toBeNull();
    expect(parseChatMessage('null')).toBeNull();
  });

  it('is null when the payload is missing or not an object', () => {
    expect(parseChatMessage(JSON.stringify({ type: CHAT_MESSAGE_EVENT, at: 1 }))).toBeNull();
    expect(parseChatMessage(JSON.stringify({ type: CHAT_MESSAGE_EVENT, at: 1, payload: 'x' }))).toBeNull();
  });

  it('is null when the author or text is blank or not a string', () => {
    expect(parseChatMessage(chatFrame('', 'hi'))).toBeNull();
    expect(parseChatMessage(chatFrame('mara', ''))).toBeNull();
    expect(
      parseChatMessage(JSON.stringify({ type: CHAT_MESSAGE_EVENT, at: 1, payload: { author: 7, text: 'hi' } })),
    ).toBeNull();
    expect(
      parseChatMessage(JSON.stringify({ type: CHAT_MESSAGE_EVENT, at: 1, payload: { author: 'mara', text: 9 } })),
    ).toBeNull();
  });
});

/** The exact event shape the publish edge (`announcePresence`) puts on the wire: the
 *  open presence type label, a publisher-stamped `at`, and the `{count}` payload the
 *  watcher renders as the live viewer count. Built here verbatim so this test fails
 *  loudly if the two halves of the seam ever drift apart [LAW:one-source-of-truth]. */
const presenceFrame = (count: number): string =>
  JSON.stringify({ type: PRESENCE_EVENT, at: 1_700_000_000_000, payload: { count } });

describe('parseViewerPresence', () => {
  it('reads the count from a faithful presence frame', () => {
    expect(parseViewerPresence(presenceFrame(42))).toEqual({ count: 42 });
  });

  it('reads a zero count — an empty stream is a real audience size, not a missing one', () => {
    expect(parseViewerPresence(presenceFrame(0))).toEqual({ count: 0 });
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseViewerPresence('not json at all')).toBeNull();
  });

  it('is null for a JSON value that is not an event object', () => {
    expect(parseViewerPresence('"just a string"')).toBeNull();
    expect(parseViewerPresence('[1,2,3]')).toBeNull();
    expect(parseViewerPresence('null')).toBeNull();
  });

  it('is null when the payload is missing or not an object', () => {
    expect(parseViewerPresence(JSON.stringify({ type: PRESENCE_EVENT, at: 1 }))).toBeNull();
    expect(parseViewerPresence(JSON.stringify({ type: PRESENCE_EVENT, at: 1, payload: 'x' }))).toBeNull();
  });

  it('is null when the count is not a whole, non-negative number of people', () => {
    const frame = (count: unknown): string =>
      JSON.stringify({ type: PRESENCE_EVENT, at: 1, payload: { count } });
    expect(parseViewerPresence(frame('7'))).toBeNull();
    expect(parseViewerPresence(frame(-1))).toBeNull();
    expect(parseViewerPresence(frame(2.5))).toBeNull();
    expect(parseViewerPresence(frame(Number.NaN))).toBeNull();
    expect(parseViewerPresence(JSON.stringify({ type: PRESENCE_EVENT, at: 1, payload: {} }))).toBeNull();
  });
});

/**
 * The three sibling parsers read the same wire but never claim each other's frames:
 * each is honest optionality for the OTHERS' event types, so the consume edge can try
 * them in turn and route by which one claims the frame [LAW:no-silent-failure].
 */
describe('the sibling parsers stay in their lanes', () => {
  it('parseFiredEffect does not claim a chat or presence frame', () => {
    expect(parseFiredEffect(chatFrame('mara', 'hi'))).toBeNull();
    expect(parseFiredEffect(presenceFrame(3))).toBeNull();
  });

  it('parseChatMessage does not claim a fired-effect or presence frame', () => {
    expect(parseChatMessage(firedFrame('shoutout'))).toBeNull();
    expect(parseChatMessage(presenceFrame(3))).toBeNull();
  });

  it('parseViewerPresence does not claim a fired-effect or chat frame', () => {
    expect(parseViewerPresence(firedFrame('shoutout'))).toBeNull();
    expect(parseViewerPresence(chatFrame('mara', 'hi'))).toBeNull();
  });
});

/** The exact frame the publish edge (`announceSettlement`) puts on the wire — a nudge
 *  naming the pool, plus the recorded settled arm when the movement settled it: shipped
 *  forward or refunded back. Built here verbatim so this test fails loudly if the two
 *  halves of the seam ever drift [LAW:one-source-of-truth]. */
const settlementFrame = (payload: unknown): string =>
  JSON.stringify({ type: SETTLEMENT_EVENT, at: 1_700_000_000_000, payload });

describe('parseSettlement', () => {
  it('reads a plain nudge — money moved against this pool, go re-read the durable feed', () => {
    expect(parseSettlement(settlementFrame({ poolTitle: 'add HDR' }))).toEqual({ poolTitle: 'add HDR' });
  });

  it('reads a shipped moment with the recorded release and cut figures', () => {
    expect(
      parseSettlement(
        settlementFrame({ poolTitle: 'add HDR', settled: { kind: 'shipped', releasedCoins: 54, cutCoins: 6 } }),
      ),
    ).toEqual({ poolTitle: 'add HDR', settled: { kind: 'shipped', releasedCoins: 54, cutCoins: 6 } });
  });

  it('reads a refunded moment with the recorded returned total — the failure mode is a first-class frame', () => {
    expect(
      parseSettlement(settlementFrame({ poolTitle: 'add HDR', settled: { kind: 'refunded', refundedCoins: 50 } })),
    ).toEqual({ poolTitle: 'add HDR', settled: { kind: 'refunded', refundedCoins: 50 } });
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseSettlement('data data data')).toBeNull();
  });

  it('is null when the payload carries no usable pool title', () => {
    expect(parseSettlement(settlementFrame({}))).toBeNull();
    expect(parseSettlement(settlementFrame({ poolTitle: '' }))).toBeNull();
    expect(parseSettlement(settlementFrame({ poolTitle: 7 }))).toBeNull();
  });

  it('is null when a settled block is present but malformed — an unknown kind or a non-coin figure', () => {
    const bad = (settled: unknown) => parseSettlement(settlementFrame({ poolTitle: 't', settled }));
    expect(bad({ kind: 'shipped', releasedCoins: 0, cutCoins: 6 })).toBeNull();
    expect(bad({ kind: 'shipped', releasedCoins: 54, cutCoins: -6 })).toBeNull();
    expect(bad({ kind: 'shipped', releasedCoins: 5.4, cutCoins: 6 })).toBeNull();
    expect(bad({ kind: 'shipped', cutCoins: 6 })).toBeNull();
    expect(bad({ kind: 'refunded', refundedCoins: 0 })).toBeNull();
    expect(bad({ kind: 'refunded', refundedCoins: 'all of it' })).toBeNull();
    expect(bad({ kind: 'refunded' })).toBeNull();
    expect(bad({ kind: 'evaporated', coins: 5 })).toBeNull();
    expect(bad('yes')).toBeNull();
  });

  it('does not claim its siblings’ frames, and they do not claim its', () => {
    expect(parseSettlement(firedFrame('shoutout'))).toBeNull();
    expect(parseSettlement(chatFrame('mara', 'hi'))).toBeNull();
    expect(parseSettlement(presenceFrame(3))).toBeNull();
    const shipped = settlementFrame({ poolTitle: 't', settled: { kind: 'shipped', releasedCoins: 54, cutCoins: 6 } });
    expect(parseFiredEffect(shipped)).toBeNull();
    expect(parseChatMessage(shipped)).toBeNull();
    expect(parseViewerPresence(shipped)).toBeNull();
  });
});

/** The exact frame the publish edge (`announceStreamLifecycle`) puts on the wire — the
 *  builder's session going live or ending, as one of exactly two transitions. Built
 *  here verbatim so this test fails loudly if the two halves of the seam ever drift
 *  [LAW:one-source-of-truth]. */
const lifecycleFrame = (payload: unknown): string =>
  JSON.stringify({ type: STREAM_LIFECYCLE_EVENT, at: 1_700_000_000_000, payload });

describe('parseStreamLifecycle', () => {
  it('reads a go-live transition', () => {
    expect(parseStreamLifecycle(lifecycleFrame({ phase: 'live' }))).toEqual({ phase: 'live' });
  });

  it('reads an ended transition — the end of a stream is a first-class frame, not a timeout', () => {
    expect(parseStreamLifecycle(lifecycleFrame({ phase: 'ended' }))).toEqual({ phase: 'ended' });
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseStreamLifecycle('static on the wire')).toBeNull();
  });

  it('is null for a phase this build does not know — a closed union, never a coerced boolean', () => {
    expect(parseStreamLifecycle(lifecycleFrame({ phase: 'paused' }))).toBeNull();
    expect(parseStreamLifecycle(lifecycleFrame({ phase: true }))).toBeNull();
    expect(parseStreamLifecycle(lifecycleFrame({}))).toBeNull();
    expect(parseStreamLifecycle(lifecycleFrame('live'))).toBeNull();
  });

  it('does not claim its siblings’ frames, and they do not claim its', () => {
    expect(parseStreamLifecycle(firedFrame('shoutout'))).toBeNull();
    expect(parseStreamLifecycle(chatFrame('mara', 'hi'))).toBeNull();
    expect(parseStreamLifecycle(presenceFrame(3))).toBeNull();
    const live = lifecycleFrame({ phase: 'live' });
    expect(parseFiredEffect(live)).toBeNull();
    expect(parseChatMessage(live)).toBeNull();
    expect(parseViewerPresence(live)).toBeNull();
    expect(parseSettlement(live)).toBeNull();
  });
});

/** The exact event shape the publish edge (`announceOverlayStyle`) puts on the wire:
 *  the open style type label, a publisher-stamped `at`, and the whole style as the
 *  payload. Built here verbatim so this test fails loudly if the two halves of the
 *  seam ever drift apart [LAW:one-source-of-truth]. */
const styleFrame = (payload: unknown): string =>
  JSON.stringify({ type: OVERLAY_STYLE_EVENT, at: 1_700_000_000_000, payload });

describe('parseOverlayStyle', () => {
  const style = { placement: 'top-right', accentHue: 280, durationSeconds: 12 };

  it('reads the whole restyled look from a faithful overlay-style frame', () => {
    expect(parseOverlayStyle(styleFrame(style))).toEqual(style);
  });

  it('is null for a garbled, non-JSON frame from the wire', () => {
    expect(parseOverlayStyle('static on the wire')).toBeNull();
  });

  it('judges the payload by the ONE style validator — an out-of-bounds style is not a style', () => {
    expect(parseOverlayStyle(styleFrame({ ...style, accentHue: 999 }))).toBeNull();
    expect(parseOverlayStyle(styleFrame({ ...style, placement: 'center' }))).toBeNull();
    expect(parseOverlayStyle(styleFrame({ ...style, durationSeconds: 0 }))).toBeNull();
    expect(parseOverlayStyle(styleFrame({}))).toBeNull();
    expect(parseOverlayStyle(styleFrame('bottom-left'))).toBeNull();
  });

  it('does not claim its siblings’ frames, and they do not claim its', () => {
    expect(parseOverlayStyle(firedFrame('shoutout'))).toBeNull();
    expect(parseOverlayStyle(chatFrame('mara', 'hi'))).toBeNull();
    expect(parseOverlayStyle(presenceFrame(3))).toBeNull();
    const restyled = styleFrame(style);
    expect(parseFiredEffect(restyled)).toBeNull();
    expect(parseChatMessage(restyled)).toBeNull();
    expect(parseViewerPresence(restyled)).toBeNull();
    expect(parseSettlement(restyled)).toBeNull();
    expect(parseStreamLifecycle(restyled)).toBeNull();
  });
});
