import type { Brand } from './brand.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/** A raw string rejected because it carries no content — empty or whitespace-only. */
export type BlankError = { readonly kind: 'blank'; readonly label: string };

/**
 * Construct a non-blank, branded opaque string at a trust boundary. It is the
 * only way to obtain the brand, so an unchecked string is unrepresentable
 * downstream [LAW:types-are-the-program]. The value is taken VERBATIM — no
 * trimming or normalization, since that would silently change a load-bearing
 * key [LAW:no-silent-failure]. `label` names which field was blank, so failure
 * is contextual rather than anonymous.
 *
 * This is the one mechanism behind every "non-blank opaque id/label" on the
 * platform — an offer id, an effect kind, an account id — so the behavior lives
 * once here instead of being re-derived per domain [LAW:one-type-per-behavior].
 */
export const nonBlank = <B extends string>(
  label: string,
  raw: string,
): Result<Brand<string, B>, BlankError> =>
  raw.trim().length > 0 ? ok(raw as Brand<string, B>) : err({ kind: 'blank', label });
