/**
 * Pooled obligations — the micro-contracting bet made concrete: many backers fund one shared
 * escrow toward one target, and the instant the target is reached the WHOLE pool ships to one
 * builder, the platform's cut skimmed, in view of the stream. "Ten people with twenty dollars
 * each pool into one target a builder ships on camera. Work that never had a home; this is the
 * home."
 *
 * This service owns only the FUNDING side and the pool's identity. The release — observing the
 * target and draining the escrow to the builder — is the auto-release engine's job, a sibling
 * service this one never depends on [LAW:one-way-deps]. The bridge between them is structural:
 * `asEscrowedPledge` projects a `Pool` into the `Escrowed<PoolTerms>` the engine settles,
 * `PoolTerms` being exactly the engine's obligation shape with the pool's identity along for
 * the ride. The pooled total is one thing — the escrow's ledger balance — observed by funding
 * here and by the engine there, never duplicated [LAW:one-source-of-truth]. The product surface
 * composes the two: fund until `reached`, then release.
 */
export type { Pool, PoolId, PoolTerms } from './pool.js';
export { asEscrowedPledge, poolId } from './pool.js';

export type { Contribution, ContributionOutcome, PoolFunder } from './funding.js';
export { createPoolFunder, openPool } from './funding.js';
