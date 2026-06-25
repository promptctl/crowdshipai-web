import { getIdentityDb } from './identity';
import type { MenuStore } from './menu-store';
import { SqliteMenuStore } from './sqlite-menu-store';

/**
 * The single place the web app composes the {@link MenuStore} [LAW:single-enforcer] —
 * the menu twin of `getChannelService()`. It runs over the SAME identity DB handle
 * (`getIdentityDb()`) the channel service uses, so a builder's channel and their
 * authored menu live in one store keyed by one {@link ChannelId}, never two that could
 * disagree about which channel an offer belongs to [LAW:one-source-of-truth]. The menu
 * table's schema is owned by the durable store itself, not identity's schema, so this
 * sharing is of a connection, not of a concern [LAW:decomposition].
 */
const build = (): MenuStore => new SqliteMenuStore(getIdentityDb());

// One menu store per process, over the shared identity handle. Cached on globalThis so
// Next.js dev HMR reuses it, the same discipline getChannelService follows.
const globalForMenus = globalThis as unknown as { __crowdshipMenus?: MenuStore };
const menuStore: MenuStore = globalForMenus.__crowdshipMenus ?? build();
if (process.env.NODE_ENV !== 'production') globalForMenus.__crowdshipMenus = menuStore;

export const getMenuStore = (): MenuStore => menuStore;
