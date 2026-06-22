import {
  DEFAULT_HANDLE_POLICY,
  StandardChannelService,
  type ChannelService,
} from '@crowdship/identity';
import { CryptoIdMint, SqliteChannelStore, SystemClock } from '@crowdship/identity-node';

import { getAuthService, getIdentityDb } from './identity';

/**
 * The single place the web app composes the {@link ChannelService}
 * [LAW:single-enforcer] — the channel-lifecycle twin of `getAuthService()`. It runs
 * over the SAME identity DB handle (`getIdentityDb()`) the auth service uses, so a
 * claim's two writes — granting the `builder` capability and inserting the channel —
 * land in one store, never two that could disagree [LAW:one-source-of-truth].
 *
 * The `roles` dependency is the auth service itself: granting the builder capability
 * on claim is identity's single write path, and `AuthService` satisfies the narrow
 * {@link RoleGranter} port structurally, so the channel service depends on exactly
 * that one capability and nothing more of the auth lifecycle [LAW:locality-or-seam].
 * Authorization — who may claim, rename, or set verification — is NOT here; it is the
 * auth gate's call at the edge (`mayManageChannel`, `maySetVerification`), which this
 * service trusts has already run.
 */
const build = (): ChannelService =>
  new StandardChannelService({
    clock: new SystemClock(),
    ids: new CryptoIdMint(),
    roles: getAuthService(),
    store: new SqliteChannelStore(getIdentityDb()),
    policy: DEFAULT_HANDLE_POLICY,
  });

// One channel service per process, over the shared identity handle. Cached on
// globalThis so Next.js dev HMR reuses it, the same discipline getAuthService follows.
const globalForChannels = globalThis as unknown as { __crowdshipChannels?: ChannelService };
const channelService: ChannelService = globalForChannels.__crowdshipChannels ?? build();
if (process.env.NODE_ENV !== 'production') globalForChannels.__crowdshipChannels = channelService;

export const getChannelService = (): ChannelService => channelService;
