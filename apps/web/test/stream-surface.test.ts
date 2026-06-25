import { Track } from 'livekit-client';
import { describe, expect, it } from 'vitest';

import { surfaceOf } from '../src/data/stream-surface';

/**
 * The discriminator the whole screen+face composite rests on: a published video track is
 * routed to a viewer surface by its SOURCE, not its kind. Pinning every `Track.Source`
 * value here means a new source (or a forgotten one) is a failing test, never a track that
 * silently lands on the wrong surface or vanishes [LAW:no-silent-failure].
 */
describe('surfaceOf — which viewer surface a published track paints', () => {
  it('routes the screen-share track to the main build surface', () => {
    expect(surfaceOf(Track.Source.ScreenShare)).toBe('screen');
  });

  it('routes the camera track to the face overlay', () => {
    expect(surfaceOf(Track.Source.Camera)).toBe('face');
  });

  it('paints no video surface for audio sources', () => {
    expect(surfaceOf(Track.Source.Microphone)).toBeNull();
    expect(surfaceOf(Track.Source.ScreenShareAudio)).toBeNull();
  });

  it('paints no video surface for an unknown source', () => {
    expect(surfaceOf(Track.Source.Unknown)).toBeNull();
  });

  it('maps every Track.Source value deliberately — the two video surfaces, nothing else', () => {
    const surfaces = Object.values(Track.Source).map(surfaceOf);
    // Exactly two sources paint a surface (screen + face); every other source is null.
    expect(surfaces.filter((s) => s !== null).sort()).toEqual(['face', 'screen']);
  });
});
