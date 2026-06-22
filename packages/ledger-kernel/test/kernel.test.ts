import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  mayGoNegative,
  timestamp,
  transactionId,
  transactionReason,
  transfer,
  type AccountKind,
} from '../src/index.js';

// The kernel's whole job is to make illegal money values unrepresentable by
// rejecting them at construction — loudly, as a `Result`, never a silent coercion
// [LAW:no-silent-failure]. These assert the rejection branches (the value types'
// reason for existing), which are otherwise exercised only through the ledger's
// happy paths.

describe('coinAmount admits only whole positive counts', () => {
  test('a positive amount is accepted and carries its exact value', () => {
    const a = coinAmount(500n);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value).toBe(500n);
  });

  test('zero and negative amounts are refused', () => {
    expect(coinAmount(0n)).toEqual({ ok: false, error: { kind: 'not-positive', value: 0n } });
    expect(coinAmount(-5n)).toEqual({ ok: false, error: { kind: 'not-positive', value: -5n } });
  });
});

describe('ids reject the blank and preserve the exact string', () => {
  const constructors = [
    ['accountId', accountId],
    ['transactionId', transactionId],
    ['idempotencyKey', idempotencyKey],
    ['transactionReason', transactionReason],
  ] as const;

  for (const [label, make] of constructors) {
    test(`${label} rejects empty and whitespace-only, accepts a real value verbatim`, () => {
      expect(make('')).toEqual({ ok: false, error: { kind: 'blank', label } });
      expect(make('   ')).toEqual({ ok: false, error: { kind: 'blank', label } });

      const r = make('  keep me  ');
      expect(r.ok).toBe(true);
      // No trimming: an id is an exact, opaque key — silently reshaping it would
      // change a load-bearing value.
      if (r.ok) expect(r.value).toBe('  keep me  ');
    });
  }
});

describe('transfer forbids a self-transfer', () => {
  const a = accountId('a');
  const b = accountId('b');
  const amount = coinAmount(10n);

  test('distinct accounts produce a transfer; same account is refused', () => {
    if (!a.ok || !b.ok || !amount.ok) throw new Error('fixture construction failed');
    const ok = transfer(a.value, b.value, amount.value);
    expect(ok.ok).toBe(true);

    const self = transfer(a.value, a.value, amount.value);
    expect(self).toEqual({ ok: false, error: { kind: 'same-account', account: a.value } });
  });
});

describe('timestamp admits only safe non-negative integers', () => {
  test('a present epoch-ms is accepted', () => {
    const t = timestamp(1_700_000_000_000);
    expect(t.ok).toBe(true);
  });

  test('fractions, NaN, Infinity, magnitudes past 2^53, and negatives are refused', () => {
    expect(timestamp(1.5).ok).toBe(false);
    expect(timestamp(Number.NaN).ok).toBe(false);
    expect(timestamp(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(timestamp(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(timestamp(-1)).toEqual({ ok: false, error: { kind: 'negative', value: -1 } });
  });
});

describe('mayGoNegative names exactly the mint', () => {
  test('only the mint may carry a negative balance', () => {
    expect(mayGoNegative('mint')).toBe(true);
    const bounded: readonly AccountKind[] = ['user-wallet', 'escrow', 'platform-revenue'];
    for (const kind of bounded) expect(mayGoNegative(kind)).toBe(false);
  });
});
