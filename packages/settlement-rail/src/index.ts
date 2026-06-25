/**
 * The settlement rail — the one seam a self-paying obligation settles through, so "custodial
 * now, on-chain later" is a choice of instance, not a rewrite. It is shared settlement
 * infrastructure, not the property of any one engine: the auto-release engine settles a
 * pledge forward to the builder through it, and the refund engine settles a pledge back to
 * its backers through it, each under its own {@link SettlementPurpose} so their movements
 * never collide [LAW:one-way-deps]. Both engines name this seam and nothing under it, so a
 * trustless on-chain rail lands behind the same interface with zero change to either spine.
 */
export type { SettlementRail, SettleRequest, SettlementPurpose } from './rail.js';
export { createCustodialRail } from './rail.js';
