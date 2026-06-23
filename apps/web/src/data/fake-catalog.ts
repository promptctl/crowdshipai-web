import {
  contentDescriptor,
  GENERAL_AUDIENCE,
  maturityRating,
  type ContentDescriptor,
  type MaturityLevel,
  type MaturityRating,
} from '@crowdship/moderation';
import {
  authorMenu,
  DEFAULT_MENU_POLICY,
  findOffer,
  offerId,
  type Menu,
  type OfferDraft,
} from '@crowdship/menu';
import { show } from '@crowdship/std';

import type {
  ChannelSlug,
  ChannelView,
  CrowdCatalog,
  PricedOffer,
  StreamSummary,
} from './types';

/**
 * Build a seed rating from a level and bare descriptor strings, unwrapping the
 * branded-label constructors loudly: a blank descriptor in hand-written seed data
 * is a programmer error to surface at boot, never a silently dropped label
 * [LAW:no-silent-failure]. Throwaway, like the rest of this fake.
 */
const rating = (level: MaturityLevel, ...descriptors: readonly string[]): MaturityRating =>
  maturityRating(
    level,
    descriptors.map((raw): ContentDescriptor => {
      const d = contentDescriptor(raw);
      if (!d.ok) throw new Error(`seed: invalid content descriptor ${show(raw)}`);
      return d.value;
    }),
  );

/**
 * Author the authoritative domain {@link Menu} for a builder from the SAME seed
 * offers the display projection is built from, so the price a backer sees and the
 * price the ledger charges come from one source and cannot drift
 * [LAW:one-source-of-truth]. The display view-model carries the builder's `label`
 * and human `summary`; the domain offer carries the branded price the purchase
 * pipeline charges and the effect, with the summary preserved as the effect's
 * open params. Authoring is the menu's own trust boundary; a fault in hand-written
 * seed data is a programmer error to surface at boot, never a silently dropped
 * offer [LAW:no-silent-failure].
 */
const domainMenu = (offers: readonly PricedOffer[]): Menu => {
  const drafts: readonly OfferDraft[] = offers.map((o) => ({
    id: o.id,
    price: BigInt(o.priceCoins),
    effect: { kind: o.effect.kind, params: o.effect.summary },
  }));
  const authored = authorMenu(drafts, DEFAULT_MENU_POLICY);
  if (!authored.ok) throw new Error(`seed: invalid menu: ${show(authored.error)}`);
  return authored.value;
};

/**
 * An in-memory CrowdCatalog with hand-seeded builders. This is throwaway: it
 * exists only so the product is visible and steerable before the real stream,
 * identity, and menu services exist. When they arrive, a new implementation of
 * CrowdCatalog replaces this file and the UI is untouched [LAW:locality-or-seam].
 *
 * The seed data is intentionally varied — different topics, viewer counts, and
 * wildly different builder menus — so the grid and watch surface are exercised
 * against real-feeling diversity, and so the menu's open-effect substrate is
 * visibly NOT a fixed list of shoutout/vote/fund.
 */

interface SeedBuilder {
  readonly slug: ChannelSlug;
  readonly builderName: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly viewerCount: number;
  readonly isLive: boolean;
  readonly accentHue: number;
  readonly bio: string;
  readonly maturity: MaturityRating;
  readonly menu: readonly PricedOffer[];
  readonly chat: ChannelView['chat'];
}

