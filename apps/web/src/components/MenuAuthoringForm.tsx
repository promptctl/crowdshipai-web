'use client';

import { useActionState, useState } from 'react';
import type { MenuProblem, OfferProblem } from '@crowdship/menu';

import type { MenuAuthorResult } from '@/data/menu-result';
import type { PricedOffer } from '@/data/types';
import { setMenuAction } from '@/server/menu-actions';

/**
 * The builder's menu-authoring surface — where they wire up, price, and arrange the
 * things they sell. This is "the menu belongs to the builder" made into a form: it gives
 * them open fields (a name, a price, an effect label their overlay reacts to, and a
 * description), never a dropdown of platform-approved offer types [the founding "menu
 * belongs to the builder" line]. It does ONE thing — edit and submit the whole menu
 * [LAW:composability]; the action persists it against their authenticated channel and
 * returns an honest outcome this component renders.
 *
 * The reason line is an EXHAUSTIVE match over every non-`saved` {@link MenuAuthorResult}
 * arm, so a new outcome the core can return is a compile error here rather than a
 * silently blank notice [LAW:dataflow-not-control-flow][LAW:no-silent-failure].
 */

interface OfferRow {
  readonly id: string;
  readonly label: string;
  readonly price: string;
  readonly kind: string;
  readonly summary: string;
}

const rowFromOffer = (offer: PricedOffer): OfferRow => ({
  id: offer.id,
  label: offer.label,
  price: String(offer.priceCoins),
  kind: offer.effect.kind,
  summary: offer.effect.summary,
});

const blankRow = (index: number): OfferRow => ({
  id: `offer-${index + 1}`,
  label: '',
  price: '',
  kind: '',
  summary: '',
});

const offerProblemNotice = (problem: OfferProblem): string => {
  switch (problem.field) {
    case 'id':
      return 'offer id must not be blank';
    case 'price':
      return 'price must be a positive number of coins';
    case 'effect-kind':
      return 'effect must not be blank';
  }
};

const menuProblemNotice = (problem: MenuProblem): string => {
  switch (problem.kind) {
    case 'offer':
      return `Offer ${problem.at + 1}: ${offerProblemNotice(problem.problem)}.`;
    case 'duplicate-id':
      return `Offer id “${problem.id}” is used on more than one offer (offers ${problem.at
        .map((i) => i + 1)
        .join(', ')}).`;
    case 'too-many-offers':
      return `Too many offers: ${problem.actual} submitted, at most ${problem.limit} allowed.`;
  }
};

const resultNotice = (result: Exclude<MenuAuthorResult, { kind: 'saved' }>): string => {
  switch (result.kind) {
    case 'must-authenticate':
      return 'Sign in to author your menu.';
    case 'no-channel':
      return 'Claim a channel before authoring a menu.';
    case 'malformed-submission':
      return 'Your menu submission was malformed — reload the page and try again.';
    case 'invalid-prices':
      return `Prices must be whole numbers of coins (offers ${result.at
        .map((i) => i + 1)
        .join(', ')}).`;
    case 'invalid':
      return result.problems.map(menuProblemNotice).join(' ');
  }
};

export function MenuAuthoringForm({ initialOffers }: { initialOffers: readonly PricedOffer[] }) {
  const [rows, setRows] = useState<OfferRow[]>(() => initialOffers.map(rowFromOffer));
  const [state, formAction, pending] = useActionState<MenuAuthorResult | null, FormData>(
    setMenuAction,
    null,
  );

  const setRow = (index: number, patch: Partial<OfferRow>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const removeRow = (index: number): void =>
    setRows((current) => current.filter((_, i) => i !== index));
  const addRow = (): void => setRows((current) => [...current, blankRow(current.length)]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* The whole menu travels as one JSON field, kept in sync with the editor state, so
          the action receives exactly the rows shown [LAW:one-source-of-truth]. */}
      <input type="hidden" name="offers" value={JSON.stringify(rows)} />

      {rows.length === 0 && (
        <p className="text-sm text-fog">
          No offers yet. Add one to give your audience something to buy.
        </p>
      )}

      {rows.map((row, index) => (
        <fieldset
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-edge bg-surface-2 p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-fog">
              offer {index + 1}
            </span>
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="text-xs text-fog hover:text-live"
            >
              remove
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-fog">
            name
            <input
              value={row.label}
              onChange={(e) => setRow(index, { label: e.target.value })}
              placeholder="Shoutout"
              className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs text-fog">
              price (coins)
              <input
                value={row.price}
                onChange={(e) => setRow(index, { price: e.target.value })}
                inputMode="numeric"
                placeholder="50"
                className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-fog">
              effect
              <input
                value={row.kind}
                onChange={(e) => setRow(index, { kind: e.target.value })}
                placeholder="shoutout"
                className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-fog">
            description
            <input
              value={row.summary}
              onChange={(e) => setRow(index, { summary: e.target.value })}
              placeholder="I read your name out loud, on stream."
              className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-chalk outline-none focus:border-accent-dim"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-fog">
            offer id (stable key your buy links use)
            <input
              value={row.id}
              onChange={(e) => setRow(index, { id: e.target.value })}
              placeholder="offer-1"
              className="rounded-md border border-edge bg-surface px-3 py-2 text-xs text-fog outline-none focus:border-accent-dim"
            />
          </label>
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded-full border border-edge px-4 py-2 text-sm font-semibold text-chalk transition-colors hover:border-accent-dim"
        >
          + add offer
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-dim disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save menu'}
        </button>
      </div>

      {state !== null && state.kind === 'saved' && (
        <p role="status" className="text-xs font-semibold text-accent">
          Menu saved — {state.count} {state.count === 1 ? 'offer' : 'offers'} live.
        </p>
      )}
      {state !== null && state.kind !== 'saved' && (
        <p role="alert" className="text-xs font-semibold text-live">
          {resultNotice(state)}
        </p>
      )}
    </form>
  );
}
