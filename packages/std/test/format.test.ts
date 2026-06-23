import { describe, expect, it } from 'vitest';

import { coinAmount, show } from '../src/index.js';

describe('show', () => {
  it('renders a string with its JSON quoting', () => {
    expect(show('crowdship')).toBe('"crowdship"');
  });

  it('renders a safe-integer number plainly', () => {
    expect(show(1024)).toBe('1024');
  });

  it('renders a top-level bigint as <n>n instead of throwing', () => {
    expect(show(10n)).toBe('10n');
  });

  it('renders a bigint NESTED in an object at any depth', () => {
    expect(show({ outer: { value: 5n } })).toBe('{"outer":{"value":"5n"}}');
  });

  it('renders undefined (which JSON.stringify drops to undefined) as a string', () => {
    expect(show(undefined)).toBe('undefined');
  });

  it('renders the real failure of a coinAmount error payload — the live bigint hazard', () => {
    // coinAmount rejects a non-positive amount with an error carrying the offending
    // bigint; a raw JSON.stringify of that payload would throw on the bigint.
    const r = coinAmount(-1n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(show(r.error)).toMatch(/-1n/);
  });
});
