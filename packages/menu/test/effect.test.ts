import type { Brand } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { effectKind, type EffectKind } from '../src/index.js';

// A type-level theorem, checked by `tsc` rather than at runtime: `EffectKind` is the
// brand of an ARBITRARY string, never a closed union of named kinds. The brand of a
// generic string is assignable to it today; the day anyone narrows it to enumerate
// allowed kinds, that assignability fails and this stops compiling. The anti-catalog
// rule the founding document demands, expressed as a type instead of trusted to prose
// [LAW:types-are-the-program]. This is the compile-time half of the extensibility guard
// whose runtime half lives in the purchase service's end-to-end suite.
type Assert<T extends true> = T;
type _EffectKindStaysOpen = Assert<Brand<string, 'EffectKind'> extends EffectKind ? true : false>;

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
