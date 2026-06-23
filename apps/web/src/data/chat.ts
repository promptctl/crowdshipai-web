/**
 * The pure, framework-free heart of live chat: how a message's PUBLIC author label
 * is decided, and how long a message may be. Both halves of the chat seam — the
 * server action that publishes and the test that pins it — read these from one
 * place, so the wire never carries an author or a length the other half would
 * compute differently [LAW:one-source-of-truth]. Importable in any runtime; it
 * touches nothing but its arguments [LAW:effects-at-boundaries].
 */

/**
 * The longest a chat line may be. A value, not a scattered literal, so tightening
 * or loosening it is this one edit [LAW:one-source-of-truth]. A sane bound that
 * keeps the feed readable; the exact number is a knob, never a principle.
 */
export const CHAT_MAX_LENGTH = 280;

/**
 * A stable, non-PII display label for a viewer who has no public channel name —
 * the recurring gap in the identity model: an {@link Account} is private (one
 * email), and only a builder owns a public {@link Channel}. A backer in chat needs
 * SOME public handle, and it must be the SAME handle every time they speak, so the
 * audience reads one voice, not a stranger per line [LAW:one-source-of-truth].
 *
 * Derived deterministically from the opaque account id via a tiny non-cryptographic
 * hash: a display label is not a security token, so a rare collision is cosmetic,
 * and the raw id is never exposed — only a short digest of it. Same id in, same
 * label out; different ids almost always differ.
 */
const shortHash = (s: string): string => {
  // FNV-1a over the id's char codes — small, dependency-free, and stable across
  // runtimes (no Math.random, no clock), which is what makes the label reproducible.
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(0, 6);
};

/**
 * The public author a chat line is broadcast under. A builder speaks as their
 * channel's display name — their chosen public identity, the same one viewers read
 * on their stream; everyone else speaks as a stable `viewer-<digest>` pseudonym.
 * The variability lives in the value passed in (a name or `null`), never in a
 * branch the caller must remember to take [LAW:dataflow-not-control-flow]. The whole
 * naming policy is this one function, so changing how viewers are labeled — or
 * giving backers real handles later — is a change here and nowhere else
 * [LAW:locality-or-seam].
 */
export const chatAuthorLabel = (accountId: string, channelDisplayName: string | null): string =>
  channelDisplayName ?? `viewer-${shortHash(accountId)}`;
