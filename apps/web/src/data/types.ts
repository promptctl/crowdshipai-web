import type { MaturityRating } from '@crowdship/moderation';
import type { PricedOffer as DomainOffer } from '@crowdship/menu';

/**
 * View-model types for the watch experience, and the single read seam the UI
 * depends on. These are *view models*, not domain truth — the authoritative
 * types live in the ledger/stream/identity services. The UI maps service data
 * into these shapes at the seam, so the pages never import a concrete source
 * [LAW:locality-or-seam] [LAW:one-way-deps].
 *
 * They are deliberately permissive: readonly records with room to grow, so a new
 * idea is a new field, not a rewrite [LAW:carrying-cost]. The thing that must
 * stay stable is the `CrowdCatalog` interface below; everything else is cheap to
 * reshape.
 *
 * The one domain type a view model carries by value is moderation's
 * {@link MaturityRating} (o97.2): content policy is squarely the platform's side
 * of the founding line, so the rating's vocabulary is platform-owned and shared
 * verbatim rather than re-spelled as a looser view shape that could drift from the
 * gate that reads it [LAW:one-source-of-truth]. It is plain data, not a service
 * handle, so carrying it keeps the seam a value boundary, not a dependency on a
 * concrete source.
 */

/** A channel's URL handle. Plain string at the view layer — the real id is branded upstream. */
export type ChannelSlug = string;

/** A card in the browse grid: enough to decide "do I want to watch this build?" */
export interface StreamSummary {
  readonly slug: ChannelSlug;
  readonly builderName: string;
  /** What they're building right now, in their words. */
  readonly title: string;
  /** Open labels the builder tagged the stream with — never a closed enum we own. */
  readonly tags: readonly string[];
  readonly viewerCount: number;
  /**
   * Whether the builder is broadcasting right now — DERIVED state the catalog
   * assembles from the stream provider (the LiveKit room is the single authority),
   * synchronized at read, never a stored flag the catalog could let drift from
   * reality [LAW:one-source-of-truth].
   */
  readonly isLive: boolean;
  /** A stable hue (0–360) used to render a placeholder thumbnail until real video exists. */
  readonly accentHue: number;
  /**
   * The builder's declared content rating — the o97.2 vocabulary the age gate
   * (o97.3) reads at the viewer-access boundary. Always present: a stream the
   * builder declared broadly suitable carries `GENERAL_AUDIENCE` (the named
   * baseline), never a missing field a reader must defend against
   * [LAW:no-defensive-null-guards]. "Never declared" is not a state the catalog
   * surfaces — a stream worth showing has a rating.
   */
  readonly maturity: MaturityRating;
}

/**
 * A priced thing a builder offers. The atomic unit of "the menu belongs to the
 * builder": a price plus an effect to fire. We do NOT model shoutout/vote/fund
 * as distinct types — that would be us deciding what's allowed. The variety
 * comes from builders [LAW:one-type-per-behavior].
 */
export interface PricedOffer {
  readonly id: string;
  /** The builder's words for this offer. */
  readonly label: string;
  readonly priceCoins: number;
  readonly effect: OfferEffect;
}

/**
 * What fires when an offer is bought. `kind` is an OPEN label the UI carries but
 * never branches on [LAW:dataflow-not-control-flow] — mirroring the ledger
 * kernel's `TransactionReason`. A new kind of effect is new data from a builder,
 * never a new branch in our code [LAW:no-mode-explosion].
 */
export interface OfferEffect {
  readonly kind: string;
  /** Human text of what this does, shown verbatim in the menu and when it fires. */
  readonly summary: string;
}

/**
 * A funding pool as the watch surface sees it: identity, title, live progress, and settled status.
 * All primitives — no branded types or bigints — so the value crosses the server-action
 * boundary cleanly [LAW:effects-at-boundaries]. The authoritative progress (`pooledCoins`) is
 * the ledger's escrow balance projected to a number, never a client-side running tally
 * [LAW:one-source-of-truth].
 */
export interface PoolView {
  /** The pool's stable identity — the branded `PoolId` serialized as a plain string at
   *  the seam, so the client holds a value it can pass back to the pledge action without
   *  depending on a server-only brand [LAW:one-way-deps]. */
  readonly id: string;
  readonly title: string;
  readonly builderSlug: string;
  readonly targetCoins: number;
  /** The live pooled total — the ledger's escrow balance at read time, re-derived on every
   *  server action that touches this pool, never a stored count this surface increments
   *  [LAW:one-source-of-truth]. */
  readonly pooledCoins: number;
  readonly released: boolean;
}

