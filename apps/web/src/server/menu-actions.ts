'use server';

import type { MenuAuthorResult } from '../data/menu-result';
import { getChannelService } from './channels';
import { performAuthorMenu, type RawOffer } from './menu-author-core';
import { getMenuStore } from './menus';
import { currentPrincipal } from './principal';

/**
 * Read the builder's submitted offers out of the form payload — the untrusted edge.
 * The client serializes its offer rows into one `offers` JSON field; a payload that
 * is not a JSON array of objects is a broken client, surfaced loudly rather than
 * silently treated as an empty menu that would WIPE the builder's real one
 * [LAW:no-silent-failure]. Each field is coerced to the string the pure core expects
 * (the core and `authorMenu` are the trust boundaries that judge the values); a missing
 * field becomes the empty string, which `authorMenu` rejects as blank.
 */
const readOffers = (formData: FormData): RawOffer[] => {
  const parsed: unknown = JSON.parse(String(formData.get('offers') ?? '[]'));
  if (!Array.isArray(parsed)) throw new Error('menu submission is not a list of offers');
  return parsed.map((entry): RawOffer => {
    const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      id: String(record.id ?? ''),
      price: String(record.price ?? ''),
      kind: String(record.kind ?? ''),
      label: String(record.label ?? ''),
      summary: String(record.summary ?? ''),
    };
  });
};

/**
 * The menu-authoring server action the studio's menu form calls — the `'use server'`
 * edge over {@link performAuthorMenu}. It is the trust boundary where WHO is authoring
 * is decided: the acting principal is resolved HERE from the session, and the channel
 * the menu binds to is that principal's own (resolved inside the core via
 * `channelByOwner`), never a value the form supplies [LAW:single-enforcer]. The save
 * capability is bound to the one composition-root menu store, so the authored menu lands
 * in the single durable store the catalog reads back [LAW:one-source-of-truth]. Every
 * outcome — saved or any refusal — is returned for the form to render as an honest
 * reason; there is no redirect, so the builder stays on their menu and sees it persist.
 */
export async function setMenuAction(
  _prev: MenuAuthorResult | null,
  formData: FormData,
): Promise<MenuAuthorResult> {
  return performAuthorMenu(
    {
      principal: await currentPrincipal(),
      channelOf: (ownerId) => getChannelService().channelByOwner(ownerId),
      saveMenu: (channelId, menu) => getMenuStore().setMenu(channelId, menu),
    },
    { offers: readOffers(formData) },
  );
}
