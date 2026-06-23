import type { ChatMessage } from '@/data/types';

/**
 * The live chat column. A fired effect and an ordinary line are one message
 * type, not two parallel systems [LAW:one-type-per-behavior]. Pure
 * presentational; the message list and the send action are owned upstream.
 */
export function Chat({
  messages,
  draft,
  onDraftChange,
  onSend,
}: {
  readonly messages: readonly ChatMessage[];
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => void;
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
          m.firedEffectKind !== undefined ? (
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
    </div>
  );
}
