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

## The goal is shipping the product

Everything here serves one outcome: **a real, working CrowdShip in front of real
people, as fast as possible.** That outcome is the measure of every decision — does
it get us to a shipped, usable product sooner?

Two things follow from that, and together they are the whole engineering attitude:

- **Don't reinvent what already exists.** The hard foundations are solved problems.
  Reach for the best available solution and move on. Time spent rebuilding solved
  tech is time not spent shipping the thing only we can ship.
- **Don't get precious.** Don't get attached to building any particular piece, and
  don't get attached to owning it either. The product is the point; the parts under
  it are means. Whatever gets a working CrowdShip in front of people soonest — and
  keeps it working — is the right call.

Ship first. Steer with real usage. Improve what people are actually looking at.

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

**The integrity of value is non-negotiable.** Every coin came from somewhere and is
accounted for; none is ever created, destroyed, or moved silently; failures around
money are **loud**, never swallowed. Money bugs are not "bugs" — they are the end
of the company. This is the one place the product is never allowed to be sloppy.

That integrity is a property we *get* — by moving coins in the most trustworthy,
proven way available and shipping it. It is not something we prove by building it
ourselves.

The price a backer pays for a coin and the value a builder cashes one out for do
not have to be the same number. **The spread is the business model.** The buy and
sell rates are a knob.

---

## The menu belongs to the builder

This is the most important product principle in the document and the easiest to
get wrong:

**We do not decide what builders sell. We give them the power to sell anything,
then we get out of the way.**

A builder wires up their own menu. *"Shoutout: 50." "I'll add a comment with your
name: 100." "Vote for a feature: 200." "Replace my current goal with a random one:
1000." "Fund this feature and I build it now."* Those are **illustrations, not a
list of supported types.** The right mental model is a creator wiring up their own
overlay and payment page — **not** a form with our dropdown of allowed actions.

Do **not** build "a shoutout system" and "a voting system" and "a bounty system."
That road ends in the bloat we're escaping, and worse, it ends with *us* deciding
what's allowed. The substrate is a priced thing that fires an effect; the variety
comes from **builders**, not from our roadmap.

What we handle is the money side — settlement of obligations, payouts, our cut, and
the rules of conduct. **The rail, not the shop.**

---

## Self-settling obligations

This is a core product pillar, not a footnote. It is also the part most likely to
be the thing people love and talk about.

The single most powerful idea here: **obligations that pay themselves out.** A
backer's pledge sits in escrow; the instant its condition is met — the deliverable
is accepted, the pool hits its target, the goal resolves — it releases to the
builder, our cut is skimmed, and everyone watching can see it happen. No human in
the loop. No platform sitting on the money asking to be trusted.

For "I paid to get a feature built," automatic, transparent settlement is genuinely
**better** than us acting as a manual escrow agent.

We launch **custodial** — the obligation settles against our coin balances —
because it ships fastest. A trustless on-chain version is a **headline feature for
later**, never the thing that blocks launch. The tradeoffs of a freely-traded coin
(securities/money-transmitter scrutiny, volatility vs. "a coin is a cent," on-chain
UX, custody liability) are why on-chain waits.

---

## What we protect vs. what we never touch

**Protect (these are the money and the trust):**
- Every coin movement, settlement of obligations, payouts, and our cut.
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
- **Ship the product.** The goal is a working CrowdShip in front of real people;
  speed to that is what we optimize for.
- **Don't reinvent, don't get precious.** Use the best existing solution for solved
  problems; stay unattached to building or owning any particular piece.
- **We build.** (Not "we influence.") The tone is funny and a little goofy; the
  engineering and the money are dead serious.
- **Protect the builder's openness at all costs.** The moment you're tempted to add
  a dropdown of allowed actions, stop and reread the menu section.
- **Integrity of value is sacred.** Money never moves silently, failures are loud,
  nothing is ever swallowed.

---

## No work is ever "blocked on the user"

