/**
 * The outcome of an operation that can fail for a named reason. Failure is a
 * value the caller must destructure, never a swallowed exception or a silent
 * default that changes meaning [LAW:no-silent-failure].
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
