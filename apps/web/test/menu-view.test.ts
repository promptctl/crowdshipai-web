import { authorMenu, DEFAULT_MENU_POLICY, type Menu, type OfferDraft } from '@crowdship/menu';
import { describe, expect, it } from 'vitest';

import { toMenuView } from '../src/data/menu-view';
import { offerParams } from '../src/data/offer-display';

const menuOf = (drafts: readonly OfferDraft[]): Menu => {
  const authored = authorMenu(drafts, DEFAULT_MENU_POLICY);
  if (!authored.ok) throw new Error(`test menu did not author: ${JSON.stringify(authored.error)}`);
  return authored.value;
};

describe('toMenuView — projecting a domain menu onto the watch view-model', () => {
  it('surfaces label and summary from params, the open kind verbatim, and price as a number', () => {
    const menu = menuOf([
      {
        id: 'o1',
        price: 50n,
        effect: { kind: 'shoutout', params: offerParams({ label: 'Shoutout', summary: 'name out loud' }) },
      },
      {
        id: 'o2',
        price: 1000n,
        effect: { kind: 'bounty-pool', params: offerParams({ label: 'Fund it', summary: 'ship the feature' }) },
      },
    ]);

    expect(toMenuView(menu)).toEqual([
      { id: 'o1', label: 'Shoutout', priceCoins: 50, effect: { kind: 'shoutout', summary: 'name out loud' } },
      { id: 'o2', label: 'Fund it', priceCoins: 1000, effect: { kind: 'bounty-pool', summary: 'ship the feature' } },
    ]);
  });

  it('projects an empty menu to an empty list, not a special case', () => {
    expect(toMenuView(menuOf([]))).toEqual([]);
  });
});
