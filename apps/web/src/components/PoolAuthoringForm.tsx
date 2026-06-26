'use client';

import { useActionState, useState } from 'react';

import type { PoolOpenResult } from '@/data/buy-result';
import type { PoolView } from '@/data/types';
import { openPool } from '@/server/market-actions';

/**
 * The builder's pool-opening surface: wire up a funding target in the studio. The form
 * does ONE thing — open one pool — and returns its result as a typed arm. The builder
 * fills a title and a target, clicks "Open Pool", and sees the pool appear in the list
 * below, seeded with live escrow data re-read from the ledger [LAW:one-source-of-truth].
 *
 * Like {@link MenuAuthoringForm}, it uses `useActionState` so the action result drives
 * the notice display — no separate state for the notice, no shadowed balance
 * [LAW:dataflow-not-control-flow]. The `opened` arm appends the new pool to the live
 * list so the builder sees their pools update without a full page reload.
 */

const resultNotice = (result: PoolOpenResult): { tone: 'ok' | 'warn' | 'error'; text: string } | null => {
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

const NOTICE_TONE: Readonly<Record<'ok' | 'warn' | 'error', string>> = {
  ok: 'border-accent-dim bg-accent/10 text-accent',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/50 bg-red-500/10 text-red-300',
};

export function PoolAuthoringForm({ initialPools }: { readonly initialPools: readonly PoolView[] }) {
  const [pools, setPools] = useState<readonly PoolView[]>(initialPools);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');

  const [result, action, pending] = useActionState(
    async (_prev: PoolOpenResult | null, formData: FormData): Promise<PoolOpenResult> => {
      const t = (formData.get('title') as string | null)?.trim() ?? '';
      const r = await openPool(t, Number(formData.get('target') ?? ''));
      if (r.kind === 'opened') {
        setPools((prev) => [...prev, r.pool]);
        setTitle('');
        setTarget('');
      }
      return r;
    },
    null,
  );

  const notice = result !== null ? resultNotice(result) : null;

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
            <PoolCard key={pool.id} pool={pool} />
          ))}
        </div>
      )}
    </div>
  );
}

function PoolCard({ pool }: { readonly pool: PoolView }) {
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
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fog">
        ◎ {pool.pooledCoins.toLocaleString('en-US')} / {pool.targetCoins.toLocaleString('en-US')}
      </p>
    </div>
  );
}