/**
 * One transparent settlement moment as the watch surface renders it — the view twin of
 * the projection's `SettlementEvent`, all primitives so it crosses the server-action
 * boundary cleanly [LAW:effects-at-boundaries]. The `kind` mirrors the projection's
 * closed discriminator verbatim; the mapping at the seam is an exhaustive match, so a
 * new settlement kind is a compile error there, never a silently unrendered money
 * movement [LAW:no-silent-failure]. Every figure is the ledger's recorded leg projected
 * to a number — the surface renders the money's own story, never a tally it keeps
 * [LAW:one-source-of-truth].
 */
export interface SettlementEventView {
  readonly kind: 'contribution' | 'release' | 'cut' | 'refund';
  /** The public display label of the party on the other side of the leg, decided once at
   *  the server edge (a backer's stable pseudonym — the same one they chat under — the
   *  builder's slug, or the platform's name) [LAW:single-enforcer]. */
  readonly party: string;
  readonly amountCoins: number;
  /** The escrow balance the instant this leg landed — the live ticker figure, read from
   *  the ledger's recorded history. Zero after a release or final refund drains it. */
  readonly pooledAfterCoins: number;
  /** The title of the pool this moment settled against — the caller-side tag that merges
   *  several pools' feeds into one channel timeline. */
  readonly poolTitle: string;
  /** When the engine recorded the leg, epoch milliseconds. */
  readonly atMs: number;
}

/** One line in the live chat. */
export interface ChatMessage {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  /** Present when this line is a fired EFFECT rather than typed text — so a fired
   * effect and an ordinary message stay one type, not two parallel systems
   * [LAW:one-type-per-behavior]. It holds the effect's open KIND (the builder-authored
   * domain label the live channel carries: `shoutout`, `poll-vote`, …), not a
   * view-layer offer label — the broadcast carries domain truth, never frontend prose
   * [LAW:one-way-deps]. The field's name says exactly what it holds, so a future reader
   * wiring a producer or reader off it cannot mistake a kind for a label
   * [FRAMING:representation]. */
  readonly firedEffectKind?: string;
  /** Present when this line is a POOL SETTLEMENT EVENT — the whole pool shipped to the builder.
   *  One message type, multiple line kinds [LAW:one-type-per-behavior]: a settled pool is not
   *  a separate message list but one more shape of the live log, so the chat column renders
   *  the moment settlement happens in view of the stream (e5a.5) [LAW:effects-at-boundaries].
   *  The figures are the ledger's recorded release and cut legs, carried whole on the live
   *  frame that announced the ship — the split shown in plain view, cut included, exactly as
   *  the money moved [LAW:one-source-of-truth]. */
  readonly settledPool?: { readonly title: string; readonly releasedCoins: number; readonly cutCoins: number };
}

/**
 * The full watch context for one channel: the three views the builder owns —
 * their stream, their menu, their identity — composed so a surface fetches a
 * builder's whole context in one read rather than stitching it from three
 * [LAW:decomposition].
 */
export interface ChannelView {
  readonly stream: StreamSummary;
  readonly bio: string;
  readonly menu: readonly PricedOffer[];
  readonly chat: readonly ChatMessage[];
}

/**
 * The single read seam between the UI and the world. Today an in-memory fake
 * implements it; tomorrow real services do, and not one page changes
 * [LAW:single-enforcer for reads]. Async because the real source is async —
 * modeling it sync now would force a rewrite later.
 */
export interface CrowdCatalog {
  /**
   * The full roster of builders worth surfacing — live and offline alike. Sorted
   * live-first as a convenience for the browse grid, but it never filters: an
   * offline builder's channel is still their resume, and the recruiter lens reads
   * the whole roster. Named for what it returns, not the order it returns it in
   * [FRAMING:representation] — a live-only read, if ever wanted, is a separate seam.
   */
  roster(): Promise<readonly StreamSummary[]>;
  /** The full watch context for one channel, or null if no such channel exists. */
  channel(slug: ChannelSlug): Promise<ChannelView | null>;
  /**
   * The authoritative offer a backer chose, by channel and offer id — or null if
   * no such offer exists on that channel. Unlike {@link ChannelView}'s menu, which
   * is a display projection, this returns the domain {@link DomainOffer} the
   * purchase pipeline charges against: a branded `CoinAmount` price and an
   * effect, validated by the menu's own authoring boundary. The buy path needs
   * domain truth, not the view shape, and reads the price from this one source so a
   * backer can never be charged a figure the display and the ledger disagree on
   * [LAW:one-source-of-truth].
   */
  purchasable(slug: ChannelSlug, offerId: string): Promise<DomainOffer | null>;
}
