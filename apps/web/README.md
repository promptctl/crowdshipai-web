# @crowdship/web

The watch experience — the visible product. Browse live builders, open a watch
surface (stream + the builder's priced-offer menu + live chat), and view a
builder's channel page.

This is a **walking skeleton**: the real UI shell, driven by an in-memory fake so
the product is visible and steerable before the stream, identity, and menu
services exist.

## Run

```bash
pnpm --filter @crowdship/web dev      # http://localhost:3000
pnpm --filter @crowdship/web build    # production build + typecheck
```

## The one seam that matters

Every page reads through **`getCatalog(): CrowdCatalog`** (`src/data/catalog.ts`).
Nothing in `src/app` or `src/components` knows where the data comes from. When the
real services land, implement `CrowdCatalog` against them and change the one line
in `catalog.ts` — the UI is untouched (`[LAW:locality-or-seam]`).

- `src/data/types.ts` — view-model types + the `CrowdCatalog` interface.
- `src/data/fake-catalog.ts` — throwaway in-memory seed data. Delete on real wiring.
- `src/data/catalog.ts` — the single swap point.

## The menu is the builder's, not ours

A `PricedOffer` is a price + an `OfferEffect`, and `effect.kind` is an **open
string the UI carries but never branches on** (`[LAW:dataflow-not-control-flow]`).
There is deliberately no `shoutout`/`vote`/`fund` enum — the variety comes from
builders. The grid renders any offer generically; new kinds need zero UI code.

## What's faked (and where it plugs in)

- **Video** → `StreamStage` placeholder. Real ingest/playback: the stream epic.
- **Coins / spend** → local wallet + optimistic chat line in `WatchSurface`. Real
  movement: the ledger + settlement epics, called at the same seam.
- **Live chat / presence** → seeded static list. Real-time: the stream epic.
