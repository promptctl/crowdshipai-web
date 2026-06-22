'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import type { AuthFormState } from '@/server/actions';

/**
 * One credential form. Log-in and sign-up are the same form with a different
 * server action and labels [LAW:one-type-per-behavior] — the variability lives in
 * props (values), not in two near-identical components. The action is a server
 * action passed straight through; this client component only owns the pending
 * state and the one error line.
 */
export function AuthForm({
  action,
  heading,
  blurb,
  submitLabel,
  alt,
}: {
  readonly action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  readonly heading: string;
  readonly blurb: string;
  readonly submitLabel: string;
  readonly alt: { readonly href: string; readonly label: string };
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-5">
      <h1 className="text-2xl font-bold tracking-tight text-chalk">{heading}</h1>
      <p className="mt-1 text-sm text-fog">{blurb}</p>
      <form action={formAction} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-fog">
          email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fog">
          password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
          />
        </label>
        {state.error !== undefined && (
          <p role="alert" className="text-xs font-semibold text-live">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:opacity-50"
        >
          {pending ? '…' : submitLabel}
        </button>
      </form>
      <Link href={alt.href} className="mt-4 text-xs text-fog hover:text-chalk">
        {alt.label}
      </Link>
    </main>
  );
}
