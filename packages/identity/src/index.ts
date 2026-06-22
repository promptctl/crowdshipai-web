/**
 * The identity domain: the base account record and the whole auth lifecycle —
 * signup, login, sessions, recovery — behind one swappable port [LAW:locality-or-seam].
 * The trust boundary for all external identity input. Roles (bb2.2), the builder
 * channel (bb2.3), trust signals (bb2.4), and the single auth gate (bb2.5) build
 * on this; they are not it.
 */
export type { Account } from './account.js';
export type { Session, Authenticated } from './session.js';
export { isExpired } from './session.js';

export type {
  Channel,
  ChannelProfile,
  Handle,
  HandleError,
  DisplayName,
  DisplayNameError,
  Bio,
  BioError,
  VerificationStatus,
  VerificationStatusError,
} from './channel.js';
export {
  handle,
  displayName,
  bio,
  EMPTY_BIO,
  verificationStatus,
  VERIFICATION_STATUSES,
  UNVERIFIED,
} from './channel.js';

export type { HandlePolicy, HandleReservation, HandlePolicyConfig } from './handle-policy.js';
export {
  StandardHandlePolicy,
  DEFAULT_HANDLE_POLICY,
  DEFAULT_RESERVED_WORDS,
  DEFAULT_BRAND_TERMS,
} from './handle-policy.js';

export type { ChannelStore } from './channel-store.js';
export { InMemoryChannelStore } from './channel-store.js';

export type {
  ChannelService,
  ChannelServiceDeps,
  ChannelClaim,
  ChannelIdMint,
  RoleGranter,
} from './channel-service.js';
export { StandardChannelService } from './channel-service.js';

export type { Principal } from './authz.js';
export { mayManageChannel, isPlatformStaff, maySetVerification } from './authz.js';

export type { Role, RoleSet, RoleError } from './roles.js';
export {
  ROLES,
  DEFAULT_ROLES,
  NO_ROLES,
  role,
  roleSet,
  hasRole,
  withRole,
  withoutRole,
} from './roles.js';

export type {
  AccountId,
  SessionId,
  ChannelId,
  SessionToken,
  RecoveryToken,
  Secret,
  Email,
  BlankError,
  EmailError,
  SecretError,
} from './ids.js';
export { accountId, sessionId, channelId, sessionToken, recoveryToken, secret, email } from './ids.js';

export type {
  SignUpError,
  LogInError,
  SessionError,
  ResetError,
  RoleChangeError,
  ClaimError,
  RenameError,
  EditProfileError,
  VerificationError,
} from './errors.js';

export type {
  AuthService,
  LoginGrant,
  IdMint,
  SecretMint,
  CredentialStore,
  RecoveryDelivery,
} from './service.js';

export type { AuthStore, Recovery } from './store.js';
export { InMemoryAuthStore } from './store.js';

export type { AuthServiceDeps, InMemoryAuthDeps } from './standard-service.js';
export { StandardAuthService, InMemoryAuthService } from './standard-service.js';
