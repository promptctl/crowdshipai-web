'use client';

import { useActionState, useCallback, useState } from 'react';

import type { OverlayAuthorResult } from '@/data/overlay-result';
import {
  OVERLAY_DURATION_SECONDS,
  OVERLAY_PLACEMENTS,
  overlayStyleFrom,
  type OverlayPlacement,
  type OverlayStyle,
} from '@/data/overlay-style';
import { setOverlayAction } from '@/server/overlay-actions';

import { EffectOverlay, type OverlayToast } from './EffectOverlay';

/**
 * The builder's overlay-styling surface — where they shape how fired effects land on
 * their stream. The founding line, made into a form: the corner, the hue, and the
 * residency are THEIR values; the rail contributes only the bounds and the transport.
 *
 * The preview is not a mockup: it renders through the SAME {@link EffectOverlay} the
 * watch surface uses, driven by the style exactly as the form would submit it, so
 * what the builder sees firing here is what their audience sees firing there
 * [LAW:one-source-of-truth]. A candidate outside the rail's bounds has no preview —
 * an honest "this will be refused", never a clamped look the save would then betray
 * [LAW:no-silent-failure].
 *
 * The reason line is an EXHAUSTIVE match over every non-`saved`
 * {@link OverlayAuthorResult} arm, so a new outcome the core can return is a compile
 * error here rather than a silently blank notice
 * [LAW:dataflow-not-control-flow][LAW:no-silent-failure].
 */

const resultNotice = (result: Exclude<OverlayAuthorResult, { kind: 'saved' }>): string => {
  switch (result.kind) {
    case 'must-authenticate':
      return 'Sign in to style your overlay.';
    case 'no-channel':
      return 'Claim a channel before styling your overlay.';
    case 'invalid':
      return `Out of bounds: ${result.problems.join(', ')} — fix and save again.`;
  }
};

/** The builder-facing name of each corner — a value map over the closed placement
 *  set, exhaustive by construction [LAW:dataflow-not-control-flow]. */
const PLACEMENT_LABEL: Readonly<Record<OverlayPlacement, string>> = {
  'top-left': 'top left',
  'top-right': 'top right',
  'bottom-left': 'bottom left',
  'bottom-right': 'bottom right',
};

/** The sample the preview fires — a stand-in offer in the builder's own idiom, so
 *  the preview shows the shape their real offers will take. */
const SAMPLE_DISPLAY = { label: 'Shoutout', summary: 'I read your name out loud, on stream.' };

export function OverlayStyleForm({ initialStyle }: { readonly initialStyle: OverlayStyle }) {
  const [placement, setPlacement] = useState<OverlayPlacement>(initialStyle.placement);
  const [accentHue, setAccentHue] = useState(String(initialStyle.accentHue));
  const [durationSeconds, setDurationSeconds] = useState(String(initialStyle.durationSeconds));
  const [previewToasts, setPreviewToasts] = useState<readonly OverlayToast[]>([]);
  const [state, formAction, pending] = useActionState<OverlayAuthorResult | null, FormData>(
    setOverlayAction,
    null,
  );

  // The candidate style exactly as submitting now would have the rail judge it —
  // the preview and the save share one legality line [LAW:single-enforcer]. `null`
  // means the save would refuse, and the preview says so instead of showing a look
  // the audience would never get.
  const candidate = overlayStyleFrom({
    placement,
    accentHue: Number(accentHue),
    durationSeconds: Number(durationSeconds),
  });

  const expirePreview = useCallback(
    (ids: readonly string[]) => setPreviewToasts((prev) => prev.filter((t) => !ids.includes(t.id))),
    [],
  );
  const firePreview = () =>
    setPreviewToasts((prev) => [
      ...prev,
      { id: `preview-${Date.now()}-${prev.length}`, effectKind: 'shoutout', display: SAMPLE_DISPLAY, firedAtMs: Date.now() },
    ]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <fieldset className="flex flex-col gap-1 text-xs text-fog">
          <legend className="mb-1">corner</legend>
          <input type="hidden" name="placement" value={placement} />
          <div className="grid grid-cols-2 gap-1">
            {OVERLAY_PLACEMENTS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={placement === p}
                onClick={() => setPlacement(p)}
                className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                  placement === p
                    ? 'border-accent-dim bg-accent/10 text-accent'
                    : 'border-edge bg-surface text-fog hover:text-chalk'
                }`}
              >
                {PLACEMENT_LABEL[p]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-fog">
          hue
          <input
            type="range"
            name="accentHue"
            min={0}
            max={360}
            value={accentHue}
            onChange={(e) => setAccentHue(e.target.value)}
            className="mt-2 w-40"
          />
          <span
            className="mt-1 inline-block h-4 w-full rounded-sm"
            style={{ background: `hsl(${Number(accentHue)} 70% 45%)` }}
            aria-hidden
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fog">
          seconds on screen ({OVERLAY_DURATION_SECONDS.min}–{OVERLAY_DURATION_SECONDS.max})
          <input
            type="number"
            name="durationSeconds"
            min={OVERLAY_DURATION_SECONDS.min}
            max={OVERLAY_DURATION_SECONDS.max}
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(e.target.value)}
            className="w-24 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
          />
        </label>
      </div>

      {/* The preview stage: the real overlay renderer over a stand-in video box. */}
      <div className="relative w-full overflow-hidden rounded-lg border border-edge bg-ink" style={{ aspectRatio: '16 / 9' }}>
        <div className="absolute inset-0 grid place-items-center text-xs text-fog">your stream</div>
        {candidate !== null ? (
          <EffectOverlay style={candidate} toasts={previewToasts} onExpire={expirePreview} />
        ) : (
          <p className="absolute bottom-3 left-3 text-xs font-semibold text-live">
            out of bounds — this style would be refused
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={firePreview}
          disabled={candidate === null}
          className="rounded-full border border-edge px-4 py-2 text-sm font-semibold text-chalk transition-colors hover:border-accent-dim disabled:opacity-50"
        >
          ⚡ test-fire an effect
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save overlay'}
        </button>
      </div>

      {state !== null && state.kind === 'saved' && (
        <p role="status" className="text-xs font-semibold text-accent">
          Overlay saved — your audience sees the new look live.
        </p>
      )}
      {state !== null && state.kind !== 'saved' && (
        <p role="alert" className="text-xs font-semibold text-live">
          {resultNotice(state)}
        </p>
      )}
    </form>
  );
}
