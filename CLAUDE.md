# CrowdShip — Founding Document

*Read this before you build anything. This is guidance, not a spec. It exists so
that anyone — human or agent — who opens this repo builds the **right thing in the
right spirit.** When a detail here conflicts with the spirit, the spirit wins.*

---

## What CrowdShip is

CrowdShip is a live-streaming platform with exactly one kind of show:
**someone building software, live, on camera.** A builder sits down, opens their
editor, and vibe-codes in front of an audience. The audience can pay — in coins —
to make things happen: a shoutout, a vote on what gets built next, or real money
pooled to ship an actual feature while everyone watches it happen.

**The atomic primitive is a video stream with someone building in front of it.**
Everything in this document orbits that one thing. If a feature doesn't make the
stream better — better to watch, better to build on, better to fund — it does not
belong in v1.

We are not Twitch. Twitch carries DJs, Starcraft, hot tubs, and everything else,
and pays for it in bloat and no point of view. CrowdShip does one thing: it is
**for building software.** The focus is the product.

And we don't say "influencers." We say **builders.** Fuck influencers. We build.

---

## The three-sided idea

1. **Builders** show up to build — for fun, for an audience, for income, to show off.
2. **Backers** (the audience) fund what they want: support a builder they like,
   vote a feature up, or pool money to get something they actually need built.
3. **Recruiters** troll the streams for talent. The stream *is* the résumé — you
   get to watch someone think.

We take a small cut of the coins moving through the middle. Everyone gets
something; we siphon a little. That's the business.

The big bet: this becomes a new form of **micro-contracting.** You want a feature
added to ffmpeg. You have $20. Ten other people want it and have $20 each. A
builder takes the pool and ships it live while you watch. That work has never had
a home. This is the home.

---

## Coins

Coins are the unit of value. A coin is roughly a cent — a stand-in for money. The
exact rate is a knob, not a principle.

**We own the coin ledger, absolutely, and it is the one sacred thing in this
system.** Every coin that exists came from somewhere and is accounted for. No coin
is ever created, destroyed, or moved silently. The ledger is the single source of
truth for value: auditable, double-entry, boring, bulletproof. If anything in this
codebase earns paranoia, it is this. Money bugs are not "bugs" — they are the end
of the company. Failures around money are **loud**, never swallowed.

The price a backer pays for a coin and the value a builder cashes one out for do
not have to be the same number. **The spread is the business model.** One ledger;
the buy and sell rates are policy.

---

## The menu belongs to the builder

This is the most important principle in the document and the easiest to get wrong:

**We do not decide what builders sell. We give them the power to sell anything,
then we get out of the way.**

A builder wires up their own menu. *"Shoutout: 50." "I'll add a comment with your
name: 100." "Vote for a feature: 200." "Replace my current goal with a random one:
1000." "Fund this feature and I build it now."* Those are **illustrations, not a
list of supported types.** The right mental model is a creator wiring up their own
overlay and payment page — **not** a form with our dropdown of allowed actions.

Do **not** build "a shoutout system" and "a voting system" and "a bounty system."
That road ends in the bloat we're escaping, and worse, it ends with *us* deciding
what's allowed. Build the smallest substrate that lets a builder define a priced
thing and have it fire, and let the builders' creativity be the product. The
variety comes from **them**, not from our roadmap.

What we own: the coins, the settlement of obligations, the payouts, our cut, and
the rules of conduct. **The rail, not the shop.**

---

## Crypto and self-settling obligations

This is a core pillar, not a footnote. It is also the part most likely to be the
thing people love and talk about.

The single most powerful structural idea here: **obligations that pay themselves
out.** A backer's pledge sits in escrow; the instant its condition is met — the
deliverable is accepted, the pool hits its target, the goal resolves — it releases
to the builder, our cut is skimmed, and everyone watching can see it happen. No
human in the loop. No platform sitting on the money asking to be trusted.

For "I paid to get a feature built," trustless, automatic, transparent settlement
is genuinely **better** than us acting as a manual escrow agent. And a coin people
can actually hold and trade is its own flywheel.

The tradeoffs are not optional reading:
- A freely traded coin invites securities and money-transmitter scrutiny.
- Volatility fights the "a coin is a cent" experience.
- On-chain UX repels normal users.
- Custody is a liability.

The shape that usually survives contact with reality: **a stable, friendly
internal coin for the experience, with a programmable settlement rail
underneath** — obligations encoded as contracts, denominated stably.

**The one decision that forks the architecture:** are obligations enforced
*trustlessly* (smart contract) or *custodially* (our ledger)? Current lean: design
the ledger so it can settle **either** way; launch **custodial** because it ships
faster; make on-chain auto-settlement the **headline feature** the moment it's
real — never the thing that blocks launch.

---

## What we own vs. what we never touch

**Own (defend these):**
- The coin ledger and every coin movement.
- Settlement of obligations and payouts (and our cut).
- Conduct and content policy, enforced at one boundary.
- Identity, trust, and the integrity of the stream itself.

**Never touch:**
- What a builder sells, or what they charge.
- How a builder themes their channel, runs goals, or talks to their audience.
- The creative shape of anyone's stream.

When unsure which side something is on, ask: *does this protect the money and the
trust, or does it constrain the builder?* Protect the first. Never do the second.

---

## Content policy

Funny, goofy, professional. **Not a cam site.** The only thing we took from that
world is the idea that an entertainer can wire up whatever support system they
want. Nothing else.

- **No sexual content, nudity, or pornography involving people.** Hard line.
- But the *software being built* will go NSFW — mature or violent games, gambling,
  edgy content. That is expected and allowed within reason. It requires
  **maturity rating, age-gating, and a moderation pipeline**, enforced at the
  single policy boundary, **designed in from the start** — not bolted on after the
  first incident.

---

## Principles for whoever builds this

- **The stream is the product.** Everything serves the stream.
- **We build.** (Not "we influence.") The tone is funny and a little goofy; the
  engineering and the money are dead serious.
- **Protect the builder's openness at all costs.** The moment you're tempted to add
  a dropdown of allowed actions, stop and reread the menu section.
- **The ledger is sacred.** Money never moves silently, failures are loud, nothing
  is ever swallowed.
- **Don't pre-build the empire.** Smallest substrate that lets the real thing
  happen. Variety comes from builders; value comes from the stream.

---

## Open decisions (not yet made)

- Custodial vs. on-chain settlement for v1 (lean: custodial now, on-chain headline
  later).
- Whether the coin is ever externally tradable, and the regulatory posture that
  implies.
- The buy/sell spread and exactly how the cut is taken.
- KYC, payout, and tax mechanics for builders cashing out.
- **tinkerpad.ai's role** — likely the in-browser workspace the building actually
  happens in (i.e., what the stream is pointed at). Pending the founder's brief.

---

## Non-goals

- Not Twitch-for-everything. One show: building software.
- Not a cam platform.
- Not a rigid bounty board with our categories. The builder's menu is theirs.
- Not a coin that exists to pump. The coin exists to move value through the stream.

---

## Status

Founding stage. No product code yet. This document is the source of truth for
*intent*; build toward it, and update it when intent changes — never let it drift
from what we're actually building.
