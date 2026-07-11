'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { FundResult, PledgeResult, SpendResult } from '@/data/buy-result';
import type { ChatResult } from '@/data/chat-result';
import { parseChatMessage, parseFiredEffect, parseSettlement, parseViewerPresence } from '@/data/live-event';
import type { ChannelView, ChatMessage, PoolView, PricedOffer, SettlementEventView } from '@/data/types';
import { sendChat } from '@/server/chat-actions';
import { buyCoins, buyOffer, listPools, pledgeToPool, settlementEvents } from '@/server/market-actions';

import { BuilderAvatar } from './BuilderAvatar';
import { Chat } from './Chat';
import { Menu } from './Menu';
import { StreamPlayer } from './StreamPlayer';
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
type Delta = {
  readonly balance?: number;
  readonly notice: Notice;
  /** Present when a pledge moved coins — carry the updated pool so the panel reflects
   *  the ledger's new escrow balance without a second round-trip [LAW:one-source-of-truth]. */
  readonly poolUpdated?: PoolView;
};

const pledgeDelta = (r: PledgeResult): Delta => {
  switch (r.kind) {
    case 'contributed-pending':
      return {
        balance: r.balance,
        poolUpdated: r.pool,
        notice: { tone: 'ok', text: `Pledged — ◎ ${r.pool.pooledCoins.toLocaleString('en-US')} / ${r.pool.targetCoins.toLocaleString('en-US')} pooled.` },
      };
    case 'contributed-released':
      // The SHIPPED chat line is NOT appended here: the release rides the live channel's
      // settlement frame, so the tipping backer sees exactly the broadcast every other
      // watcher sees — one source, no private echo [LAW:one-source-of-truth].
      return {
        balance: r.balance,
        poolUpdated: r.pool,
        notice: { tone: 'ok', text: `Pool hit its target — auto-released to the builder!` },
      };
    case 'insufficient-coins':
      return { balance: r.balance, notice: { tone: 'warn', text: NEED_COINS } };
    case 'pledge-refused':
      return { balance: r.balance, notice: { tone: 'error', text: 'The ledger refused this pledge.' } };
    case 'invalid-pledge':
      return { notice: { tone: 'error', text: 'This pledge could not be routed.' } };
    case 'must-authenticate':
      return { notice: { tone: 'info', text: 'Sign in to pledge coins.' } };
    case 'pool-cancelled':
      // No coins moved; the carried view catches this surface up to the pool as it now
      // stands, so the card stops inviting pledges the market will refuse
      // [LAW:one-source-of-truth].
      return {
        poolUpdated: r.pool,
        notice: { tone: 'warn', text: 'The builder cancelled this pool — pledges were refunded.' },
      };
    case 'no-such-pool':
      return { notice: { tone: 'error', text: 'That pool is no longer available.' } };
  }
};

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
  initialViewerCount,
  initialPools,
  initialSettlement,
  signedIn,
}: {
  readonly channel: ChannelView;
  readonly initialBalance: number | null;
  /** The live viewer count at first paint, read from the presence registry at the
   *  server edge — the registry is its source of truth, never the catalog's static
   *  summary or this feed [LAW:one-source-of-truth]. The surface keeps it live below. */
  readonly initialViewerCount: number;
  /** The builder's funding pools as of the first paint — their live escrow balances,
   *  read at the server edge [LAW:one-source-of-truth]. Updated client-side as
   *  backers pledge so the panel reflects the ledger without a page reload. */
  readonly initialPools: readonly PoolView[];
  /** The channel's settlement timeline at first paint — the ledger's own recorded
   *  history projected at the server edge, so a viewer who just arrived (or just
   *  reconnected) reads the same durable money story as one who watched it happen
   *  [LAW:one-source-of-truth]. Kept live below by re-reading on settlement nudges. */
  readonly initialSettlement: readonly SettlementEventView[];
  /** Whether a live session backs this view — the chat input is a courtesy gate on
   *  it; the send action is the real authenticator [LAW:single-enforcer]. */
  readonly signedIn: boolean;
}) {
  const { stream } = channel;
  const [messages, setMessages] = useState<readonly ChatMessage[]>(channel.chat);
  const [pools, setPools] = useState<readonly PoolView[]>(initialPools);
  const [settlement, setSettlement] = useState<readonly SettlementEventView[]>(initialSettlement);
  // The viewer count is owned here and seeded from the registry's reading at the edge,
  // then driven live by presence frames off the one subscription below. It is derived
  // state surfaced from the registry's truth, never a tally this surface keeps itself
  // [LAW:one-source-of-truth] — each frame carries the whole count, so the surface
  // replaces rather than accumulates [LAW:dataflow-not-control-flow].
  const [viewerCount, setViewerCount] = useState(initialViewerCount);
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
  // The nudge→re-read half of the settlement spine: every settlement frame prompts a
  // fresh read of the pools and the settlement timeline from the ledger's own record,
  // so what this surface shows is always a projection of the durable truth, never an
  // accumulation of frames that could drift or double [LAW:one-source-of-truth]. Reads
  // can land out of order; the sequence ref names the one owner of "which read is
  // current", so a slow older read never overwrites a newer view
  // [LAW:no-ambient-temporal-coupling]. A ref, not state: bumping it must not re-render.
  const moneyReadSeq = useRef(0);

  useEffect(() => {
    const source = new EventSource(`/watch/${stream.slug}/events`);
    const refreshMoney = () => {
      const seq = (moneyReadSeq.current += 1);
      void Promise.all([listPools(stream.slug), settlementEvents(stream.slug)])
        .then(([poolsNow, settlementNow]) => {
          if (moneyReadSeq.current !== seq) return;
          setPools(poolsNow);
          setSettlement(settlementNow);
        })
        .catch(() => {
          // The durable record is intact server-side; only this view's refresh failed.
          // Say so honestly rather than leaving a silently stale money panel
          // [LAW:no-silent-failure].
          setNotice({ tone: 'warn', text: 'Live money view failed to refresh — reload to see the latest.' });
        });
    };
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
        return;
      }
      // A settlement frame: money moved against one of this builder's pools. Always a
      // nudge to re-read the durable projection; additionally the one broadcast line the
      // audience sees the moment a pool settles — SHIPPED forward to the builder or
      // REFUNDED back to its backers, the failure mode shown as plainly as the success —
      // rendered from the frame's recorded figures, the same broadcast for every watcher
      // [LAW:one-source-of-truth]. The settled arm maps to its line kind by its
      // discriminant, one shape per arm [LAW:dataflow-not-control-flow].
      const settled = parseSettlement(e.data);
      if (settled !== null) {
        refreshMoney();
        const moment = settled.settled;
        if (moment !== undefined) {
          const line =
            moment.kind === 'shipped'
              ? { settledPool: { title: settled.poolTitle, releasedCoins: moment.releasedCoins, cutCoins: moment.cutCoins } }
              : { refundedPool: { title: settled.poolTitle, refundedCoins: moment.refundedCoins } };
          setMessages((prev) => [...prev, { id: mintId('settlement'), author: '', text: '', ...line }]);
        }
        return;
      }
      // A presence frame is not a chat line — it sets the live viewer count, the one
      // event type this surface renders outside the message list. The count it carries
      // is the registry's already-derived truth; the surface shows it, never sums it
      // [LAW:one-source-of-truth].
      const presence = parseViewerPresence(e.data);
      if (presence !== null) {
        setViewerCount(presence.count);
      }
    };
    return () => source.close();
  }, [stream.slug]);

  // Apply a buy outcome's view delta: the new balance and the notice, moved together
  // so the surface never shows a stale balance beside a fresh notice [LAW:one-source-of-truth].
  // Neither the fired chat line nor the pool-shipped line is applied here — both arrive
  // over the live channel above, the same broadcast every other watcher sees, so the
  // buyer is never shown a private echo the audience cannot [LAW:one-source-of-truth].
  const apply = (delta: Delta) => {
    if (delta.balance !== undefined) setBalance(delta.balance);
    setNotice(delta.notice);
    if (delta.poolUpdated !== undefined) {
      const updated = delta.poolUpdated;
      setPools((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
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

  const onPledge = async (poolId: string, amount: number) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(pledgeDelta(await pledgeToPool(poolId, amount, crypto.randomUUID())));
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
  // exactly how a fired effect already reaches them.
  const onSend = async () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    // The draft clears optimistically; on a non-sent outcome we hand the line back
    // ONLY if the input is still empty — so a refused or too-long line is never lost,
    // yet a fresh line the viewer began typing during the round-trip is never
    // clobbered [LAW:no-silent-failure].
    const restoreDraft = () => setDraft((current) => (current.length === 0 ? text : current));
    try {
      const result = await sendChat(stream.slug, text);
      if (result.kind !== 'sent') {
        restoreDraft();
        const next = chatNotice(result);
        if (next !== null) setNotice(next);
      }
    } catch {
      restoreDraft();
      setNotice(UNCONFIRMED);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-5 py-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <StreamStage
            accentHue={stream.accentHue}
            isLive={stream.isLive}
            viewerCount={viewerCount}
            size="stage"
            overlay={<StreamPlayer slug={stream.slug} />}
          />
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
          {pools.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-edge bg-surface">
              <Pools pools={pools} balance={balance ?? 0} busy={busy} onPledge={onPledge} />
            </div>
          )}
          {settlement.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-edge bg-surface">
              <SettlementFeed events={settlement} />
            </div>
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

/**
 * The funding pools panel: each pool the builder has opened, with a progress bar
 * and a pledge button. Collapsed when there are no pools (nothing to render, not an
 * empty state UI). The panel is a pure value consumer — pledge amounts are fixed
 * suggestions, not free text, keeping the pledge path predictable
 * [LAW:dataflow-not-control-flow]. The variability is the pool list, a value, not
 * branches on "are there pools" [LAW:no-mode-explosion].
 */
function Pools({
  pools,
  balance,
  busy,
  onPledge,
}: {
  readonly pools: readonly PoolView[];
  readonly balance: number;
  readonly busy: boolean;
  readonly onPledge: (poolId: string, amount: number) => void;
}) {
  return (
    <div className="p-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-fog">fund a feature</span>
      <div className="mt-2.5 flex flex-col gap-3">
        {pools.map((pool) => (
          <PoolCard key={pool.id} pool={pool} balance={balance} busy={busy} onPledge={onPledge} />
        ))}
      </div>
    </div>
  );
}

/** How each settlement kind reads on the timeline — verb, direction, and tone as a
 *  value map over the closed kind union, so rendering a kind is a lookup and a new
 *  kind is a compile error in this Record, never an invisible money line
 *  [LAW:dataflow-not-control-flow]. Tones follow the money: contributions fill
 *  (neutral), a release ships (emerald, the SHIPPED green), the cut is the platform's
 *  skim in plain view (amber), a refund makes a backer whole (fog). */
const SETTLEMENT_LINE: Readonly<
  Record<SettlementEventView['kind'], { readonly verb: string; readonly sign: '+' | '−'; readonly tone: string }>
> = {
  contribution: { verb: 'pooled by', sign: '+', tone: 'text-chalk/90' },
  release: { verb: 'released to', sign: '−', tone: 'text-emerald-300' },
  cut: { verb: 'platform cut to', sign: '−', tone: 'text-amber-300' },
  refund: { verb: 'refunded to', sign: '−', tone: 'text-fog' },
};

/**
 * The transparent settlement timeline: every recorded movement of this channel's pool
 * escrows, newest first, exactly as the ledger tells it — the audience watches the money
 * itself, never a tally this surface keeps [LAW:one-source-of-truth]. A pure projection
 * of the `events` value; liveness is the owner's concern (it re-reads on every
 * settlement nudge), never this renderer's [LAW:decomposition].
 */
function SettlementFeed({ events }: { readonly events: readonly SettlementEventView[] }) {
  const newestFirst = [...events].reverse();
  return (
    <div className="p-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-fog">settlement</span>
      <div className="mt-2.5 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
        {newestFirst.map((e, i) => {
          const line = SETTLEMENT_LINE[e.kind];
          return (
            // Index keys are stable here because the list is replaced whole on every
            // re-read, never mutated in place.
            <div key={i} className="text-[11px] leading-snug">
              <span className={`font-semibold tabular-nums ${line.tone}`}>
                {line.sign} ◎ {e.amountCoins.toLocaleString('en-US')}
              </span>{' '}
              <span className="text-fog">{line.verb}</span>{' '}
              <span className="font-semibold text-chalk/90">{e.party}</span>
              <span className="text-fog">
                {' '}
                — {e.poolTitle} · ◎ {e.pooledAfterCoins.toLocaleString('en-US')} in escrow
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A single pool card: progress bar, pooled/target display, and a pledge button. */
function PoolCard({
  pool,
  balance,
  busy,
  onPledge,
}: {
  readonly pool: PoolView;
  readonly balance: number;
  readonly busy: boolean;
  readonly onPledge: (poolId: string, amount: number) => void;
}) {
  const pct = pool.targetCoins > 0 ? Math.min(100, (pool.pooledCoins / pool.targetCoins) * 100) : 0;
  // A fixed suggestion list, not a free-entry field — keeps the pledge path predictable and
  // lets the backer contribute with one click [LAW:dataflow-not-control-flow]. The variety
  // is the amounts list, a value, not code branches on which amount was chosen.
  const PLEDGE_AMOUNTS = [100, 500, 1000];
  return (
    <div className="rounded-sm border border-edge bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-chalk leading-snug">{pool.title}</p>
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
      <p className="mt-1 text-[11px] text-fog">
        ◎ {pool.pooledCoins.toLocaleString('en-US')} / {pool.targetCoins.toLocaleString('en-US')}
      </p>
      {!pool.released && !pool.cancelled && (
        <div className="mt-2 flex gap-1">
          {PLEDGE_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              // Named for the pool it pledges into: the visible "+500" alone is ambiguous —
              // the wallet's top-up packs share it — for assistive tech and automation alike.
              aria-label={`Pledge ${amount} to ${pool.title}`}
              disabled={busy || balance < amount}
              onClick={() => onPledge(pool.id, amount)}
              className="flex-1 rounded-sm border border-edge bg-surface px-1.5 py-1 text-[11px] font-semibold text-chalk transition-colors hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:text-fog"
            >
              +{amount}
            </button>
          ))}
        </div>
      )}
    </div>
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
