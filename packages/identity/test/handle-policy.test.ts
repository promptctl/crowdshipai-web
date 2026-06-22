import { describe, expect, test } from 'vitest';

import type { Result } from '@crowdship/std';
import {
  DEFAULT_HANDLE_POLICY,
  StandardHandlePolicy,
  handle,
  type Handle,
  type HandleReservation,
} from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const aHandle = (s: string): Handle => must(handle(s));

/**
 * The accept/reject table written out, on purpose, so the policy's exact shape is
 * the contract — not "did the happy case pass" but "does it reject the
 * impersonation shapes AND leave ordinary words alone". The two are one decision:
 * a too-broad rule (substring matching) would eat `adminion`; a too-narrow one
 * (exact only) would miss `the_admin`.
 */
describe('the default handle policy: what it reserves and what it leaves alone', () => {
  test.each<[string, HandleReservation]>([
    // Exact authority terms.
    ['admin', { kind: 'reserved-word', word: 'admin' }],
    ['support', { kind: 'reserved-word', word: 'support' }],
    ['official', { kind: 'reserved-word', word: 'official' }],
    ['staff', { kind: 'reserved-word', word: 'staff' }],
    ['api', { kind: 'reserved-word', word: 'api' }],
    // An authority term as a whole token of a longer handle.
    ['the_admin', { kind: 'reserved-word', word: 'admin' }],
    ['admin_stuff', { kind: 'reserved-word', word: 'admin' }],
    ['api_gateway', { kind: 'reserved-word', word: 'api' }],
    // Leetspeak imitations fold back to the authority term. A handle must begin
    // with a letter, so leet substitution of the FIRST letter is unconstructable
    // — the fold catches the digits reachable in the rest of the handle.
    ['adm1n', { kind: 'reserved-word', word: 'admin' }],
    ['offic1al', { kind: 'reserved-word', word: 'official' }],
    ['r00t', { kind: 'reserved-word', word: 'root' }],
  ])('reserves %j as an authority term', (raw, expected) => {
    expect(DEFAULT_HANDLE_POLICY.reservationOf(aHandle(raw))).toEqual(expected);
  });

  test.each<[string, HandleReservation]>([
    ['crowdship', { kind: 'brand-impersonation', brand: 'crowdship' }],
    ['mycrowdship', { kind: 'brand-impersonation', brand: 'crowdship' }],
    ['crowdship_help', { kind: 'brand-impersonation', brand: 'crowdship' }],
    // Brand match wins over the reserved token it also contains.
    ['crowdship_official', { kind: 'brand-impersonation', brand: 'crowdship' }],
    // Leetspeak imitation of the brand folds back too.
    ['cr0wdsh1p', { kind: 'brand-impersonation', brand: 'crowdship' }],
    // Underscores cannot smuggle the brand past containment — they are collapsed
    // before the brand check, so a separator-spelled brand is still caught.
    ['crow_dship', { kind: 'brand-impersonation', brand: 'crowdship' }],
    ['c_r_o_w_d_s_h_i_p', { kind: 'brand-impersonation', brand: 'crowdship' }],
  ])('reserves %j as brand impersonation', (raw, expected) => {
    expect(DEFAULT_HANDLE_POLICY.reservationOf(aHandle(raw))).toEqual(expected);
  });

  test.each([
    'brandon',
    'jane_builder',
    'code_wizard',
    'ffmpeg_dev',
    // Contains an authority term as a substring but NOT as a token — left alone.
    'adminion',
    'administrate',
    'helper', // 'help' is reserved; 'helper' is not the same token.
    'teamwork', // 'team' is reserved; 'teamwork' is not.
    'rapid', // contains the substring 'api' but the token is 'rapid'.
  ])('leaves the ordinary handle %j claimable', (raw) => {
    expect(DEFAULT_HANDLE_POLICY.reservationOf(aHandle(raw))).toBeUndefined();
  });
});

/**
 * The reserved set is a *value* the seam exists to swap, not a baked-in rule. A
 * policy built from a different config reserves different handles — proving the
 * channel service depends on the port, not on the default set.
 */
describe('the policy is a swappable value', () => {
  const tiny = new StandardHandlePolicy({ reservedWords: ['foo'], brandTerms: ['acme'] });

  test('a custom reserved word is enforced, a default one is not', () => {
    expect(tiny.reservationOf(aHandle('foo'))).toEqual({ kind: 'reserved-word', word: 'foo' });
    // 'admin' is reserved by the default policy but NOT by this custom one.
    expect(tiny.reservationOf(aHandle('admin'))).toBeUndefined();
  });

  test('a custom brand term is matched by containment', () => {
    expect(tiny.reservationOf(aHandle('myacme'))).toEqual({
      kind: 'brand-impersonation',
      brand: 'acme',
    });
    expect(tiny.reservationOf(aHandle('crowdship'))).toBeUndefined();
  });
});
