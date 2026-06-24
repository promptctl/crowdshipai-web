'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

import { viewerConnection } from '@/server/stream-actions';

/**
 * The live video subscriber that binds behind the {@link StreamStage} placeholder on the
 * watch surface. It does ONE thing — turn a builder's slug into their screen, on screen —
 * and asks nothing of the rest of the surface [LAW:composability].
 *
 * This effect is the ONE timing authority for the connection's whole lifecycle
 * [LAW:no-ambient-temporal-coupling]: it connects on mount, attaches the remote video
 * track to the `<video>` the instant LiveKit reports it (`TrackSubscribed`), detaches it
 * on `TrackUnsubscribed`/`Disconnected`, and tears the room down on unmount or slug
 * change. Nothing here relies on render order or a settle delay — attach/detach are
 * driven by room events, not by when React paints.
 *
 * An absent connection (the in-memory fake → `null`) and an absent track (connected but
 * the builder is not publishing yet) are the SAME honest "not live yet" state, rendered
 * by leaving the `<video>` transparent so the placeholder shows through — not a guard
 * that hides a missing step [LAW:no-defensive-null-guards]. The API secret never reaches
 * here; the browser holds only a short-lived subscribe-only token [LAW:effects-at-boundaries].
 */
export function StreamPlayer({ slug }: { readonly slug: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Whether a remote video track is attached right now. It drives only opacity — a
  // present track covers the placeholder, an absent one reveals it — so "is there video"
  // is one piece of derived view state, never a second source of truth about liveness
  // [LAW:one-source-of-truth].
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;

    let room: Room | null = null;
    let cancelled = false;

    const attach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Video) return;
      track.attach(video);
      setHasVideo(true);
    };
    const detach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Video) return;
      track.detach(video);
      setHasVideo(false);
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
        .on(RoomEvent.Disconnected, () => setHasVideo(false));
      await room.connect(conn.url, conn.token);
      // Tear-down may have fired during the connect handshake; honor it so we never leak
      // a live room behind an unmounted surface [LAW:no-ambient-temporal-coupling].
      if (cancelled) room.disconnect();
    })();

    return () => {
      cancelled = true;
      setHasVideo(false);
      room?.disconnect();
    };
  }, [slug]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      // Muted so the browser never blocks autoplay; the v1 slice carries the builder's
      // screen, and an audio/unmute control is a follow-up, not a silent omission.
      muted
      className={`absolute inset-0 h-full w-full bg-ink object-contain transition-opacity duration-300 ${
        hasVideo ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
