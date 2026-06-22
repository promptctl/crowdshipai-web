'use client';

import { useActionState } from 'react';

import type { ReportResult } from '@/data/report-result';
import { fileReport } from '@/server/report-actions';

/**
 * The viewer's "flag this for review" control — a reason and a submit, on any surface
 * that has something reportable. It owns only the pending state and the one notice line;
 * the decision is the server action's, gated there by authentication
 * [LAW:single-enforcer]. The result→notice map is an exhaustive switch with no default
 * arm, so a new result arm fails to compile here until it is given a message rather than
 * silently rendering nothing [LAW:types-are-the-program].
 *
 * `target` is the app's opaque handle for the reported thing, passed in by the hosting
 * surface and carried as a hidden field — the surface names what it is reporting, the
 * core never invents a taxonomy of kinds [LAW:no-mode-explosion].
 */

const noticeFor = (result: ReportResult): { readonly tone: 'good' | 'bad'; readonly text: string } => {
  switch (result.kind) {
    case 'filed':
      return { tone: 'good', text: 'Reported. A moderator will review it.' };
    case 'invalid-target':
      return { tone: 'bad', text: 'There is nothing here to report.' };
    case 'invalid-reason':
      return { tone: 'bad', text: 'Say why you are reporting this.' };
    case 'must-authenticate':
      return { tone: 'bad', text: 'Sign in to report.' };
  }
};

const FIELD =
  'rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim';
const SUBMIT =
  'mt-1 self-start rounded-full border border-edge px-4 py-2 text-xs font-semibold text-fog transition-colors hover:border-live hover:text-live disabled:opacity-50';

export function ReportChannel({ target }: { readonly target: string }) {
  const [result, action, pending] = useActionState<ReportResult | null, FormData>(fileReport, null);
  const notice = result === null ? null : noticeFor(result);

  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="target" value={target} />
      <label className="flex flex-col gap-1 text-xs text-fog">
        report this channel
        <input name="reason" required placeholder="what breaks the rules?" className={FIELD} />
      </label>
      {notice !== null && (
        <p role="status" className={`text-xs font-semibold ${notice.tone === 'good' ? 'text-accent' : 'text-live'}`}>
          {notice.text}
        </p>
      )}
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? '…' : 'report'}
      </button>
    </form>
  );
}
