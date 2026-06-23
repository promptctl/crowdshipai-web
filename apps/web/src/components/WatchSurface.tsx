'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { FundResult, SpendResult } from '@/data/buy-result';
import type { ChatResult } from '@/data/chat-result';
import { parseChatMessage, parseFiredEffect } from '@/data/live-event';
import type { ChannelView, ChatMessage, PricedOffer } from '@/data/types';
import { sendChat } from '@/server/chat-actions';
import { buyCoins, buyOffer } from '@/server/market-actions';

import { BuilderAvatar } from './BuilderAvatar';
import { Chat } from './Chat';
import { Menu } from './Menu';
import { StreamStage } from './StreamStage';

/**
 * The watch surface: player, menu, and chat composed into one view. This client
 * component is the single owner of the live, mutating state so its children can
 * stay pure and nothing mutates behind their backs [LAW:no-ambient-temporal-coupling].
 *
 * Spending and buying coins move REAL coins on the ledger through the `buyOffer` /
 * `buyCoins` server actions; this surface never tallies money itself. Every action
 * returns the authoritative balance re-read from the ledger and the money outcome,
 * which this owner projects to the balance and a notice — so what the backer sees is
 * the ledger's truth, not an optimistic guess [LAW:one-source-of-truth]. The loud
 * cases (coins moved but the effect did not fire; fiat taken but coins not credited)
 * surface as an explicit error notice, never a silent swallow [LAW:no-silent-failure].
 *
 * A FIRED EFFECT reaches the chat through ONE path only: the live event channel.
 * When any backer's purchase fires, the stream publishes it and every watcher —
 * including the one who bought it — receives it over the SSE subscription below and
 * appends the same line. The buyer is never shown a private optimistic echo the rest
 * of the audience cannot see; what they watch fire is exactly what everyone watches
 * fire, from the single broadcast source [LAW:one-source-of-truth]. The channel is
 * best-effort and LIVE-not-history: a missed event is not a money error (the purchase
 * already committed and is recorded), and a viewer sees only what fires after they
 * connect.
 */

/** A buy outcome distilled to what this surface must do: the new balance (absent
 *  when the attempt moved no money and learned none) and the notice to show. A pure
 *  value so the outcome→view mapping is an exhaustive, side-effect-free match and a
 *  new outcome arm is a compile error [LAW:dataflow-not-control-flow]. The fired line
 *  is NOT here — it arrives from the live channel, not from the buyer's own result. */
type Notice = { readonly tone: 'ok' | 'info' | 'warn' | 'error'; readonly text: string };
type Delta = { readonly balance?: number; readonly notice: Notice };

const NEED_COINS = 'Not enough coins — buy some to spend.';
const RECONCILE_SPEND =
  'Your coins moved but the effect did not fire. You will not lose coins silently — this will be reconciled.';
const RECONCILE_FUND =
  'Payment was taken but coins were not credited. You will not lose money silently — this will be reconciled.';
// An action that REJECTS (rather than returning a typed arm) is the exceptional,
// corruption-class server failure — already loud server-side. The surface owns only
// telling the backer honestly, without claiming a money state it cannot know
// [LAW:no-silent-failure]; the next load reads the authoritative balance.
const UNCONFIRMED: Notice = {
  tone: 'error',
  text: 'Something went wrong and the result could not be confirmed. Reload to see your balance — nothing moves silently.',
};

const spendDelta = (r: SpendResult): Delta => {
  switch (r.kind) {
    case 'fired':
      return { balance: r.balance, notice: { tone: 'ok', text: 'Sent — it fired live.' } };
    case 'already-applied':
      return { balance: r.balance, notice: { tone: 'info', text: 'Already applied.' } };
    case 'insufficient-coins':
      return { balance: r.balance, notice: { tone: 'warn', text: NEED_COINS } };
    case 'charge-refused':
      return { balance: r.balance, notice: { tone: 'error', text: 'The ledger refused this purchase.' } };
    case 'effect-failed':
      return { balance: r.balance, notice: { tone: 'error', text: RECONCILE_SPEND } };
    case 'invalid-charge':
      return { balance: r.balance, notice: { tone: 'error', text: 'This purchase could not be routed.' } };
    case 'must-authenticate':
      return { notice: { tone: 'info', text: 'Sign in to spend coins.' } };
    case 'no-such-offer':
      return { notice: { tone: 'error', text: 'That offer is no longer available.' } };
  }
};

