'use client';

import { useActionState, useState } from 'react';

import type { PoolCancelResult, PoolOpenResult } from '@/data/buy-result';
import type { PoolView } from '@/data/types';
import { cancelPool, openPool } from '@/server/market-actions';

/**
 * The builder's pool surface in the studio: open a funding target, and cancel one that
 * will not ship — the cancel is the CAUSE of the refund path, returning every pledged
 * coin to its backer through the refund engine at the market seam. Each pool's card
 * shows its live escrow figures re-read from the ledger [LAW:one-source-of-truth].
 *
 * Like {@link MenuAuthoringForm}, it uses `useActionState` so the action result drives
 * the notice display — no separate state for the notice, no shadowed balance
 * [LAW:dataflow-not-control-flow]. The `opened` arm appends the new pool to the live
 * list; a cancel outcome carrying the pool's new view replaces it in place, so the
 * builder sees the ledger's truth without a full page reload.
 */

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };

const resultNotice = (result: PoolOpenResult): Notice | null => {
  switch (result.kind) {
    case 'opened':
      return { tone: 'ok', text: `Pool "${result.pool.title}" opened — backers can now pledge.` };
    case 'no-channel':
      return { tone: 'error', text: 'Claim a channel first before opening a funding pool.' };
    case 'invalid-target':
      return { tone: 'error', text: 'Target must be a whole number of coins greater than zero.' };
    case 'must-authenticate':
      return { tone: 'warn', text: 'Sign in to open a funding pool.' };
  }
};

/** The cancel outcome as the builder reads it — every arm of the typed result told
 *  plainly, the money arms leading with what the coins did [LAW:no-silent-failure]. */
const cancelNotice = (result: PoolCancelResult): Notice => {
  switch (result.kind) {
    case 'cancelled-refunded':
      return {
        tone: 'ok',
        text: `Pool "${result.pool.title}" cancelled — ◎ ${result.refundedCoins.toLocaleString('en-US')} refunded to its backers.`,
      };
    case 'cancelled-empty':
      return { tone: 'ok', text: `Pool "${result.pool.title}" cancelled — no coins were pledged.` };
    case 'already-cancelled':
      return { tone: 'warn', text: 'This pool is already cancelled.' };
    case 'already-released':
      return { tone: 'warn', text: 'This pool already shipped — there is nothing to cancel.' };
    case 'cancel-refused':
      return { tone: 'error', text: 'The refund was refused by the ledger — nothing was cancelled.' };
    case 'not-your-pool':
      return { tone: 'error', text: 'This pool belongs to another channel.' };
    case 'no-such-pool':
      return { tone: 'error', text: 'That pool no longer exists.' };
    case 'no-channel':
      return { tone: 'error', text: 'Claim a channel first.' };
    case 'must-authenticate':
      return { tone: 'warn', text: 'Sign in to cancel a pool.' };
  }
};

const NOTICE_TONE: Readonly<Record<'ok' | 'warn' | 'error', string>> = {
  ok: 'border-accent-dim bg-accent/10 text-accent',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/50 bg-red-500/10 text-red-300',
};

export function PoolAuthoringForm({ initialPools }: { readonly initialPools: readonly PoolView[] }) {
  const [pools, setPools] = useState<readonly PoolView[]>(initialPools);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  // One notice slot for the whole surface: the latest thing that happened, open or
  // cancel — never two competing banners [LAW:one-source-of-truth].
  const [cancelBanner, setCancelBanner] = useState<Notice | null>(null);

  const [result, action, pending] = useActionState(
    async (_prev: PoolOpenResult | null, formData: FormData): Promise<PoolOpenResult> => {
      const t = (formData.get('title') as string | null)?.trim() ?? '';
      const r = await openPool(t, Number(formData.get('target') ?? ''));
      if (r.kind === 'opened') {
        setPools((prev) => [...prev, r.pool]);
        setTitle('');
        setTarget('');
        setCancelBanner(null);
      }
      return r;
    },
    null,
  );

  const onCancel = async (poolId: string) => {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      const r = await cancelPool(poolId);
      setCancelBanner(cancelNotice(r));
      // Every arm that carries the pool's authoritative new view applies it — the
      // ledger's truth replacing this surface's stale copy [LAW:one-source-of-truth].
      if ('pool' in r) {
        setPools((prev) => prev.map((p) => (p.id === r.pool.id ? r.pool : p)));
      }
    } catch {
      // A rejection is the exceptional server failure — already loud server-side. This
      // surface tells the builder honestly, claiming no money state it cannot know
      // [LAW:no-silent-failure].
      setCancelBanner({
        tone: 'error',
        text: 'Something went wrong and the cancel could not be confirmed. Reload to see this pool — nothing moves silently.',
      });
    } finally {
      setCancelBusy(false);
    }
  };

  const notice = cancelBanner ?? (result !== null ? resultNotice(result) : null);

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-fog mb-1.5">
            feature title
          </label>
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Dark mode for the editor"
            required
            className="w-full rounded-sm border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog/60 focus:border-accent-dim"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-fog mb-1.5">
            target (coins)
          </label>
          <input
            name="target"
            type="number"
            min="1"
            step="1"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="e.g. 5000"
            required
            className="w-full rounded-sm border border-edge bg-surface-2 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog/60 focus:border-accent-dim"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-chalk transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Opening…' : 'Open Pool'}
        </button>
      </form>

      {notice !== null && (
        <p className={`rounded-md border px-3 py-2 text-xs leading-snug ${NOTICE_TONE[notice.tone]}`}>
          {notice.text}
        </p>
      )}

      {pools.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fog">your pools</h3>
          {pools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} busy={cancelBusy} onCancel={onCancel} />
          ))}
        </div>
      )}
    </div>
  );
}

function PoolCard({
  pool,
  busy,
  onCancel,
}: {
  readonly pool: PoolView;
  readonly busy: boolean;
  readonly onCancel: (poolId: string) => void;
}) {
  const pct = pool.targetCoins > 0 ? Math.min(100, (pool.pooledCoins / pool.targetCoins) * 100) : 0;
  return (
    <div className="rounded-lg border border-edge bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-chalk">{pool.title}</p>
        {pool.released && (
          <span className="shrink-0 rounded-sm bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
            SHIPPED
          </span>
        )}
        {pool.cancelled && (
          <span className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fog">
            CANCELLED
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fog">
        ◎ {pool.pooledCoins.toLocaleString('en-US')} / {pool.targetCoins.toLocaleString('en-US')}
      </p>
      {!pool.released && !pool.cancelled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onCancel(pool.id)}
          className="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:border-red-500/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Cancelling…' : 'Cancel pool — refund backers'}
        </button>
      )}
    </div>
  );
}