const SEED: readonly SeedBuilder[] = [
  {
    slug: 'ffmpeg-witch',
    builderName: 'mara',
    title: 'adding a real-time vignette filter to ffmpeg, live',
    tags: ['ffmpeg', 'C', 'video', 'open-source'],
    viewerCount: 1243,
    isLive: true,
    accentHue: 28,
    bio: 'systems gremlin. i make video pipelines do things they should not. building in public so you can heckle.',
    maturity: GENERAL_AUDIENCE,
    menu: [
      { id: 'o1', label: 'Shoutout', priceCoins: 50, effect: { kind: 'shoutout', summary: 'I read your name out loud, on stream.' } },
      { id: 'o2', label: 'Vote: what filter next?', priceCoins: 200, effect: { kind: 'poll-vote', summary: 'Your coins push the next filter up the queue.' } },
      { id: 'o3', label: 'Fund the SIMD rewrite', priceCoins: 1000, effect: { kind: 'bounty-pool', summary: 'Pool toward shipping the SIMD path. When it hits 20k, I build it now.' } },
      { id: 'o4', label: 'Replace my goal with a random one', priceCoins: 666, effect: { kind: 'chaos', summary: 'I spin the wheel and my next hour is whatever it lands on. God help me.' } },
    ],
    chat: [
      { id: 'c1', author: 'pixelpilot', text: 'the vignette is so clean wtf' },
      { id: 'c2', author: 'nlogn', text: 'is this branchless yet' },
      { id: 'c3', author: 'mara', text: 'almost. one cmov away from glory' },
      { id: 'c4', author: 'system', text: '', firedOfferLabel: 'Shoutout' },
    ],
  },
  {
    slug: 'rustlang-raccoon',
    builderName: 'dex',
    title: 'writing a toy borrow-checker from scratch — type theory hour',
    tags: ['rust', 'compilers', 'type-theory'],
    viewerCount: 612,
    isLive: true,
    accentHue: 200,
    bio: 'compiler nerd. today we make the borrow checker that haunts your dreams. gentle, i promise.',
    maturity: GENERAL_AUDIENCE,
    menu: [
      { id: 'o1', label: 'Name a lifetime', priceCoins: 75, effect: { kind: 'name-thing', summary: "You name a lifetime in the code. It's immortalized in git blame." } },
      { id: 'o2', label: 'Make me explain it slower', priceCoins: 120, effect: { kind: 'pacing', summary: 'I back up and explain the last concept like you are five.' } },
      { id: 'o3', label: 'Fund: ship it to crates.io', priceCoins: 1500, effect: { kind: 'bounty-pool', summary: 'Pool to publish this as a real crate with docs.' } },
    ],
    chat: [
      { id: 'c1', author: 'monomorph', text: 'borrow checker fear is generational trauma' },
      { id: 'c2', author: 'dex', text: 'we heal it together today' },
    ],
  },
  {
    slug: 'gamejam-goblin',
    builderName: 'pip',
    title: 'building a roguelike in 48h — procedural dungeon day',
    tags: ['gamedev', 'godot', 'roguelike'],
    viewerCount: 2890,
    isLive: true,
    accentHue: 320,
    bio: 'i make small weird games fast. mature content sometimes — age-gated, behave.',
    // The one mature builder in the seed — the age gate has something real to act on.
    maturity: rating('mature', 'violence'),
    menu: [
      { id: 'o1', label: 'Spawn a cursed item', priceCoins: 300, effect: { kind: 'game-inject', summary: 'I add an item you describe to the loot table. Within reason.' } },
      { id: 'o2', label: 'Name the final boss', priceCoins: 800, effect: { kind: 'name-thing', summary: 'The boss is named whatever you say. Live.' } },
      { id: 'o3', label: 'Shoutout', priceCoins: 40, effect: { kind: 'shoutout', summary: 'Your name, on stream, with a goblin noise.' } },
    ],
    chat: [
      { id: 'c1', author: 'dungeonmom', text: 'name the boss "Steve" do it' },
      { id: 'c2', author: 'pip', text: 'absolutely not. ok yes.' },
    ],
  },
  {
    slug: 'data-druid',
    builderName: 'sol',
    title: 'live-debugging a gnarly prod incident (sanitized) — observability',
    tags: ['sre', 'observability', 'postmortem'],
    viewerCount: 487,
    isLive: true,
    accentHue: 140,
    bio: 'i fix things on fire calmly. the resume is the stream. recruiters welcome.',
    maturity: GENERAL_AUDIENCE,
    menu: [
      { id: 'o1', label: 'Buy me a coffee (visible)', priceCoins: 100, effect: { kind: 'tip', summary: 'A coffee appears on my desk overlay. Thank you.' } },
      { id: 'o2', label: 'Ask a question, jump the queue', priceCoins: 250, effect: { kind: 'priority-qa', summary: 'Your question goes to the top. I answer it on air.' } },
    ],
    chat: [{ id: 'c1', author: 'oncall-andy', text: 'this is calmer than my actual on-call' }],
  },
  {
    slug: 'offline-owl',
    builderName: 'wren',
    title: 'static-site generator in Zig — currently away, back at 8pm',
    tags: ['zig', 'tooling', 'static-site'],
    viewerCount: 0,
    isLive: false,
    accentHue: 50,
    bio: 'minimal tools, sharp edges. back tonight.',
    maturity: GENERAL_AUDIENCE,
    menu: [
      { id: 'o1', label: 'Shoutout when I return', priceCoins: 50, effect: { kind: 'shoutout', summary: 'First thing when I go live: your name.' } },
    ],
    chat: [],
  },
];

const toSummary = (b: SeedBuilder): StreamSummary => ({
  slug: b.slug,
  builderName: b.builderName,
  title: b.title,
  tags: b.tags,
  viewerCount: b.viewerCount,
  isLive: b.isLive,
  accentHue: b.accentHue,
  maturity: b.maturity,
});

const bySlug = new Map(SEED.map((b) => [b.slug, b]));

// The authoritative domain menus, authored once from the seed and indexed by slug —
// the purchase lookup's single source, derived from the same offers the display is.
const menuBySlug = new Map(SEED.map((b) => [b.slug, domainMenu(b.menu)]));

/**
 * Construct the in-memory catalog. Returns the CrowdCatalog interface, never the
 * concrete type — callers depend on the seam, not the fake.
 */
export const createFakeCatalog = (): CrowdCatalog => ({
  liveStreams: () =>
    // Live first, then by audience — the browse grid leads with what's happening now.
    Promise.resolve(
      [...SEED]
        .sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.viewerCount - a.viewerCount)
        .map(toSummary),
    ),

  channel: (slug) => {
    const b = bySlug.get(slug);
    if (b === undefined) return Promise.resolve(null);
    return Promise.resolve({
      stream: toSummary(b),
      bio: b.bio,
      menu: b.menu,
      chat: b.chat,
    });
  },

  purchasable: (slug, rawOfferId) => {
    const menu = menuBySlug.get(slug);
    if (menu === undefined) return Promise.resolve(null);
    // A blank offer id is genuine optionality from untrusted input (a hand-built
    // request), so it resolves to "no such offer", never a thrown guard
    // [LAW:no-defensive-null-guards]. A valid id resolves to the one offer it names
    // or nothing — findOffer's unique-by-construction contract.
    const id = offerId(rawOfferId);
    if (!id.ok) return Promise.resolve(null);
    return Promise.resolve(findOffer(menu, id.value) ?? null);
  },
});
