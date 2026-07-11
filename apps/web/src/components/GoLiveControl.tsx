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

import { startScreenRecording, type ScreenRecording } from './screen-recorder';

/**
 * The builder's go-live control — the PRODUCT path for "someone building, live": it
 * captures the builder's screen AND their webcam and publishes both into their LiveKit
 * room as distinct tracks, so the audience sees both the build and the builder's face. It
 * does ONE thing and owns ONE thing: the publish lifecycle [LAW:composability].
 *
 * Phase is OWNED STATE, never inferred from render order or an incidental callback
 * [LAW:no-ambient-temporal-coupling]: `offline → connecting → live ⇄ reconnecting →
 * offline`. Going live acquires the credential, connects, and publishes; a transport
 * drop the client is re-establishing is the REPRESENTED `reconnecting` arm driven by
 * the room's own events — never an inferred flag or a settle delay
 * [LAW:types-are-the-program]; ending unpublishes, disconnects, and tears the room down
 * through the broker. Every way a stream can end — the builder clicks "end", the
 * browser's own "stop sharing", a remote disconnect, or the tab itself going away
 * (unmount and `pagehide` fire a beacon the page's death cannot cancel, so the server
 * never lies "live" for a closed tab) — routes through the SAME re-entrant
 * {@link teardown}, so there is one teardown path, not four that could race
 * [LAW:single-enforcer]. The camera is held in the SAME room as the screen, so
 * `disconnect()` stops both local tracks through that one owner — the face never needs
 * its own teardown path.
 *
 * RECORDING is a facet of being live, not a fifth phase: it exists exactly while a
 * local capture does (`live` and `reconnecting` carry it; the other arms cannot
 * represent it) [LAW:types-are-the-program]. It records the builder's LOCAL screen
 * tracks, so a reconnect drops frames for the audience but never for the file; ending
 * the stream in any way stops the recording through the one teardown and still
 * delivers the file.
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
 *  stream" is not a state that can exist — and `recording` is representable ONLY while
 *  a capture exists, so "recording while offline" cannot either
 *  [LAW:types-are-the-program]. */
type Phase =
  | { readonly kind: 'offline'; readonly notice: string | null }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'live'; readonly recording: boolean }
  | { readonly kind: 'reconnecting'; readonly recording: boolean };

const OFFLINE: Phase = { kind: 'offline', notice: null };

/** The beacon target that ends this builder's stream when the page itself goes away —
 *  the same one shared server end-path the explicit action rides [LAW:one-source-of-truth]. */
const END_BEACON_PATH = '/studio/live/end';

