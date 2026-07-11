/**
 * The builder's overlay style — the creative shape of how fired effects land ON
 * their stream, as a VALUE the builder authors [LAW:dataflow-not-control-flow].
 * This is the founding line made into a type: we own the transport (the live-feed
 * spine the frames ride) and the integrity of the stream (the bounds below), and
 * the look inside those bounds is theirs — one toast shape renders ANY effect a
 * builder sells, styled by these values, never a platform widget per effect kind
 * [LAW:one-type-per-behavior][LAW:no-mode-explosion].
 *
 * One validator draws the whole legal/illegal line, and every boundary that admits
 * a style — the authoring edge, the wire parse, the durable-store decode — flows
 * through it, so the rule cannot drift between them [LAW:single-enforcer].
 */

/** Where over the video a fired effect lands. A closed value set: geometry over the
 *  16:9 stage is the rail's affordance (the toast must never sit outside the video
 *  it decorates); WHICH corner is the builder's value. */
export const OVERLAY_PLACEMENTS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type OverlayPlacement = (typeof OVERLAY_PLACEMENTS)[number];

/**
 * How long a fired effect may hold the stream, in whole seconds. The bounds are the
 * platform's side of the founding line — integrity of the stream: a toast that never
 * leaves is an occupation of the video, not a look, and a sub-second flash is a
 * glitch no watcher can read. Inside them, the residency is the builder's value.
 */
export const OVERLAY_DURATION_SECONDS = { min: 2, max: 30 } as const;

/**
 * The whole creative shape: which corner fired effects land in, the hue that colors
 * them (0–360, the same wheel the stream's own accent rides), and how long each one
 * stays. Every field is a plain primitive so the value crosses the server-action
 * boundary, the SSE wire, and the durable store unchanged [LAW:effects-at-boundaries].
 */
export interface OverlayStyle {
  readonly placement: OverlayPlacement;
  readonly accentHue: number;
  readonly durationSeconds: number;
}

/**
 * The style of a channel whose builder has never authored one — a NAMED baseline,
 * so every reader gets a real style and never defends against absence
 * [LAW:no-defensive-null-guards], exactly as an undeclared maturity rating surfaces
 * as GENERAL_AUDIENCE rather than a missing field.
 */
export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  placement: 'bottom-left',
  accentHue: 160,
  durationSeconds: 8,
};

/** The three axes a submitted style can fail on — the authoring form's per-field
 *  feedback vocabulary, one value per invariant the validator below enforces. */
export type OverlayStyleField = 'placement' | 'accentHue' | 'durationSeconds';

const isPlacement = (v: unknown): v is OverlayPlacement =>
  typeof v === 'string' && (OVERLAY_PLACEMENTS as readonly string[]).includes(v);

/** A whole number inside inclusive bounds — hue and duration are both this shape;
 *  a fraction, NaN, an infinity, or a numeric string is not a value on the axis. */
const isBoundedInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const isRecord = (v: unknown): v is { readonly [key: string]: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Judge one candidate style field-by-field, reporting EVERY failing axis at once —
 * the authoring form says exactly which inputs to fix, never a collapsed "invalid"
 * [LAW:no-silent-failure]. A non-object candidate fails every axis: it holds no
 * legal value on any of them. Extra fields are ignored, so a future style axis is
 * one more field here, not a break of every older reader.
 */
export const overlayStyleProblems = (value: unknown): readonly OverlayStyleField[] => {
  const record = isRecord(value) ? value : {};
  const problems: OverlayStyleField[] = [];
  if (!isPlacement(record.placement)) problems.push('placement');
  if (!isBoundedInt(record.accentHue, 0, 360)) problems.push('accentHue');
  if (!isBoundedInt(record.durationSeconds, OVERLAY_DURATION_SECONDS.min, OVERLAY_DURATION_SECONDS.max)) {
    problems.push('durationSeconds');
  }
  return problems;
};

/**
 * Prove an unknown value is a legal {@link OverlayStyle}, or `null`. The yes/no face
 * of {@link overlayStyleProblems} — one rule set behind both faces
 * [LAW:single-enforcer] — for the boundaries that need a value, not a diagnosis:
 * the SSE wire parse and the durable-store decode. The accepted value is REBUILT
 * from its proven fields, so an extra wire field never rides into the app's value.
 */
export const overlayStyleFrom = (value: unknown): OverlayStyle | null => {
  if (!isRecord(value)) return null;
  const { placement, accentHue, durationSeconds } = value;
  if (!isPlacement(placement)) return null;
  if (!isBoundedInt(accentHue, 0, 360)) return null;
  if (!isBoundedInt(durationSeconds, OVERLAY_DURATION_SECONDS.min, OVERLAY_DURATION_SECONDS.max)) return null;
  return { placement, accentHue, durationSeconds };
};
