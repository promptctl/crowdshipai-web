'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Room,
  RoomEvent,
  Track,
  createLocalScreenTracks,
  createLocalVideoTrack,
  type LocalTrack,
  type LocalVideoTrack,
} from 'livekit-client';

import type { GoLiveResult } from '@/data/go-live-result';
import { endLive, goLive } from '@/server/stream-actions';

/**
 * The builder's go-live control — the PRODUCT path for "someone building, live": it
 * captures the builder's screen AND their webcam and publishes both into their LiveKit
 * room as distinct tracks, so the audience sees both the build and the builder's face. It
 * does ONE thing and owns ONE thing: the publish lifecycle [LAW:composability].
 *
 * Phase is OWNED STATE, never inferred from render order or an incidental callback
 * [LAW:no-ambient-temporal-coupling]: `offline → connecting → live → offline`. Going
 * live acquires the credential, connects, and publishes; ending unpublishes,
 * disconnects, and tears the room down through the broker. Every way a stream can end —
 * the builder clicks "end", the browser's own "stop sharing", or a remote disconnect —
 * routes through the SAME re-entrant {@link teardown}, so there is one teardown path, not
 * three that could race [LAW:single-enforcer]. The camera is held in the SAME room as the
 * screen, so `disconnect()` stops both local tracks through that one owner — the face
 * never needs its own teardown path.
 *
 * The webcam is an OPTIONAL track: a builder with no camera, or who denies the permission,
 * still streams their screen — the face is honest absence (`null`), not a hard gate on
 * going live [LAW:no-silent-failure]. Both captures complete within the click's transient
 * activation, before the awaited `goLive()` round-trip, so the browser grants both.
 *
 * The browser never sees the API secret: `goLive()` returns only a short-lived,
 * server-signed publish token, and the server — not this client — decides WHICH channel
 * it publishes to from the authenticated principal [LAW:effects-at-boundaries].
 */

/** The publish lifecycle as a closed union: `notice` (the reason a prior attempt ended
 *  or was refused) is representable ONLY while offline, so "a notice during a live
 *  stream" is not a state that can exist [LAW:types-are-the-program]. */
type Phase =
  | { readonly kind: 'offline'; readonly notice: string | null }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'live' };

const OFFLINE: Phase = { kind: 'offline', notice: null };

const CAPTURE_CANCELLED = 'Screen capture was cancelled — pick a window or screen to go live.';
const CONNECT_FAILED = 'Could not connect to the stream. Try going live again.';

/**
 * Capture the builder's webcam as an optional face track. No camera, a denied permission,
 * or any other capture failure is honest absence — `null`, not a thrown failure — so the
 * screen still goes live regardless of the camera's state [LAW:no-silent-failure]: going
 * live is never blocked on the optional track. The error is logged, not swallowed, so a
 * genuine fault (a NotReadableError, an in-use device) leaves a diagnostic trail rather
 * than vanishing behind a silent fallback. The track carries `Source.Camera`, the
 * discriminator the viewer routes the face onto its overlay by [LAW:types-are-the-program].
 */
const captureFace = async (): Promise<LocalVideoTrack | null> => {
  try {
    return await createLocalVideoTrack();
  } catch (error) {
    console.warn('Webcam capture unavailable; going live screen-only.', error);
    return null;
  }
};

/**
 * Why a go-live attempt did not reach `live`, as a message for the builder — the
 * exhaustive surface of every non-`ready` {@link GoLiveResult} arm, so a new outcome is
 * a compile error here rather than a silently blank notice [LAW:dataflow-not-control-flow].
 */
const blockedNotice = (result: Exclude<GoLiveResult, { kind: 'ready' }>): string => {
  switch (result.kind) {
    case 'must-authenticate':
      return 'Sign in to go live.';
    case 'no-channel':
      return 'Claim a channel before you go live.';
    case 'no-sfu':
      return 'Live streaming is not configured in this environment yet.';
    case 'already-live':
      return 'This channel is already live in another tab or session.';
    case 'provider-unavailable':
      return 'The streaming provider is unreachable. Try again in a moment.';
  }
};

