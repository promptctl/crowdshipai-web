import type { MaturityLevel } from '@crowdship/moderation';

/**
 * Shown in place of the stream when the age gate (o97.3) returns `gated`: the
 * content is fine, this viewer simply is not cleared to see it yet. It names the
 * `required` standing the gate reported so the prompt asks for exactly that — never
 * a guess — mirroring how the gate carries `required` rather than a bare refusal.
 *
 * It occupies the stream's own 16:9 slot so the page does not reflow between a
 * shown stream and a gated one; the surrounding identity and menu stay visible,
 * because a viewer may always see WHO a builder is and what they offer — only the
 * rated content itself waits behind clearance.
 *
 * There is no working "verify" action yet: age verification is a fact the platform
 * does not record, so no viewer can clear above the baseline. The prompt states the
 * honest situation rather than offering a button that resolves nothing
 * [LAW:no-silent-failure]; the CTA lands when the verification flow does.
 */
export function MaturityGate({ required }: { readonly required: MaturityLevel }) {
  return (
    <div
      className="relative grid w-full place-items-center overflow-hidden rounded-lg border border-edge bg-surface-2 px-6 text-center"
      style={{ aspectRatio: '16 / 9' }}
    >
      <div className="max-w-sm">
        <span className="inline-flex items-center rounded-sm bg-ink/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-chalk">
          {required}
        </span>
        <p className="mt-3 text-sm font-semibold text-chalk">This stream is rated {required}.</p>
        <p className="mt-1 text-xs text-fog">
          Verify you can view {required} content to watch. Age verification is coming soon.
        </p>
      </div>
    </div>
  );
}
