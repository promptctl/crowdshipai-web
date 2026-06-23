import { createHash } from 'node:crypto';

/**
 * The at-rest key for a high-entropy bearer token: an unsalted SHA-256. A salt
 * would buy nothing — the token is 256 bits of CSPRNG output, not a guessable
 * user secret, so there is no dictionary to defend against — and the digest is
 * what the session/recovery tables store, so a database leak yields no usable
 * token [LAW:effects-at-boundaries]. Same input always maps to the same key, which
 * is exactly what lookup-by-token needs.
 */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
