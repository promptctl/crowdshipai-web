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

/** One line in the live chat. */
export interface ChatMessage {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  /** Present when this line is a fired offer rather than typed text — so a fired
   * effect and an ordinary message stay one type, not two parallel systems. */
  readonly firedOfferLabel?: string;
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
  /** Every stream currently worth showing on the browse grid. */
  liveStreams(): Promise<readonly StreamSummary[]>;
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
