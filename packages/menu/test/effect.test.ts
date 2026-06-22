import { describe, expect, it } from 'vitest';

import { effectKind } from '../src/index.js';

describe('effectKind', () => {
  it('accepts any non-blank builder label — the platform enumerates nothing', () => {
    // A label the platform has never heard of must still be a valid kind; that
    // openness is the whole point of the substrate.
    for (const label of ['shoutout', 'fund-feature', 'summon-a-dragon', '🚀-boost', 'x']) {
      const k = effectKind(label);
      expect(k.ok && k.value).toBe(label);
    }
  });

  it('takes the label verbatim, with no normalization', () => {
    const k = effectKind('  Mixed Case  ');
    expect(k.ok && k.value).toBe('  Mixed Case  ');
  });

  it('rejects a blank kind — empty or whitespace-only — and names the field', () => {
    expect(effectKind('')).toEqual({ ok: false, error: { kind: 'blank', label: 'effectKind' } });
    expect(effectKind('\t \n')).toEqual({ ok: false, error: { kind: 'blank', label: 'effectKind' } });
  });
});
