import { err, ok } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { orThrow, reqBytes, reqInt, reqStr } from '../src/index.js';

describe('reqStr', () => {
  it('returns a string column unchanged', () => {
    expect(reqStr({ name: 'crowdship' }, 'name')).toBe('crowdship');
  });

  it('halts loudly, naming the column, when the value is not a string', () => {
    expect(() => reqStr({ name: 42 }, 'name')).toThrow(/column name is not a string/);
  });

  it('halts on a missing column rather than returning undefined', () => {
    expect(() => reqStr({}, 'name')).toThrow(/column name is not a string/);
  });
});

describe('reqInt', () => {
  it('returns a safe-integer column unchanged', () => {
    expect(reqInt({ at: 1024 }, 'at')).toBe(1024);
  });

  it('halts on a bigint — SQLite can hand back bigints, and they are not safe integers here', () => {
    expect(() => reqInt({ at: 10n }, 'at')).toThrow(/column at is not a safe integer/);
  });

  it('halts on a non-integer number', () => {
    expect(() => reqInt({ at: 1.5 }, 'at')).toThrow(/column at is not a safe integer/);
  });
});

describe('reqBytes', () => {
  it('returns a Buffer view of the stored bytes', () => {
    expect(reqBytes({ salt: new Uint8Array([1, 2, 3]) }, 'salt')).toEqual(Buffer.from([1, 2, 3]));
  });

  it('halts when the column is not byte data', () => {
    expect(() => reqBytes({ salt: 'not-bytes' }, 'salt')).toThrow(/column salt is not bytes/);
  });
});

describe('orThrow', () => {
  it('returns the value of an ok result', () => {
    expect(orThrow(ok(7), 'count')).toBe(7);
  });

  it('throws with the context and the error when the result is err', () => {
    expect(() => orThrow(err('blank'), 'channel handle')).toThrow(/channel handle: "blank"/);
  });

  it('renders a bigint NESTED in the error payload instead of throwing on it', () => {
    // coinAmount returns err({ kind: 'not-positive', value: bigint }); a raw
    // JSON.stringify would throw "cannot serialize a BigInt" and bury the real failure.
    expect(() => orThrow(err({ kind: 'not-positive', value: 5n }), 'recorded amount')).toThrow(
      /recorded amount: .*"5n"/,
    );
  });
});
