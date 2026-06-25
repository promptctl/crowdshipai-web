'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

import { surfaceOf, type StreamSurface } from '@/data/stream-surface';
import { viewerConnection } from '@/server/stream-actions';

/**
 * The live video subscriber that binds behind the {@link StreamStage} placeholder on the
 * watch surface. It does ONE thing — turn a builder's slug into their build, on screen,
 * with their face composited over it — and asks nothing of the rest of the surface
 * [LAW:composability].
 *
 * A builder publishes two distinct video tracks, and the track's `publication.source` is
 * the authoritative discriminator of which surface it belongs to: `ScreenShare` is the
 * main build surface, `Camera` is the face overlay [LAW:types-are-the-program]. Routing on
 * source — not on track kind, which no longer singles either out — means the two
 * `TrackSubscribed` events can arrive in any order and each still lands on the right
 * surface, so nothing here depends on subscription order [LAW:no-ambient-temporal-coupling].
 *
 * This effect is the ONE timing authority for the connection's whole lifecycle: it
 * connects on mount, attaches each remote video track to its surface the instant LiveKit
 * reports it, detaches on `TrackUnsubscribed`/`Disconnected`, and tears the room down on
 * unmount or slug change. Attach/detach are driven by room events, not by when React paints.
 *
 * Each surface independently present-or-absent is honest "not live yet": an absent
 * connection (the in-memory fake → `null`), a connected-but-not-publishing screen, and a
 * builder with no camera all render by leaving that surface transparent so the placeholder
 * (screen) or nothing (face) shows through — not a guard that hides a missing step
 * [LAW:no-defensive-null-guards]. The API secret never reaches here; the browser holds only
 * a short-lived subscribe-only token [LAW:effects-at-boundaries].
 */
export function StreamPlayer({ slug }: { readonly slug: string }) {
  const screenRef = useRef<HTMLVideoElement>(null);
  const faceRef = useRef<HTMLVideoElement>(null);
  // Which surfaces carry a track right now. Each flag drives only its surface's opacity —
  // present covers, absent reveals — so "is there video" is one piece of derived view
  // state per surface, never a second source of truth about liveness [LAW:one-source-of-truth].
  const [shown, setShown] = useState<{ screen: boolean; face: boolean }>({ screen: false, face: false });

  useEffect(() => {
    const screen = screenRef.current;
    const face = faceRef.current;
    if (screen === null || face === null) return;
    const elementFor = (surface: StreamSurface): HTMLVideoElement =>
      surface === 'screen' ? screen : face;

    let room: Room | null = null;
    let cancelled = false;

    const attach = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Video) return;
      const surface = surfaceOf(pub.source);
      if (surface === null) return;
      track.attach(elementFor(surface));
      setShown((s) => ({ ...s, [surface]: true }));
    };
    const detach = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Video) return;
      const surface = surfaceOf(pub.source);
      if (surface === null) return;
      track.detach(elementFor(surface));
      setShown((s) => ({ ...s, [surface]: false }));
    };

    void (async () => {
      const conn = await viewerConnection(slug);
      // No SFU in this config, or this effect was already torn down while we awaited:
      // either way there is nothing to connect, and the placeholder stays visible.
      if (conn === null || cancelled) return;
      room = new Room();
      room
        .on(RoomEvent.TrackSubscribed, attach)
        .on(RoomEvent.TrackUnsubscribed, detach)
        .on(RoomEvent.Disconnected, () => setShown({ screen: false, face: false }));
      await room.connect(conn.url, conn.token);
      // Tear-down may have fired during the connect handshake; honor it so we never leak
      // a live room behind an unmounted surface [LAW:no-ambient-temporal-coupling].
      if (cancelled) room.disconnect();
    })();

    return () => {
      cancelled = true;
      setShown({ screen: false, face: false });
      room?.disconnect();
    };
  }, [slug]);

  return (
    <>
      <video
        ref={screenRef}
        autoPlay
        playsInline
        // Muted so the browser never blocks autoplay; an audio/unmute control is a
        // follow-up, not a silent omission.
        muted
        className={`absolute inset-0 h-full w-full bg-ink object-contain transition-opacity duration-300 ${
          shown.screen ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <video
        ref={faceRef}
        autoPlay
        playsInline
        muted
        // The builder's face, composited over the build in the corner. Hidden entirely when
        // there is no camera track — a builder who streams screen-only shows no overlay.
        className={`pointer-events-none absolute bottom-3 right-3 aspect-video w-1/5 max-w-[200px] rounded-lg border border-edge bg-ink object-cover shadow-xl transition-opacity duration-300 ${
          shown.face ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </>
  );
}
