import { randomBytes, randomUUID } from 'node:crypto';
import {
  accountId,
  channelId,
  recoveryToken,
  sessionId,
  sessionToken,
  type AccountId,
  type ChannelId,
  type ChannelIdMint,
  type IdMint,
  type RecoveryToken,
  type SecretMint,
  type SessionId,
  type SessionToken,
} from '@crowdship/identity';
import { orThrow } from '@crowdship/node-std';

/** 256 bits — well past any guessing or birthday-collision concern for a bearer secret. */
const TOKEN_BYTES = 32;

/**
 * Ids need only be unique; a v4 UUID from the platform CSPRNG is more than enough.
 * One adapter satisfies both id-minting ports — the auth {@link IdMint} and the
 * {@link ChannelIdMint} — while the ports stay separate so each service depends on
 * exactly the minting it uses [LAW:decomposition].
 */
export class CryptoIdMint implements IdMint, ChannelIdMint {
  newAccountId(): AccountId {
    return orThrow(accountId(randomUUID()), 'account id from randomUUID');
  }
  newSessionId(): SessionId {
    return orThrow(sessionId(randomUUID()), 'session id from randomUUID');
  }
  newChannelId(): ChannelId {
    return orThrow(channelId(randomUUID()), 'channel id from randomUUID');
  }
}

/**
 * Bearer secrets drawn from the CSPRNG — this is the concrete reason {@link SecretMint}
 * is a separate seam from id minting: a token MUST be unguessable, and that
 * requirement is met HERE, at the boundary, not assumed by the domain.
 */
export class CryptoSecretMint implements SecretMint {
  newSessionToken(): SessionToken {
    return orThrow(sessionToken(randomBytes(TOKEN_BYTES).toString('base64url')), 'session token');
  }
  newRecoveryToken(): RecoveryToken {
    return orThrow(recoveryToken(randomBytes(TOKEN_BYTES).toString('base64url')), 'recovery token');
  }
}