const fundDelta = (r: FundResult): Delta => {
  switch (r.kind) {
    case 'invalid-amount':
      return { notice: { tone: 'error', text: 'That is not a valid coin amount.' } };
    case 'purchased':
      return { balance: r.balance, notice: { tone: 'ok', text: 'Coins added to your wallet.' } };
    case 'charge-declined':
      return { balance: r.balance, notice: { tone: 'warn', text: 'Payment declined — no coins were added.' } };
    case 'credit-refused':
      return { balance: r.balance, notice: { tone: 'error', text: RECONCILE_FUND } };
    case 'invalid-routing':
      return { balance: r.balance, notice: { tone: 'error', text: 'That top-up could not be routed.' } };
    case 'must-authenticate':
      return { notice: { tone: 'info', text: 'Sign in to buy coins.' } };
  }
};

/** A chat send distilled to the notice the surface must show, or `null` when there
 *  is nothing to say about it: a sent line needs no notice — it appears in chat over
 *  the live channel like every other watcher's — and a blank line was never sent.
 *  Exhaustive over the result, so a new arm is a compile error here, never a silently
 *  unhandled outcome [LAW:dataflow-not-control-flow]. Unlike a buy, a chat send moves
 *  no money, so it carries no balance — just the notice. */
const chatNotice = (r: ChatResult): Notice | null => {
  switch (r.kind) {
    case 'sent':
    case 'empty':
      return null;
    case 'too-long':
      return { tone: 'warn', text: `Message too long — keep it under ${r.max} characters.` };
    case 'must-authenticate':
      return { tone: 'info', text: 'Sign in to chat.' };
  }
};

const NOTICE_TONE: Readonly<Record<Notice['tone'], string>> = {
  ok: 'border-accent-dim bg-accent/10 text-accent',
  info: 'border-edge bg-surface-2 text-fog',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/50 bg-red-500/10 text-red-300',
};

/** The coin top-up amounts offered on the surface. A value list, not a branch —
 *  changing the packs is editing this array, never code [LAW:dataflow-not-control-flow]. */
const COIN_PACKS: readonly number[] = [500, 2000, 10000];