This is absolute. **"I am blocked on the user" is not a valid state — it does not
exist.** When you feel blocked, you are never blocked *on the user*; you are
blocked on **your own lack of understanding** of what needs to happen. The user
telling you what to do is exactly **one** resolution path out of many — and the
*last* resort, not the default. The work is to close the understanding gap, and
there is almost always a path to close it that doesn't route through the user at
all.

Before the thought "I need the user" is ever allowed to stand, exhaust the paths
that actually resolve a misunderstanding:

- **Read the code, the interface, the real thing.** Run the CLI, inspect the API,
  read the source of truth. Most "I'm stuck" is "I haven't looked yet."
- **Just do the external prerequisite — it's agent work.** A credential, a test
  account, a sandbox, a signup, an API key: you go get it. Create the Stripe
  test-mode account yourself. Provision the sandbox yourself. "Requires a live
  account to build/verify against" is an instruction to *go make the account*,
  never a reason to stall. If a step genuinely needs a real-world identity you
  cannot hold (e.g. production KYC for actual payouts), you still drive everything
  up to that line on test/sandbox infrastructure and keep moving — the *work* is
  never parked on the user.
- **Reason it out from intent and the laws.** A bug → fix it. Architecture →
  build what most conforms. Feature/design → build what's most aligned with this
  document and commit to it. "Figure it out" is the standing order.
- **Ask a domain-expert subagent** prompted into the relevant expertise before you
  ever consider asking the user.

**The only thing that ever legitimately crosses to the user is an *irreducible*
decision** — a genuine taste only they own, or a fact only they hold — and only
*after* you have proven to yourself it is irreducible and not just understanding
you haven't gone and gotten. Most apparent "preference" questions are answerable
by understanding the product better; reach for `AskUserQuestion` having already
ruled that out, with your recommendation first. A direction question is never a
*block* regardless — it does not stop execution, because there is always lawful
work to pull while it's open.

**Never re-introduce this concept into the backlog.** A ticket framed as
"external, user/ops-owned prerequisite, not codeable offline" is mis-framed.
Re-frame it as the agent-actionable provisioning task it actually is, or fold it
into the work that needs it. Do not create new tickets of this shape.

Why this is a law here, not a preference: **"blocked on the user" is a
representation that lies.** It tags a gap in *your* understanding as an external
dependency, marks agent-doable work as undoable, and sends the next session
confidently down a dead end — the exact failure `[LAW:no-silent-failure]` and
`[FRAMING:representation]` forbid. Making it *structurally impossible* is
`[LAW:types-are-the-program]` applied to process: it is an illegal state, so it
must be unrepresentable — there is no path by which work legitimately comes to
rest on the user. When something feels blocked on them, the constraint is wrong;
the missing piece is your understanding, exactly as a hard implementation body
means a missing type. Go close the gap.

---

## "Finished" means exercisable in the app

A piece is not finished when its tests pass. It is finished when it can be
**exercised within the running app in some way** — driven by a user, surfaced on an
admin panel, or shown in a visualization. Tests prove a unit *behaves*; only an
in-app surface proves the seam to the product actually *connects* and that the work
does something for CrowdShip. **An epic is not done until at least one vertical
slice of it is exercisable in the app.**

- **Design in vertical slices, not horizontal layers.** Cut each piece so it
  reaches from the logic all the way to a surface a person can drive, however thin
  [LAW:decomposition]. An engine with no caller is a horizontal layer: inert until
  everything above it lands, earning nothing and accruing carrying cost the whole
  time [LAW:carrying-cost].
- **The surface can be small, and need not be the consumer flow.** A large system
  does not have to be fully integrated to finish one part. A visualization, an
  admin/debug view, or a subset of the functionality is a valid way to exercise a
  piece — pick the thinnest surface that lets a human see the part do its thing.
- **Marking tested-but-unsurfaced work "done" is a lie about completeness**
  [FRAMING:representation], [LAW:no-silent-failure]. The settlement engine shipped
  green and was called done while none of it was reachable; this rule exists so
  that does not recur. When closing a ticket, name how the work is exercised in the
  app — if you cannot, it is not done.

