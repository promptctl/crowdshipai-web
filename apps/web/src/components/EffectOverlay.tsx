'use client';

import { useEffect } from 'react';

import type { OfferDisplay } from '@/data/offer-display';
import type { OverlayPlacement, OverlayStyle } from '@/data/overlay-style';

/**
 * The overlay: fired effects landing ON the stream, rendered in the builder's
 * authored style. ONE renderer serves the watch stage and the studio's preview, so
 * what the builder authors is literally what the audience sees — the preview cannot
 * drift from the broadcast look [LAW:one-source-of-truth].
 *
 * The look is the builder's — their corner, their hue, their residency — carried
 * entirely by the {@link OverlayStyle} VALUE; this component holds no opinions of its
 * own beyond rendering that value [LAW:dataflow-not-control-flow]. The builder's
 * words (the offer's label and summary, riding the fired frame's open params) render
 * as React text nodes, escaped by construction — their creative shape can never
 * become script in a watcher's browser: that boundary is the transport's integrity,
 * the one thing that is ours.
 *
 * This component is the NAMED TIMING AUTHORITY for a toast's residency
 * [LAW:no-ambient-temporal-coupling]: it owns the single timer that retires the
 * oldest toast when its time is up, and asks the list's owner to drop it via
 * `onExpire`. State stays with the surface that routes the frames; WHEN a toast has
 * aged out is decided here and nowhere else.
 */

/** One fired effect as it lives on the overlay: identity for React and expiry, the
 *  open kind, the builder's words when the frame carried them, and the instant it
 *  fired — residency is derived from `firedAtMs` against the CURRENT style, so a
 *  builder shortening their duration mid-stream retires standing toasts too: the
 *  look, applied live [LAW:one-source-of-truth]. */
export interface OverlayToast {
  readonly id: string;
  readonly effectKind: string;
  readonly display?: OfferDisplay;
  readonly firedAtMs: number;
}

/** Where each placement pins the toast stack inside the 16:9 stage — a value map
 *  over the closed placement set, so a new placement is a compile error here, never
 *  a toast rendered nowhere [LAW:dataflow-not-control-flow]. The top-left slot sits
 *  below the LIVE badge, which always paints in that corner. */
/** The toast's headline: the builder's own label when the frame carried one worth
 *  reading, else the effect's open kind — a fired effect always has a name on the
 *  overlay, never a blank card [LAW:no-silent-failure]. */
const titleOf = (toast: OverlayToast): string =>
  toast.display !== undefined && toast.display.label.trim().length > 0 ? toast.display.label : toast.effectKind;

const PLACEMENT_CLASS: Readonly<Record<OverlayPlacement, string>> = {
  'top-left': 'left-3 top-12 items-start',
  'top-right': 'right-3 top-3 items-end',
  'bottom-left': 'bottom-3 left-3 items-start',
  'bottom-right': 'bottom-3 right-3 items-end',
};

export function EffectOverlay({
  style,
  toasts,
  onExpire,
}: {
  readonly style: OverlayStyle;
  readonly toasts: readonly OverlayToast[];
  /** Drop these toasts from the list — called by this component's one expiry timer. */
  readonly onExpire: (ids: readonly string[]) => void;
}) {
  // One timer at a time, aimed at the earliest deadline among the standing toasts.
  // Recomputed whenever the list or the residency changes; torn down on unmount —
  // no timer ever outlives the overlay it retires toasts for
  // [LAW:no-ambient-temporal-coupling].
  useEffect(() => {
    if (toasts.length === 0) return;
    const ttlMs = style.durationSeconds * 1000;
    const now = Date.now();
    const expired = toasts.filter((t) => t.firedAtMs + ttlMs <= now).map((t) => t.id);
    if (expired.length > 0) {
      onExpire(expired);
      return;
    }
    const nextDeadline = Math.min(...toasts.map((t) => t.firedAtMs + ttlMs));
    const timer = setTimeout(() => {
      onExpire(toasts.filter((t) => t.firedAtMs + ttlMs <= Date.now()).map((t) => t.id));
    }, nextDeadline - now);
    return () => clearTimeout(timer);
  }, [toasts, style.durationSeconds, onExpire]);

  return (
    <div
      aria-live="polite"
      data-placement={style.placement}
      className={`pointer-events-none absolute z-10 flex max-w-[70%] flex-col gap-2 ${PLACEMENT_CLASS[style.placement]}`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-md border px-3 py-2 shadow-lg backdrop-blur-sm"
          style={{
            borderColor: `hsl(${style.accentHue} 70% 55% / 0.6)`,
            background: `hsl(${style.accentHue} 60% 18% / 0.85)`,
          }}
        >
          <p className="text-sm font-semibold leading-snug" style={{ color: `hsl(${style.accentHue} 80% 78%)` }}>
            ⚡ {titleOf(toast)}
          </p>
          {toast.display !== undefined && toast.display.summary.trim().length > 0 && (
            <p className="mt-0.5 text-xs leading-snug text-chalk/80">{toast.display.summary}</p>
          )}
        </div>
      ))}
    </div>
  );
}
