/** The builder's identity swatch. Kept a single part so that when real avatar
 * images replace the placeholder hue, the swap happens once rather than at every
 * surface that shows a builder [LAW:one-source-of-truth]. Size is passed in, not
 * baked in [LAW:one-type-per-behavior]. */
export function BuilderAvatar({
  accentHue,
  className,
}: {
  readonly accentHue: number;
  readonly className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full ${className ?? ''}`}
      style={{ background: `hsl(${accentHue} 60% 45%)` }}
      aria-hidden
    />
  );
}
