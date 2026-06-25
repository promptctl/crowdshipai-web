import { Track } from 'livekit-client';

/**
 * Which viewer surface a published video track paints. A builder going live publishes two
 * distinct video tracks — the screen they build on and the webcam pointed at their face —
 * and the viewer composites the face over the screen. This is the seam between the two:
 * the surface a track belongs to is derived from the track's publication SOURCE, the one
 * authoritative fact about what a track IS [LAW:types-are-the-program].
 */
export type StreamSurface = 'screen' | 'face';

/**
 * Map a track's publication source to the viewer surface it paints, or `null` for a source
 * that paints no video surface — audio tracks and any unrecognized source.
 *
 * Source, not track KIND, is the discriminator: both the screen and the face are
 * `Kind.Video`, so kind no longer singles either out once there are two. Routing on source
 * lets the two `TrackSubscribed` events arrive in any order and each still land on the
 * right surface — nothing depends on subscription order [LAW:no-ambient-temporal-coupling].
 */
export const surfaceOf = (source: Track.Source): StreamSurface | null =>
  source === Track.Source.ScreenShare ? 'screen' : source === Track.Source.Camera ? 'face' : null;