const recordingFilename = (slug: string): string =>
  `crowdship-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;

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
    case 'barred':
      // The policy boundary's denial, in the moderator's own words — a refusal that
      // cannot say why is a silent one [LAW:no-silent-failure].
      return `You cannot go live: ${result.reason}`;
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
  // The captured screen tracks (video + audio, never the face), held so a recording
  // started mid-stream records the same capture that is publishing — one capture, two
  // consumers, no second getDisplayMedia [LAW:one-source-of-truth].
  const screenMediaRef = useRef<readonly MediaStreamTrack[]>([]);
  // The active recording handle — a resource like the room, owned by the same teardown.
  const recorderRef = useRef<ScreenRecording | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const facePreviewRef = useRef<HTMLVideoElement>(null);
  // Whether the builder's own face is previewing right now — view state only, driving the
  // face overlay's presence so an absent camera shows no black box, never a second source
  // of truth about liveness [LAW:one-source-of-truth].
  const [faceShown, setFaceShown] = useState(false);

  // The ONE teardown path. The first call (a room is held) ends the stream; any echo —
  // the `Disconnected` event that `disconnect()` itself emits, a stop-sharing racing the
  // button — finds no room and returns. An active recording stops FIRST, so ending the
  // stream in any way still delivers the file [LAW:no-silent-failure]. `disconnect()`
  // unpublishes and stops the local tracks; `endLive()` tears the room down server-side,
  // skipped only when the room is already gone remotely [LAW:no-ambient-temporal-coupling].
  const teardown = async (closeServerSide: boolean) => {
    const room = roomRef.current;
    if (room === null) return;
    roomRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    screenMediaRef.current = [];
    room.disconnect();
    setFaceShown(false);
    setPhase(OFFLINE);
    if (closeServerSide) await endLive();
  };

  // End the stream when the PAGE goes away — the one ending a server action cannot
  // carry, because the request would die with the tab. Guarded by the same roomRef
  // re-entry gate as teardown: a tab that is not live sends nothing, and a stream the
  // teardown already ended sends nothing either. Best-effort by nature (a dead network
  // loses it), and the SFU's empty-timeout remains the backstop — this makes the
  // COMMON case honest now instead of five minutes late [LAW:no-silent-failure].
  const endViaBeacon = () => {
    if (roomRef.current === null) return;
    navigator.sendBeacon(END_BEACON_PATH);
  };

  // The transport's re-establishment window, as represented state driven by the room's
  // own events — the room is the one timing authority; this only mirrors its
  // transitions, preserving the recording facet because the LOCAL capture (and so the
  // file) never blinked [LAW:no-ambient-temporal-coupling]. A frame from another phase
  // is an echo of a transition this owner already left; it changes nothing.
  const onReconnecting = () =>
    setPhase((p) => (p.kind === 'live' ? { kind: 'reconnecting', recording: p.recording } : p));
  const onReconnected = () =>
    setPhase((p) => (p.kind === 'reconnecting' ? { kind: 'live', recording: p.recording } : p));

  // Start or stop recording the local screen capture — legal only while a capture
  // exists, which is exactly the arms that can represent it [LAW:types-are-the-program].
  const onToggleRecording = () => {
    if (phase.kind !== 'live' && phase.kind !== 'reconnecting') return;
    if (phase.recording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      setPhase({ ...phase, recording: false });
      return;
    }
    recorderRef.current = startScreenRecording(screenMediaRef.current, recordingFilename(slug));
    setPhase({ ...phase, recording: true });
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
    // already gone server-side, so no `endLive()` is owed. The client's own
    // re-establishment window is NOT terminal — it is the `reconnecting` arm, entered
    // and left on the room's events, never a settle delay [LAW:no-ambient-temporal-coupling].
    room.on(RoomEvent.Disconnected, () => void teardown(false));
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
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

    // What a recording started later will record: the screen capture (build + its
    // audio), never the face — the same tracks that are publishing.
    screenMediaRef.current = screenTracks.map((t) => t.mediaStreamTrack);
    roomRef.current = room;
    setPhase({ kind: 'live', recording: false });
  };

  // The page-death endings, both routed through the same beacon and guards as every
  // other ending [LAW:single-enforcer]: `pagehide` covers the tab closing or navigating
  // away at the browser level; the cleanup covers an in-app navigation unmounting this
  // owner. Either way a live capture cannot survive the page, so the stream is OVER —
  // the beacon makes the server say so now, and an active recording is stopped so the
  // file is delivered where delivery is still possible (unmount; a closing tab cannot
  // receive a download, which is the medium's limit, not a swallowed file).
  useEffect(() => {
    window.addEventListener('pagehide', endViaBeacon);
    return () => {
      window.removeEventListener('pagehide', endViaBeacon);
      recorderRef.current?.stop();
      recorderRef.current = null;
      endViaBeacon();
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  // The two arms with a live capture — one derived value so every surface below reads
  // the same answer to "is there a stream right now" [LAW:one-source-of-truth].
  const streaming = phase.kind === 'live' || phase.kind === 'reconnecting';

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
            streaming ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <video
          ref={facePreviewRef}
          autoPlay
          playsInline
          muted
          className={`absolute bottom-3 right-3 aspect-video w-1/4 max-w-[140px] rounded-md border border-edge bg-ink object-cover shadow-lg transition-opacity duration-300 ${
            streaming && faceShown ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {!streaming && (
          <div className="absolute inset-0 grid place-items-center text-sm text-fog">
            {phase.kind === 'connecting' ? 'connecting…' : 'your screen appears here once you go live'}
          </div>
        )}
        {phase.kind === 'reconnecting' && (
          <div className="absolute inset-x-0 top-0 bg-amber-500/90 px-3 py-1.5 text-center text-xs font-semibold text-ink">
            reconnecting… your capture is intact; the audience will pick you back up in a moment
          </div>
        )}
        {streaming && phase.recording && (
          <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-sm bg-red-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
            REC
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {streaming ? (
          <>
            <button
              type="button"
              onClick={() => void teardown(true)}
              className="rounded-full bg-red-500/90 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
            >
              end stream
            </button>
            <button
              type="button"
              onClick={onToggleRecording}
              className="rounded-full border border-edge bg-surface-2 px-5 py-2 text-sm font-semibold text-chalk transition-colors hover:border-accent-dim hover:text-accent"
            >
              {phase.recording ? 'stop recording' : 'record'}
            </button>
          </>
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