export function GoLiveControl({ slug }: { readonly slug: string }) {
  const [phase, setPhase] = useState<Phase>(OFFLINE);
  // The live room is a mutable resource handle, not render data — it lives in a ref so
  // the lifecycle owner reaches the one room across the go-live and end interactions, and
  // `roomRef` doubles as the re-entry guard: a teardown with no room is a no-op echo.
  const roomRef = useRef<Room | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const facePreviewRef = useRef<HTMLVideoElement>(null);
  // Whether the builder's own face is previewing right now — view state only, driving the
  // face overlay's presence so an absent camera shows no black box, never a second source
  // of truth about liveness [LAW:one-source-of-truth].
  const [faceShown, setFaceShown] = useState(false);

  // The ONE teardown path. The first call (a room is held) ends the stream; any echo —
  // the `Disconnected` event that `disconnect()` itself emits, a stop-sharing racing the
  // button — finds no room and returns. `disconnect()` unpublishes and stops the local
  // tracks; `endLive()` tears the room down server-side, skipped only when the room is
  // already gone remotely [LAW:no-ambient-temporal-coupling].
  const teardown = async (closeServerSide: boolean) => {
    const room = roomRef.current;
    if (room === null) return;
    roomRef.current = null;
    room.disconnect();
    setFaceShown(false);
    setPhase(OFFLINE);
    if (closeServerSide) await endLive();
  };

  const onGoLive = async () => {
    if (phase.kind !== 'offline') return;
    setPhase({ kind: 'connecting' });

    // Capture FIRST, synchronously within the click's transient activation — before the
    // awaited `goLive()` round-trip — or the browser blocks the screen picker. The screen
    // is the hard gate (cancelling it cancels go-live); the face is captured right after,
    // still within the gesture, and folded into ONE track list so every downstream path —
    // publish, cleanup, teardown — treats camera-present and camera-absent identically:
    // an absent face is an empty slice, not a branch [LAW:dataflow-not-control-flow].
    let screenTracks: LocalTrack[];
    try {
      screenTracks = await createLocalScreenTracks({ audio: true });
    } catch {
      setPhase({ kind: 'offline', notice: CAPTURE_CANCELLED });
      return;
    }
    const face = await captureFace();
    const tracks: LocalTrack[] = face === null ? screenTracks : [...screenTracks, face];

    const result = await goLive();
    if (result.kind !== 'ready') {
      tracks.forEach((t) => t.stop());
      setPhase({ kind: 'offline', notice: blockedNotice(result) });
      return;
    }

    const room = new Room();
    // A terminal remote disconnect ends the stream through the same owner; the room is
    // already gone server-side, so no `endLive()` is owed [LAW:no-ambient-temporal-coupling].
    room.on(RoomEvent.Disconnected, () => void teardown(false));
    try {
      await room.connect(result.connection.url, result.connection.token);
      for (const track of tracks) await room.localParticipant.publishTrack(track);
    } catch {
      tracks.forEach((t) => t.stop());
      room.disconnect();
      setPhase({ kind: 'offline', notice: CONNECT_FAILED });
      return;
    }

    // The builder's own preview, plus the stop-sharing wire: when the browser's native
    // "stop sharing" ends the screen track, end the stream through the same owner. The
    // screen is found by SOURCE, not kind — the camera is also a video track, so kind no
    // longer singles out the screen [LAW:types-are-the-program].
    const screen = tracks.find((t) => t.source === Track.Source.ScreenShare);
    const preview = previewRef.current;
    if (screen !== undefined) {
      if (preview !== null) screen.attach(preview);
      screen.mediaStreamTrack.addEventListener('ended', () => void teardown(true), { once: true });
    }
    // Mirror what the audience sees: preview the builder's own face when a camera was
    // captured, so they can confirm it is live; absent camera shows no overlay at all.
    if (face !== null && facePreviewRef.current !== null) face.attach(facePreviewRef.current);
    setFaceShown(face !== null);

    roomRef.current = room;
    setPhase({ kind: 'live' });
  };

  // On unmount, leave cleanly: disconnect the room locally. The server-side room is
  // reaped by LiveKit's empty-timeout, so a closed tab is a clean leave without relying
  // on an action firing during teardown [LAW:no-ambient-temporal-coupling].
  useEffect(
    () => () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative w-full overflow-hidden rounded-lg border border-edge bg-ink"
        style={{ aspectRatio: '16 / 9' }}
      >
        <video
          ref={previewRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            phase.kind === 'live' ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <video
          ref={facePreviewRef}
          autoPlay
          playsInline
          muted
          className={`absolute bottom-3 right-3 aspect-video w-1/4 max-w-[140px] rounded-md border border-edge bg-ink object-cover shadow-lg transition-opacity duration-300 ${
            phase.kind === 'live' && faceShown ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {phase.kind !== 'live' && (
          <div className="absolute inset-0 grid place-items-center text-sm text-fog">
            {phase.kind === 'connecting' ? 'connecting…' : 'your screen appears here once you go live'}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {phase.kind === 'live' ? (
          <button
            type="button"
            onClick={() => void teardown(true)}
            className="rounded-full bg-red-500/90 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            end stream
          </button>
        ) : (
          <button
            type="button"
            disabled={phase.kind === 'connecting'}
            onClick={() => void onGoLive()}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase.kind === 'connecting' ? 'going live…' : 'go live'}
          </button>
        )}

        {phase.kind === 'live' && (
          <Link href={`/watch/${slug}`} className="text-sm text-accent hover:underline">
            watch your stream →
          </Link>
        )}
      </div>

      {phase.kind === 'offline' && phase.notice !== null && (
        <p className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs leading-snug text-fog">
          {phase.notice}
        </p>
      )}
    </div>
  );
}
