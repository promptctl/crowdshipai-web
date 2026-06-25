'use client';

import { useActionState } from 'react';
import type { DisplayNameError, HandleError, HandleReservation } from '@crowdship/identity';

import type { ClaimResult } from '@/data/claim-result';
import { claimChannelAction } from '@/server/channel-actions';

/**
 * The builder's channel-claim form — where a signed-in account becomes a builder with a
 * public channel. It does ONE thing: take a handle and display name and submit the claim
 * [LAW:composability]. The action redirects to the studio on success, so this component
 * owns only the pending state and the one reason line for a refused claim.
 *
 * The reason line is an EXHAUSTIVE match over every non-`claimed` {@link ClaimResult} arm,
 * so a new outcome the core can return is a compile error here rather than a silently
 * blank notice [LAW:dataflow-not-control-flow][LAW:no-silent-failure].
 */

const handleErrorNotice = (error: HandleError): string => {
  switch (error.kind) {
    case 'blank':
      return 'Enter a handle.';
    case 'too-short':
      return `Handle must be at least ${error.min} characters.`;
    case 'too-long':
      return `Handle must be at most ${error.max} characters.`;
    case 'malformed':
      return 'Handle must start with a letter and use only lowercase letters, digits, and underscores.';
  }
};

const displayNameErrorNotice = (error: DisplayNameError): string => {
  switch (error.kind) {
    case 'blank':
      return 'Enter a display name.';
    case 'too-long':
      return `Display name must be at most ${error.max} characters.`;
  }
};

const reservedNotice = (reservation: HandleReservation): string => {
  switch (reservation.kind) {
    case 'reserved-word':
      return `“${reservation.word}” is reserved — pick a handle that isn’t a platform term.`;
    case 'brand-impersonation':
      return `That handle embeds “${reservation.brand}”, which implies platform affiliation — pick another.`;
  }
};

const claimNotice = (result: Exclude<ClaimResult, { kind: 'claimed' }>): string => {
  switch (result.kind) {
    case 'must-authenticate':
      return 'Sign in to claim a channel.';
    case 'invalid-handle':
      return handleErrorNotice(result.error);
    case 'invalid-display-name':
      return displayNameErrorNotice(result.error);
    case 'handle-reserved':
      return reservedNotice(result.reservation);
    case 'handle-taken':
      return 'That handle is already taken — try another.';
    case 'already-has-channel':
      return 'You already have a channel.';
    case 'no-such-account':
      return 'Your account could not be found — try signing in again.';
  }
};

export function ClaimChannelForm() {
  const [state, formAction, pending] = useActionState<ClaimResult | null, FormData>(
    claimChannelAction,
    null,
  );

  return (
    <form action={formAction} className="mt-6 flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-fog">
        handle
        <input
          name="handle"
          autoComplete="off"
          required
          placeholder="ffmpeg_witch"
          className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
        />
        <span className="text-[11px] text-fog">
          your public URL — lowercase letters, digits, underscores; starts with a letter.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-fog">
        display name
        <input
          name="displayName"
          autoComplete="off"
          required
          placeholder="FFmpeg Witch"
          className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
        />
      </label>
      {state !== null && state.kind !== 'claimed' && (
        <p role="alert" className="text-xs font-semibold text-live">
          {claimNotice(state)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:opacity-50"
      >
        {pending ? 'claiming…' : 'claim channel'}
      </button>
    </form>
  );
}
