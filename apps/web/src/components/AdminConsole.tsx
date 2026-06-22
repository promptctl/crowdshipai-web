'use client';

import { useActionState } from 'react';

import { VERIFICATION_STATUSES } from '@crowdship/identity';
import { REVIEW_DISPOSITIONS } from '@crowdship/moderation';

import type { SanctionResult, VerifyResult } from '@/data/admin-result';
import type { QueueItemView, ResolveResult } from '@/data/review-result';
import { issueSanction, setChannelVerification } from '@/server/admin-actions';
import { resolveItem } from '@/server/review-actions';

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

const resolveNotice = (result: ResolveResult): Notice => {
  switch (result.kind) {
    case 'resolved':
      return { tone: 'good', text: `Recorded as ${result.disposition}.` };
    case 'invalid-item':
      return { tone: 'bad', text: 'No such item to resolve.' };
    case 'invalid-disposition':
      return { tone: 'bad', text: 'Choose a verdict.' };
    case 'invalid-note':
      return { tone: 'bad', text: 'A verdict needs a note explaining it.' };
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

/**
 * What the reviewer reads above each item's resolve form — the human-facing summary of a
 * queue item, by arm. A `report` shows who flagged what and why; an `incident` shows the
 * subject and the rules it broke. Exhaustive on `kind` with no default arm, so a new
 * queue arm fails to compile here until it is given a summary [LAW:types-are-the-program].
 */
function ItemSummary({ item }: { readonly item: QueueItemView }) {
  switch (item.kind) {
    case 'report':
      return (
        <div className="text-sm text-chalk">
          <span className="font-semibold">report</span> on <span className="text-fog">{item.target}</span>
          <p className="mt-0.5 text-xs text-fog">“{item.reason}” — {item.reporter}</p>
        </div>
      );
    case 'incident':
      return (
        <div className="text-sm text-chalk">
          <span className="font-semibold">incident</span> · <span className="text-fog">{item.subject}</span>
          <p className="mt-0.5 text-xs text-fog">{item.violations.join('; ')}</p>
        </div>
      );
  }
}

/**
 * One open review item with its own resolve form. Each item owns its pending state and
 * notice independently, so resolving one never blocks another — the per-item state is the
 * value the form carries, not a mode of the console [LAW:dataflow-not-control-flow]. The
 * entry id rides as a hidden field, named verbatim so the verdict closes exactly this
 * item.
 */
function ReviewItem({ item }: { readonly item: QueueItemView }) {
  const [result, action, pending] = useActionState<ResolveResult | null, FormData>(resolveItem, null);

  return (
    <li className="rounded-md border border-edge bg-surface-2 p-3">
      <ItemSummary item={item} />
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="entry" value={item.id} />
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            verdict
            <select name="disposition" defaultValue={REVIEW_DISPOSITIONS[0]} className={FIELD}>
              {REVIEW_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            note
            <input name="note" required placeholder="why" className={FIELD} />
          </label>
        </div>
        <NoticeLine notice={result === null ? null : resolveNotice(result)} />
        <button type="submit" disabled={pending} className={`${SUBMIT} self-start`}>
          {pending ? '…' : 'resolve'}
        </button>
      </form>
    </li>
  );
}

export function AdminConsole({ queue }: { readonly queue: readonly QueueItemView[] }) {
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

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fog">review queue</h2>
        {queue.length === 0 ? (
          <p className="mt-3 text-sm text-fog">Nothing awaiting review.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {queue.map((item) => (
              <ReviewItem key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
