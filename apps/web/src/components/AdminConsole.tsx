'use client';

import { useActionState } from 'react';

import { VERIFICATION_STATUSES } from '@crowdship/identity';

import type { SanctionResult, VerifyResult } from '@/data/admin-result';
import { issueSanction, setChannelVerification } from '@/server/admin-actions';

/**
 * The platform-staff console: the two operator powers the staff axis unlocks —
 * affirm a channel's verification, and sanction an account — on one surface, each
 * gated server-side by the same authority [LAW:single-enforcer]. This client
 * component owns only the pending state and the one notice line per form; every
 * decision is the server action's. The result→notice map is an exhaustive switch
 * with no default arm, so a new result arm fails to compile here until it is given a
 * message rather than silently rendering nothing [LAW:types-are-the-program].
 */

interface Notice {
  readonly tone: 'good' | 'bad';
  readonly text: string;
}

const NO_AUTHORITY = 'You do not have platform authority.';
const SIGN_IN = 'Sign in to act as the platform.';

const verifyNotice = (result: VerifyResult): Notice => {
  switch (result.kind) {
    case 'set':
      return { tone: 'good', text: `@${result.handle} is now ${result.status}.` };
    case 'no-such-channel':
      return { tone: 'bad', text: `No channel holds @${result.handle}.` };
    case 'invalid-handle':
      return { tone: 'bad', text: 'That is not a well-formed handle.' };
    case 'invalid-status':
      return { tone: 'bad', text: 'Unknown verification tier.' };
    case 'forbidden':
      return { tone: 'bad', text: NO_AUTHORITY };
    case 'must-authenticate':
      return { tone: 'bad', text: SIGN_IN };
  }
};

const sanctionNotice = (result: SanctionResult): Notice => {
  switch (result.kind) {
    case 'sanctioned':
      return {
        tone: 'good',
        text:
          result.scope === 'permanent'
            ? `Account ${result.account} is permanently barred.`
            : `Account ${result.account} is suspended.`,
      };
    case 'invalid-account':
      return { tone: 'bad', text: 'Enter the account id to sanction.' };
    case 'invalid-reason':
      return { tone: 'bad', text: 'A sanction needs a reason.' };
    case 'invalid-scope':
      return { tone: 'bad', text: 'Duration must be a positive whole number of days.' };
    case 'forbidden':
      return { tone: 'bad', text: NO_AUTHORITY };
    case 'must-authenticate':
      return { tone: 'bad', text: SIGN_IN };
  }
};

const FIELD =
  'rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim';
const LABEL = 'flex flex-col gap-1 text-xs text-fog';
const SUBMIT =
  'mt-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:opacity-50';

function NoticeLine({ notice }: { readonly notice: Notice | null }) {
  if (notice === null) return null;
  return (
    <p role="status" className={`text-xs font-semibold ${notice.tone === 'good' ? 'text-accent' : 'text-live'}`}>
      {notice.text}
    </p>
  );
}

export function AdminConsole() {
  const [verify, verifyAction, verifying] = useActionState<VerifyResult | null, FormData>(
    setChannelVerification,
    null,
  );
  const [sanction, sanctionAction, sanctioning] = useActionState<SanctionResult | null, FormData>(
    issueSanction,
    null,
  );

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-chalk">staff console</h1>
      <p className="mt-1 text-sm text-fog">
        Platform-operator actions. Authority is the configured staff roster, never your roles.
      </p>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fog">verify a channel</h2>
        <form action={verifyAction} className="mt-3 flex flex-col gap-3">
          <label className={LABEL}>
            handle
            <input name="handle" required placeholder="builderhandle" className={FIELD} />
          </label>
          <label className={LABEL}>
            tier
            <select name="status" defaultValue="verified" className={FIELD}>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <NoticeLine notice={verify === null ? null : verifyNotice(verify)} />
          <button type="submit" disabled={verifying} className={SUBMIT}>
            {verifying ? '…' : 'set verification'}
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fog">sanction an account</h2>
        <form action={sanctionAction} className="mt-3 flex flex-col gap-3">
          <label className={LABEL}>
            account id
            <input name="account" required placeholder="the account to bar" className={FIELD} />
          </label>
          <label className={LABEL}>
            reason
            <input name="reason" required placeholder="why this account is barred" className={FIELD} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              scope
              <select name="scope" defaultValue="permanent" className={FIELD}>
                <option value="permanent">permanent ban</option>
                <option value="until">suspend for…</option>
              </select>
            </label>
            <label className={LABEL}>
              days (for suspension)
              <input name="days" type="number" min={1} defaultValue={7} className={FIELD} />
            </label>
          </div>
          <NoticeLine notice={sanction === null ? null : sanctionNotice(sanction)} />
          <button type="submit" disabled={sanctioning} className={SUBMIT}>
            {sanctioning ? '…' : 'impose sanction'}
          </button>
        </form>
      </section>
    </main>
  );
}
