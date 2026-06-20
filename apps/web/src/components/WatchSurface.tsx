'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

import type { ChannelView, ChatMessage, PricedOffer } from '@/data/types';

import { Chat } from './Chat';
import { Menu } from './Menu';
import { StreamStage } from './StreamStage';

/**
 * The watch surface: player + menu + chat in one view (discovery-41w.3, scaffold
 * ahead of the real-time stream layer). This client component is the single
 * owner of the live, mutating state — the chat log and the viewer's coin balance
 * [LAW:no-ambient-temporal-coupling]. Menu and Chat are pure children that
 * report intents up; nothing mutates state behind their backs.
 *
 * Spending a coin here is a LOCAL optimistic effect: it decrements a fake wallet
 * and appends a fired-effect line to chat. The real money movement is the ledger
 * + settlement epics; this surface is shaped to call those at the same seam
 * where it currently fakes them [LAW:carrying-cost].
 */
export function WatchSurface({ channel }: { readonly channel: ChannelView }) {
  const { stream } = channel;
  const [messages, setMessages] = useState<readonly ChatMessage[]>(channel.chat);
  const [balance, setBalance] = useState(5000);
  const [draft, setDraft] = useState('');
  const nextId = useRef(0);
  const localId = () => `local-${(nextId.current += 1)}`;

  const append = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  const onSpend = (offer: PricedOffer) => {
    // The Menu disables unaffordable offers, but the owner re-checks before
    // moving value — the button being enabled is not a promise [LAW:single-enforcer].
    if (balance < offer.priceCoins) return;
    setBalance((b) => b - offer.priceCoins);
    append({ id: localId(), author: 'you', text: '', firedOfferLabel: offer.label });
  };

  const onSend = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    append({ id: localId(), author: 'you', text });
    setDraft('');
  };

  return (
    <main className="mx-auto max-w-7xl px-5 py-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <StreamStage accentHue={stream.accentHue} isLive={stream.isLive} viewerCount={stream.viewerCount} size="stage" />
          <div className="mt-4 flex items-start gap-3">
            <span
              className="h-11 w-11 shrink-0 rounded-full"
              style={{ background: `hsl(${stream.accentHue} 60% 45%)` }}
              aria-hidden
            />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-chalk">{stream.title}</h1>
              <Link href={`/c/${stream.slug}`} className="text-sm text-accent hover:underline">
                {stream.builderName}
              </Link>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fog">{channel.bio}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {stream.tags.map((tag) => (
                  <span key={tag} className="rounded-sm bg-surface-2 px-2 py-0.5 text-[11px] text-fog">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)]">
          <div className="overflow-hidden rounded-lg border border-edge bg-surface">
            <Menu offers={channel.menu} balance={balance} onSpend={onSpend} />
          </div>
          <div className="flex-1 overflow-hidden rounded-lg border border-edge bg-surface">
            <Chat messages={messages} draft={draft} onDraftChange={setDraft} onSend={onSend} />
          </div>
        </aside>
      </div>
    </main>
  );
}