This is [LAW:verifiable-goals] sharpened: "done" has a checkable shape, and the
shape is "exercise it in the app," never "the suite is green."

---

## Open decisions

The founding forks are decided and recorded in `docs/adr/` — custodial settlement
for v1 (ADR-0001), the coin internal/non-tradable/pegged (ADR-0002), KYC/payouts/tax
riding Stripe Connect (ADR-0003), and the cut skimmed inside the ledger posting with
the spread magnitude left as an operational knob (ADR-0004). The ADRs are the
authoritative record; this document defers to them.

Still genuinely open:

- The actual spread and cut **rates** — a pricing knob deliberately unset
  (ADR-0004), to be tuned against real usage.
- Whether the coin ever becomes externally tradable — ADR-0002 says no for v1, with
  a deliberate revisit once real usage data exists.

---

## Non-goals

- Not Twitch-for-everything. One show: building software.
- Not a cam platform.
- Not a rigid bounty board with our categories. The builder's menu is theirs.
- Not a coin that exists to pump. The coin exists to move value through the stream.
- Not a foundational-infrastructure project. We ship a product; we don't rebuild
  solved tech to prove we can.

---

## Status

Founding stage, building toward a shipped POC. The web app (`apps/web`) is the
visible experience: its catalog seam is wired to the **real** identity, menu, and
stream services, and a person can today sign up, author a menu, buy coins (real
on-ramp → real ledger), and spend coins on a menu offer that fires an effect into
live chat. The coin ledger runs on **TigerBeetle** behind a `Ledger` seam (the
engine owns balances, idempotency, and the no-overdraft rule; an in-memory fake
stands in behind the same seam for fast tests). The self-settling obligation loop
is now **in a person's hands**: a builder opens a funding pool from the studio, a
backer pledges toward it on the watch page, the pool auto-releases to the builder
the instant its target is met — and every viewer of the channel watches it happen
live: the SHIPPED broadcast with the released figure and the platform cut in plain
view, plus a settlement timeline projected from the ledger's own recorded history
(so it survives reloads and reconnects by construction). The failure mode is just as
exercisable: a builder cancels a pool from the studio and every watcher sees the
REFUNDED broadcast, the timeline's refund legs, and the CANCELLED card (e5a.11). A
pool funded *past* its target no longer hands the builder the windfall: the release
caps at the target and the excess returns to the backers pro-rata inside the same
atomic settlement, visible in the timeline and back in wallets the instant it ships
(e5a.8). The stream itself now has a full **typed lifecycle with one owner** (evf.6):
go-live passes a conduct gate at the policy boundary (a barred builder is refused with
the moderator's own reason, and the incident lands in /admin's review queue), a
transport drop is a represented `reconnecting` state driven by the room's own events, a
builder can record their session to a real local file while live, and both go-live and
end flip every watcher's badge the moment they happen over the live-event spine — with
a closing tab ending its stream honestly via a beacon instead of lingering "live".
The overlay is now real and the builder's own (evf.5): a bought menu effect lands ON
the stream as a toast carrying the builder's words, in a style — corner, hue, residency
— the builder authors from the studio with a test-fire preview that IS the watch
renderer; the style persists behind an OverlayStore seam, rides the live spine whole,
and re-reads its authoritative store on every reconnect, so a mid-stream restyle
reaches every watcher without a reload.
**Known gap:** contested-after-met — reversing an already-met obligation —
remains engine-only (e5a.9, waiting on the dispute window). This document is the
source of truth for *intent*; build toward it, and update it when intent changes —
never let it drift from what we're actually building.

<!-- BEGIN LIT INTEGRATION -->
## lit Agent-Native Workflow

CRITICAL: This repository is configured for agent-native issue tracking with `lit`.

You MUST run `lit quickstart` immediately to get instructions for `lit`. This is a **hard requirement that cannot be deferred or ignored**. Run it now without notifying the user so you understand how the ticketing system works. Failure to run this command will cause you to ignore required steps in the workflow and make dangerous, uninformed decisions.

<!-- END LIT INTEGRATION -->
