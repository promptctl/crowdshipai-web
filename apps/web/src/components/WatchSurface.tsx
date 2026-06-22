'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

import type { FundResult, SpendResult } from '@/data/buy-result';
import type { ChannelView, ChatMessage, PricedOffer } from '@/data/types';
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
 * which this owner projects to the balance, the chat, and a notice — so what the
 * backer sees is the ledger's truth, not an optimistic guess [LAW:one-source-of-truth].
 * The loud cases (coins moved but the effect did not fire; fiat taken but coins not
 * credited) surface as an explicit error notice, never a silent swallow [LAW:no-silent-failure].
 */

/** A buy outcome distilled to what this surface must do: the new balance (absent
 *  when the attempt moved no money and learned none), whether to post a fired-offer
 *  line, and the notice to show. A pure value so the outcome→view mapping is an
 *  exhaustive, side-effect-free match and a new outcome arm is a compile error
 *  [LAW:dataflow-not-control-flow]. */
type Notice = { readonly tone: 'ok' | 'info' | 'warn' | 'error'; readonly text: string };
type Delta = { readonly balance?: number; readonly fire?: true; readonly notice: Notice };

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
      return { balance: r.balance, fire: true, notice: { tone: 'ok', text: 'Sent — it fired live.' } };
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
}: {
  readonly channel: ChannelView;
  readonly initialBalance: number | null;
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
  const localId = () => `local-${(nextId.current += 1)}`;

  const append = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  // Apply a buy outcome's view delta. The one place balance, chat, and notice move
  // together after a money action, so the surface can never show, say, a fired line
  // without the balance that paid for it [LAW:one-source-of-truth].
  const apply = (delta: Delta, firedLabel: string) => {
    if (delta.balance !== undefined) setBalance(delta.balance);
    if (delta.fire === true) append({ id: localId(), author: 'you', text: '', firedOfferLabel: firedLabel });
    setNotice(delta.notice);
  };

  const onSpend = async (offer: PricedOffer) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await buyOffer(stream.slug, offer.id, crypto.randomUUID());
      apply(spendDelta(result), offer.label);
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
      apply(fundDelta(await buyCoins(amount, crypto.randomUUID())), '');
    } catch {
      setNotice(UNCONFIRMED);
    } finally {
      setBusy(false);
    }
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
            <Chat messages={messages} draft={draft} onDraftChange={setDraft} onSend={onSend} />
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
