declare const brand: unique symbol;

/**
 * A nominal type: a `T` that the compiler will not accept in place of a bare
 * `T`, nor a bare `T` in place of it. The only way to obtain one is through a
 * constructor that has checked its invariant, so an unchecked value of the
 * branded type is unrepresentable [LAW:types-are-the-program].
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
