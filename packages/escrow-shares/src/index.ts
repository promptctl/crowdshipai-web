/**
 * Escrow shares — the contributor ledger of an escrow and how an amount distributes back
 * over it. The one concept BOTH settlement directions return coins along
 * [LAW:one-source-of-truth]: the refund engine returns the whole escrow (each backer their
 * exact net), and the release engine returns the overshoot beyond a pool's target (each
 * backer their pro-rata slice of the excess). It sits below the services on purpose: a
 * distribution shared by two engines cannot live in either of them without making a
 * service depend on a service [LAW:one-way-deps].
 */
export { netContributions, owedToBackers, proRataShares, returnLegs } from './shares.js';
