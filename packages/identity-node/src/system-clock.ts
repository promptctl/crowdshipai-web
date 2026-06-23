import type { Clock, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import { orThrow } from '@crowdship/node-std';

/**
 * The real wall clock — the one place "now" actually touches the outside
 * [LAW:effects-at-boundaries]. The domain never reaches for `Date.now()`; it
 * receives this capability, and tests pass a fake instead.
 */
export class SystemClock implements Clock {
  now(): Timestamp {
    return orThrow(timestamp(Date.now()), 'Date.now() out of safe-integer range');
  }
}
