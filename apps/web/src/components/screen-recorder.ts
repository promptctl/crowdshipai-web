/**
 * Record a set of captured media tracks into a locally-downloaded file — one thing,
 * completely, asking nothing [LAW:composability]: it takes tracks it did not capture
 * and a filename it did not choose, and neither knows nor cares about rooms, phases,
 * or transports. The recording rides the BUILDER's local capture, so it is unaffected
 * by the network — a reconnect drops frames for the audience, never for the file.
 *
 * The artifact is real: `MediaRecorder` encodes the live tracks into WebM chunks as
 * they happen, and `stop()` assembles them and hands the file to the browser's own
 * download path. No platform storage, no upload — the builder owns their recording
 * outright, which is the honest v1 of "recording" (a server-side VOD pipeline is a
 * later feature on top of real infrastructure, not a pretend REC light)
 * [LAW:no-silent-failure].
 *
 * Lifecycle is explicit and single-owner [LAW:no-ambient-temporal-coupling]: `start`
 * returns the recording as a handle whose one `stop()` both ends the encode and
 * delivers the file; the handle is inert after — a second stop is a no-op echo, so the
 * caller's teardown may stop it unconditionally.
 */

export interface ScreenRecording {
  /** End the recording and deliver the file. Idempotent — an echo finds nothing to do. */
  stop(): void;
}

export const startScreenRecording = (tracks: readonly MediaStreamTrack[], filename: string): ScreenRecording => {
  const recorder = new MediaRecorder(new MediaStream([...tracks]));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // The blob must outlive the click that starts the download; revoking on the next
    // macrotask is the documented-safe point to release it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Chunk on an interval rather than one buffer at stop, so an hours-long session
  // accumulates many small blobs instead of relying on one giant final flush.
  recorder.start(1000);

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
};
