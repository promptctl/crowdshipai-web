/**
 * Render an arbitrary value for a diagnostic error message. `JSON.stringify` THROWS on
 * a bigint — and a bigint shows up two ways in this codebase's failure paths: as a raw
 * column SQLite hands back for an oversized integer, and NESTED inside a validator's
 * error payload (e.g. `coinAmount`'s `{ value: bigint }` when a recorded amount is
 * non-positive). A naive stringify would replace the intended loud failure with a
 * confusing "cannot serialize a BigInt" — a misleading failure exactly when something is
 * already wrong [LAW:no-silent-failure]. So a replacer converts every bigint, at any
 * depth, to a readable `<n>n` form. This is the single home for safe value rendering
 * [LAW:one-source-of-truth]; the row-readers and the unwrap-or-halt helper both use it.
 */
export const show = (value: unknown): string => {
  if (typeof value === 'bigint') return `${value}n`;
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v}n` : v)) ?? String(value);
};
