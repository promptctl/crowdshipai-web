import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_EVENT,
  EFFECT_FIRED_EVENT,
  PRESENCE_EVENT,
  parseChatMessage,
  parseFiredEffect,
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
