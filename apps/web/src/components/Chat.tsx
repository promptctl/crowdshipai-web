import Link from 'next/link';

import type { ChatMessage } from '@/data/types';

/**
 * The live chat column. A fired effect and an ordinary line are one message
 * type, not two parallel systems [LAW:one-type-per-behavior]. Pure
 * presentational; the message list and the send action are owned upstream.
 *
 * A logged-out viewer reads the chat but cannot speak — an anonymous back-channel
 * is refused at the action [LAW:single-enforcer], and this footer reflects that
 * truth rather than offering an input that would only bounce: it shows a sign-in
 * prompt instead, the same courtesy the wallet shows. The variability is WHICH
 * footer renders, a value derived from `signedIn`, not whether one appears
 * [LAW:dataflow-not-control-flow].
 */
export function Chat({
  messages,
  draft,
  onDraftChange,
  onSend,
  signedIn,
}: {
  readonly messages: readonly ChatMessage[];
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => void;
  readonly signedIn: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-fog">chat</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-3 text-sm">
        {/* mt-auto bottom-pins a short log; when it overflows, the oldest lines
            stay scrollable instead of being clipped above a justify-end edge. */}
        <div className="mt-auto flex flex-col gap-1.5">
        {messages.map((m) =>
          m.settledPool !== undefined ? (
            // Pool settlement: the whole pool shipped to the builder. Distinct visual
            // from a fired effect — a bigger moment, a bigger line [LAW:one-type-per-behavior].
            <div
              key={m.id}
              className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-2 text-xs text-emerald-300"
            >
              <span className="font-bold">SHIPPED</span>
              {' '}◎ {m.settledPool.pooledCoins.toLocaleString('en-US')} coins released —{' '}
              <span className="font-semibold">{m.settledPool.title}</span>
            </div>
          ) : m.firedEffectKind !== undefined ? (
            <div
              key={m.id}
              className="rounded-sm border border-accent-dim/40 bg-accent/10 px-2 py-1.5 text-xs text-accent"
            >
              ◎ <span className="font-semibold">{m.author || 'someone'}</span> fired{' '}
              <span className="font-semibold">{m.firedEffectKind}</span>
            </div>
          ) : (
            <div key={m.id} className="leading-snug">
              <span className="font-semibold text-accent">{m.author}</span>{' '}
              <span className="text-chalk/90">{m.text}</span>
            </div>
          ),
        )}
        </div>
      </div>
      {signedIn ? (
        <form
          className="flex gap-2 border-t border-edge p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="say something…"
            className="min-w-0 flex-1 rounded-sm border border-edge bg-surface px-2.5 py-1.5 text-sm text-chalk outline-none placeholder:text-fog/60 focus:border-accent-dim"
          />
          <button
            type="submit"
            className="rounded-sm bg-surface-2 px-3 py-1.5 text-xs font-semibold text-chalk transition-colors hover:bg-edge"
          >
            send
          </button>
        </form>
      ) : (
        <p className="border-t border-edge p-2.5 text-xs text-fog">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{' '}
          to join the chat.
        </p>
      )}
    </div>
  );
}
