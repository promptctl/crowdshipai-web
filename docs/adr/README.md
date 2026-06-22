# Architecture Decision Records

An ADR records **one decision** — its context, what was decided, and what follows —
so a choice the project has actually made stops living as folklore in a founding doc's
prose and becomes an explicit, dated, revisable artifact [LAW:verifiable-goals]. The
founding document (`CLAUDE.md`) remains the source of truth for *intent*; an ADR is the
source of truth for *a decision taken in service of that intent*. When the two could
drift, the ADR names the decision and points back at the intent it serves — never a
second, divergent copy of the intent itself [LAW:one-source-of-truth].

These records exist because `CLAUDE.md` lists a set of **open forks** ("Open decisions
(not yet made)") and the `docs/architecture-proposal.md` research pass already resolved
several of them in passing. A lean buried in a paragraph is a decision no one can cite,
date, or revise. Lifting each into a numbered ADR makes the leans first-class.

## The lifecycle is the decision's type

Every ADR carries a **Status**, and the allowed values are the whole lifecycle — there
is no other state a decision can be in:

| Status | Meaning |
| --- | --- |
| `Proposed` | Written down, not yet ratified. A draft seeking a decision. |
| `Accepted` | The decision in force. Build to it. |
| `Superseded` | Replaced by a later ADR. Its `Superseded-by` names which. |
| `Deprecated` | No longer the decision, with no single successor. |

A decision is never edited into a contradiction: to change one, write a **new** ADR that
supersedes the old, and flip the old record's status to `Superseded`. The history stays
legible — you can read why the project once believed something and why it stopped.

## Format

Each record is `NNNN-short-slug.md`, numbered in the order decisions were taken, and
opens with a metadata block the index test enforces (`architecture/adr.test.ts` is the
single enforcer of ADR well-formedness — title number matches the filename, status is a
real lifecycle value, the date parses). The body is Context → Decision → Consequences →
Revisit-when. "Revisit when" is the most important section for this project: every fork
below is revisable by design, and the trigger that should reopen it is named up front so
a future agent knows the condition, not just the conclusion.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-custodial-settlement-for-v1.md) | Custodial settlement for v1; on-chain is a headline deferred, not rejected | Accepted |
| [0002](./0002-coin-is-internal-non-tradable-pegged.md) | The coin is internal, non-tradable, and pegged to a cent for v1 | Accepted |
| [0003](./0003-kyc-payouts-money-transmitter-posture.md) | KYC, payouts, and the money-transmitter problem ride Stripe Connect | Accepted |
| [0004](./0004-the-cut-and-the-buy-sell-spread.md) | The cut is skimmed inside the ledger posting; the spread magnitude is an operational knob | Accepted |
