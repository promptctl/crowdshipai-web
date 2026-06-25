import type { AccountId, Channel, ChannelId, Principal } from '@crowdship/identity';
import { authorMenu, DEFAULT_MENU_POLICY, type Menu, type OfferDraft } from '@crowdship/menu';

import { offerParams } from '../data/offer-display';
import type { MenuAuthorResult } from '../data/menu-result';

/**
 * Authoring a builder's menu, as PURE orchestration over already-resolved values — the
 * menu twin of `claim-core.ts`. It takes the acting principal, the raw form drafts, and
 * the channel-lookup and save capabilities as plain inputs, so the whole decision is
 * reproducible in a test without a session, a cookie, or a database
 * [LAW:effects-at-boundaries]. The `'use server'` edge (`menu-actions.ts`) resolves
 * those from the request and the composition roots and hands them here.
 *
 * Authentication is checked FIRST: you cannot author a menu as no one. The channel the
 * menu binds to is read from the authenticated principal's OWN account — never a value
 * the form supplies — so the browser cannot author a menu onto another builder's channel
 * [LAW:single-enforcer]. {@link AuthorMenuInput} has no channel/owner field at all, so
 * that spoof is UNREPRESENTABLE [LAW:types-are-the-program]. The raw drafts ARE
 * untrusted, so prices cross their string→number boundary here and the whole set crosses
 * the menu domain's `authorMenu` boundary before any store is touched.
 */

/** One offer exactly as the builder typed it — every field still a raw string that has
 *  NOT passed a trust boundary. There is deliberately NO channel/owner field: which
 *  channel this menu belongs to is the authenticated principal's, never the client's. */
export interface RawOffer {
  readonly id: string;
  readonly price: string;
  readonly kind: string;
  readonly label: string;
  readonly summary: string;
}

export interface AuthorMenuInput {
  readonly offers: readonly RawOffer[];
}

export interface AuthorMenuDeps {
  readonly principal: Principal | null;
  /** The authenticated account's channel, if they have claimed one — `channelByOwner`. */
  channelOf(ownerId: AccountId): Promise<Channel | undefined>;
  /** Persist the validated menu against the builder's channel — the one effect, at the edge. */
  saveMenu(channelId: ChannelId, menu: Menu): Promise<void>;
}

/**
 * Parse a raw price into coins. A whole, non-negative number string is the only legal
 * shape; anything else (a decimal, letters, blank) is `null` — the non-numeric fault the
 * `coinAmount` positivity check downstream cannot express [LAW:no-silent-failure]. Coins
 * are whole units, so a fractional price is rejected here, not silently truncated.
 */
const parseCoins = (raw: string): bigint | null =>
  /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;

export const performAuthorMenu = async (
  deps: AuthorMenuDeps,
  input: AuthorMenuInput,
): Promise<MenuAuthorResult> => {
  if (deps.principal === null) return { kind: 'must-authenticate' };

  const channel = await deps.channelOf(deps.principal.id);
  if (channel === undefined) return { kind: 'no-channel' };

  // Cross the price trust boundary first: collect the positions whose price is not a
  // whole number, building drafts for the rest. If any price is non-numeric we report
  // exactly those positions and touch no store — coinAmount inside authorMenu reports
  // non-positive, this reports non-numeric, the distinct fault [LAW:no-silent-failure].
  const drafts: OfferDraft[] = [];
  const badPrices: number[] = [];
  input.offers.forEach((offer, at) => {
    const coins = parseCoins(offer.price);
    if (coins === null) {
      badPrices.push(at);
      return;
    }
    drafts.push({
      id: offer.id,
      price: coins,
      effect: { kind: offer.kind, params: offerParams({ label: offer.label, summary: offer.summary }) },
    });
  });
  if (badPrices.length > 0) return { kind: 'invalid-prices', at: badPrices };

  // The menu domain's single trust boundary validates the whole submission at once —
  // field faults, duplicate ids, the guardrail cap — and its failures are forwarded
  // verbatim, never collapsed [LAW:no-silent-failure].
  const authored = authorMenu(drafts, DEFAULT_MENU_POLICY);
  if (!authored.ok) return { kind: 'invalid', problems: authored.error };

  await deps.saveMenu(channel.id, authored.value);
  return { kind: 'saved', count: authored.value.offers.length };
};
