'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Room, RoomEvent, Track, createLocalScreenTracks, type LocalTrack } from 'livekit-client';

import type { GoLiveResult } from '@/data/go-live-result';
import { endLive, goLive } from '@/server/stream-actions';

/**
 * The builder's go-live control — the PRODUCT path for "someone building, live": it
 * captures the builder's screen and publishes it into their LiveKit room. It does ONE
 * thing and owns ONE thing: the publish lifecycle [LAW:composability].
 *
 * Phase is OWNED STATE, never inferred from render order or an incidental callback
 * [LAW:no-ambient-temporal-coupling]: `offline → connecting → live → offline`. Going
 * live acquires the credential, connects, and publishes; ending unpublishes,
 * disconnects, and tears the room down through the broker. Every way a stream can end —
 * the builder clicks "end", the browser's own "stop sharing", or a remote disconnect —
 * routes through the SAME re-entrant {@link teardown}, so there is one teardown path, not
 * three that could race [LAW:single-enforcer].
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
    setPhase(OFFLINE);
    if (closeServerSide) await endLive();
  };

  const onGoLive = async () => {
    if (phase.kind !== 'offline') return;
    setPhase({ kind: 'connecting' });

    // Capture FIRST, synchronously within the click's transient activation — before the
    // awaited `goLive()` round-trip — or the browser blocks the screen picker.
    let tracks: LocalTrack[];
    try {
      tracks = await createLocalScreenTracks({ audio: true });
    } catch {
      setPhase({ kind: 'offline', notice: CAPTURE_CANCELLED });
      return;
    }

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
    // "stop sharing" ends the screen track, end the stream through the same owner.
    const screen = tracks.find((t) => t.kind === Track.Kind.Video);
    const preview = previewRef.current;
    if (screen !== undefined) {
      if (preview !== null) screen.attach(preview);
      screen.mediaStreamTrack.addEventListener('ended', () => void teardown(true), { once: true });
    }

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