export function WatchSurface({
  channel,
  initialBalance,
  signedIn,
}: {
  readonly channel: ChannelView;
  readonly initialBalance: number | null;
  /** Whether a live session backs this view — the chat input is a courtesy gate on
   *  it; the send action is the real authenticator [LAW:single-enforcer]. */
  readonly signedIn: boolean;
}) {
  const { stream } = channel;
  const [messages, setMessages] = useState<readonly ChatMessage[]>(channel.chat);
  // null === no wallet (logged-out). A real absence the surface renders as "sign in",
  // never a zero balance that would imply an empty account they do not have.
  const [balance, setBalance] = useState<number | null>(initialBalance);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const nextId = useRef(0);
  // One id minter, one counter — the single source of client-side chat ids, prefixed
  // by origin so a live line and a typed line never collide [LAW:one-source-of-truth].
  // It reads only the ref, so the live subscription below may call it without becoming
  // a dependency that would tear the connection down and rebuild it each render.
  const mintId = (origin: string) => `${origin}-${(nextId.current += 1)}`;

  // Subscribe to the builder's live event channel for this stream's whole lifetime
  // on the surface. The effect OWNS the connection's lifecycle — open on mount,
  // close on unmount or slug change — so nothing leaks a stale stream behind the
  // surface's back [LAW:no-ambient-temporal-coupling]. Every fired effect, from any
  // backer, arrives here and becomes a chat line; this is the SINGLE source of fired
  // lines [LAW:one-source-of-truth]. A frame that is not a fired effect (a future
  // event type, a garbled frame) parses to null and is simply not a chat line — honest
  // optionality at the wire trust boundary, not a swallowed error [LAW:no-silent-failure].
  useEffect(() => {
    const source = new EventSource(`/watch/${stream.slug}/events`);
    source.onmessage = (e) => {
      // The one subscription carries every event type on the topic; route each frame
      // to its renderer by which parser claims it. A fired effect and a chat line are
      // both chat messages [LAW:one-type-per-behavior]; a frame neither parser claims
      // is a future event type this build does not render — simply not a line, never
      // an error [LAW:no-silent-failure].
      const fired = parseFiredEffect(e.data);
      if (fired !== null) {
        setMessages((prev) => [...prev, { id: mintId('live'), author: '', text: '', firedEffectKind: fired.effectKind }]);
        return;
      }
      const chat = parseChatMessage(e.data);
      if (chat !== null) {
        setMessages((prev) => [...prev, { id: mintId('chat'), author: chat.author, text: chat.text }]);
      }
    };
    return () => source.close();
  }, [stream.slug]);

  // Apply a buy outcome's view delta: the new balance and the notice, moved together
  // so the surface never shows a stale balance beside a fresh notice [LAW:one-source-of-truth].
  // The fired chat line is NOT applied here — it arrives over the live channel above,
  // the same broadcast every other watcher sees.
  const apply = (delta: Delta) => {
    if (delta.balance !== undefined) setBalance(delta.balance);
    setNotice(delta.notice);
  };

  const onSpend = async (offer: PricedOffer) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(spendDelta(await buyOffer(stream.slug, offer.id, crypto.randomUUID())));
    } catch {
      setNotice(UNCONFIRMED);
    } finally {
      setBusy(false);
    }
  };

  const onBuyCoins = async (amount: number) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(fundDelta(await buyCoins(amount, crypto.randomUUID())));
    } catch {
      setNotice(UNCONFIRMED);
    } finally {
      setBusy(false);
    }
  };

  // Sending a line PUBLISHES it onto the live channel; it does NOT echo locally. The
  // sender's own line arrives back over the same SSE subscription every other watcher
  // reads, so what they see is the one broadcast under their public author, never a
  // private "you" line the rest of the audience cannot see [LAW:one-source-of-truth] —
  // exactly how a fired effect already reaches them. The draft clears optimistically
  // and is restored on any non-sent outcome, so a refused or too-long line is never
  // lost [LAW:no-silent-failure].
  const onSend = async () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    try {
      const result = await sendChat(stream.slug, text);
      if (result.kind !== 'sent') {
        setDraft(text);
        const next = chatNotice(result);
        if (next !== null) setNotice(next);
      }
    } catch {
      setDraft(text);
      setNotice(UNCONFIRMED);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-5 py-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <StreamStage accentHue={stream.accentHue} isLive={stream.isLive} viewerCount={stream.viewerCount} size="stage" />
          <div className="mt-4 flex items-start gap-3">
            <BuilderAvatar accentHue={stream.accentHue} className="h-11 w-11" />
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
          <Wallet balance={balance} busy={busy} onBuyCoins={onBuyCoins} />
          {notice !== null && (
            <p className={`rounded-md border px-3 py-2 text-xs leading-snug ${NOTICE_TONE[notice.tone]}`}>
              {notice.text}
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-edge bg-surface">
            <Menu offers={channel.menu} balance={balance ?? 0} onSpend={onSpend} />
          </div>
          <div className="flex-1 overflow-hidden rounded-lg border border-edge bg-surface">
            <Chat messages={messages} draft={draft} onDraftChange={setDraft} onSend={onSend} signedIn={signedIn} />
          </div>
        </aside>
      </div>
    </main>
  );
}

/** The wallet header: the backer's coin balance and the coin top-ups, or a sign-in
 *  prompt for a logged-out viewer who has no wallet yet. Spending lives in the menu;
 *  funding the wallet lives here, beside the balance it changes [LAW:decomposition]. */
function Wallet({
  balance,
  busy,
  onBuyCoins,
}: {
  readonly balance: number | null;
  readonly busy: boolean;
  readonly onBuyCoins: (amount: number) => void;
}) {
  if (balance === null) {
    return (
      <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm text-fog">
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>{' '}
        to buy coins and support this build.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fog">wallet</span>
        <span className="text-sm font-semibold text-accent tabular-nums">◎ {balance.toLocaleString('en-US')}</span>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {COIN_PACKS.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={busy}
            onClick={() => onBuyCoins(amount)}
            className="flex-1 rounded-sm border border-edge bg-surface-2 px-2 py-1.5 text-xs font-semibold text-chalk transition-colors hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:text-fog"
          >
            +{amount.toLocaleString('en-US')}
          </button>
        ))}
      </div>
    </div>
  );
}
