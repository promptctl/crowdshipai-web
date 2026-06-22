# @crowdship/moderation

**The single policy boundary.** Content and conduct policy is the platform's job —
the founding document is explicit that it is enforced "at the single policy
boundary, designed in from the start — not bolted on after the first incident."
This package is that boundary: one place every content and conduct check passes
through, so no surface grows its own check that drifts from the others
`[LAW:single-enforcer]`.

## The seam

```
PolicySubject  ──▶  PolicyBoundary.decide  ──▶  PolicyDecision
                      (composed PolicyRules)
```

- **`PolicySubject`** — what a decision is about, discriminated by `kind` along the
  founding document's two axes: `published-text` (content) and `actor-conduct`
  (conduct). Each arm carries only the **facts** a rule needs. The union grows one
  arm at a time as the epic lands.
- **`PolicyRule`** — a named, **pure** judgement returning every objection it has.
  Rules are an **open set**, composed into the boundary as they are written.
- **`PolicyDecision`** — a closed union (`allowed` / `allowed:false` + a non-empty
  list of attributed `PolicyViolation`s). The platform owns this vocabulary;
  callers handle it exhaustively, no default arm.
- **`createPolicyBoundary(rules)`** — folds the rule set into the one boundary:
  most-restrictive-wins, all reasons reported at once.

## Two design lines that must hold

1. **`decide` is synchronous and pure.** A rule never does IO. When a rule needs a
   fact from the world — an image classifier's verdict, an actor's ban record — that
   fact is fetched at the **edge** and handed in on the `PolicySubject`
   `[LAW:effects-at-boundaries]`. Do not make `decide` async to let a rule reach the
   network; lift the effect to the boundary instead. The o97.4 pipeline (report /
   review / action + audit) *wraps* this boundary to record decisions — it does not
   change its purity.

2. **Moderation is `core` and owns opaque refs.** It cannot import `@crowdship/identity`
   or `@crowdship/stream` (sibling cores — same rank is not "down")
   `[LAW:one-way-deps]`. It owns an opaque `ActorRef`; the app maps the identity
   principal / stream channel onto it at the one composition point
   (`apps/web/src/server/policy.ts`), exactly as `@crowdship/stream` maps onto its
   `ChannelRef`. The epic's "depends on identity and stream" is a *domain* relation,
   realised by app-level mapping — not a package edge.

## Status

The boundary, its composition, and its app home (`getPolicyBoundary()`) ship here.
The rule set is **empty by default and loudly so** — that is honest ("no rules
configured yet"), never a fake gate `[LAW:no-silent-failure]`. The real rules land
with their siblings: the hard line (o97.6), conduct (o97.5), maturity rating
(o97.2), age-gating (o97.3, likely a new `PolicyDecision` arm), and the moderation
pipeline (o97.4, wrapping this boundary). Each is a rule or an arm added at the
seam — never a change to the path checks flow through.
