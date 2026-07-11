import { expect, test } from '@playwright/test';

import { claimChannel, ensureAccount } from './support';

/**
 * crowdshipai-settlement-e5a.10 acceptance, as a DETERMINISTIC check: the settlement
 * feed — releases, refunds, and the cut — moves IN VIEW OF THE STREAM. It drives the
 * whole pooled-escrow loop through real browsers against the real app exactly as people
 * would (the same buttons), and asserts what a person would see [LAW:verifiable-goals]:
 *
 *   1. a builder opens a funding pool from their studio;
 *   2. a backer buys coins and pledges it to its target on the watch page;
 *   3. a SEPARATE, passive viewer of the same channel watches the money move live —
 *      the SHIPPED line with the real released and cut figures, and the settlement
 *      timeline showing contribution, release, and cut;
 *   4. the timeline survives a reload, because it is a projection of the ledger's own
 *      recorded history, never an accumulation of live frames [LAW:one-source-of-truth].
 *
 * No LiveKit is needed: settlement transparency is about the money, not the video, so
 * this smoke runs anywhere the app runs.
 */


// The pool's arithmetic, stated once: a 200-coin target under the demo 10% cut splits
// into 180 to the builder and 20 to the platform. The tipping pledge deliberately
// OVERSHOOTS — 100 + 500 pooled against 200 — so the 400-coin excess must return to the
// backer inside the same settlement (crowdshipai-settlement-e5a.8): the builder is paid
// the target's split, never the windfall. The assertions below read these figures off
// the SCREEN — what the audience sees must be exactly what the ledger recorded
// [LAW:one-source-of-truth].
const TARGET = '200';
const RELEASED = '180';
const CUT = '20';
const OVERSHOOT = '400';

test('the settlement feed moves in view of the stream: a passive viewer watches a pool fill, ship, and the cut skimmed', async ({
  browser,
}) => {
  const run = Date.now();
  const handle = `fundr_${run}`;
  const title = `Ship feature ${run}`;

  const builderCtx = await browser.newContext();
  const backerCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const builder = await builderCtx.newPage();
  const backer = await backerCtx.newPage();
  const viewer = await viewerCtx.newPage();

  try {
    // (1) A builder claims a channel and opens a funding pool from the studio.
    await ensureAccount(builder, `fundr-builder-${run}@example.com`);
    await claimChannel(builder, handle, `Fundr ${run}`);
    await builder.locator('input[name="title"]').fill(title);
    await builder.locator('input[name="target"]').fill(TARGET);
    await builder.getByRole('button', { name: 'Open Pool' }).click();
    await expect(builder.getByText(`Pool "${title}" opened`)).toBeVisible({ timeout: 15_000 });

    // (2) A passive viewer — no wallet, no actions — opens the watch page FIRST, so
    // everything they later see arrives over the live channel, not from their own doing.
    await viewer.goto(`/watch/${handle}`);
    await expect(viewer.getByText(title)).toBeVisible({ timeout: 15_000 });

    // (3) A backer funds a wallet and pledges the pool to its target. "+2,000" is the
    // wallet pack (the pledge buttons are +100/+500/+1000, so "+500" would be ambiguous).
    await ensureAccount(backer, `fundr-backer-${run}@example.com`);
    await backer.goto(`/watch/${handle}`);
    await backer.getByRole('button', { name: '+2,000' }).click();
    await expect(backer.getByText(/◎\s*2,000/).first()).toBeVisible({ timeout: 15_000 });

    await backer.getByRole('button', { name: `Pledge 100 to ${title}` }).click();
    await expect(backer.getByText(`Pledged — ◎ 100 / ${TARGET} pooled.`)).toBeVisible({ timeout: 15_000 });

    // The first pledge already moves in view of the stream: the passive viewer's
    // settlement timeline shows the contribution under the backer's public pseudonym,
    // with the escrow's running total read from the ledger.
    await expect(viewer.getByText(/pooled by/)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(/viewer-\w+/).first()).toBeVisible({ timeout: 15_000 });

    // (4) The tipping pledge OVERSHOOTS the pool past its target: released to the
    // builder at the target's split, cut skimmed, and the excess straight back to the
    // backer — one atomic settlement.
    await backer.getByRole('button', { name: `Pledge 500 to ${title}` }).click();
    await expect(backer.getByText('Pool hit its target — auto-released to the builder!')).toBeVisible({
      timeout: 15_000,
    });
    // The excess is back the instant the pool ships: 2,000 − 100 − 500 + 400 = 1,800 —
    // the wallet re-read from the ledger, never a client tally.
    await expect(backer.getByText(/◎\s*1,800/).first()).toBeVisible({ timeout: 15_000 });

    // Every watcher sees the same broadcast SHIPPED line — the released figure and the
    // cut in plain view — and the settlement timeline's release and cut entries. The
    // tipping backer sees no private echo; both pages read the one broadcast.
    for (const page of [viewer, backer]) {
      await expect(page.getByText(new RegExp(`◎ ${RELEASED} to the builder`))).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(new RegExp(`◎ ${CUT} platform cut —`))).toBeVisible({ timeout: 15_000 });
      // The timeline's release and cut entries, matched by their signed recorded amounts
      // ("− ◎ 180", "− ◎ 20") — unique on the page, unlike the verbs, which the backer's
      // own notice text also contains.
      await expect(page.getByText(`− ◎ ${RELEASED}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`− ◎ ${CUT}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/platform cut to CrowdShip/)).toBeVisible({ timeout: 15_000 });
      // The overshoot's return, in the same timeline as the release it rode with: the
      // 400-coin excess back to the backer, in view of everyone (e5a.8).
      await expect(page.getByText(`− ◎ ${OVERSHOOT}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/refunded to/)).toBeVisible({ timeout: 15_000 });
      // Two SHIPPED markers, for everyone: the pool card's badge AND the broadcast
      // chat line — the tipper and the passive viewer read the same two.
      await expect(page.getByText('SHIPPED', { exact: true })).toHaveCount(2, { timeout: 15_000 });
    }

    // The money moment, captured: the passive viewer's page the instant the pool shipped.
    await viewer.screenshot({ path: 'test-results/settlement-evidence/viewer-at-ship.png', fullPage: true });
    await backer.screenshot({ path: 'test-results/settlement-evidence/backer-at-ship.png', fullPage: true });

    // (5) Durability: reload the passive viewer. The live chat line is gone (the channel
    // is live-not-history) but the settlement timeline re-renders identically from the
    // ledger's recorded history — the projection survives reconnects by construction.
    await viewer.reload();
    await expect(viewer.getByText(`− ◎ ${RELEASED}`)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(`− ◎ ${OVERSHOOT}`)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(/platform cut to CrowdShip/)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(/pooled by/).first()).toBeVisible({ timeout: 15_000 });
    // Exactly one SHIPPED now: the durable pool badge. The chat line was the live
    // channel's — gone on reload, exactly as a live-not-history channel promises.
    await expect(viewer.getByText('SHIPPED', { exact: true })).toHaveCount(1, { timeout: 15_000 });
    await viewer.screenshot({ path: 'test-results/settlement-evidence/viewer-after-reload.png', fullPage: true });
  } finally {
    await builderCtx.close();
    await backerCtx.close();
    await viewerCtx.close();
  }
});

// The refund path's arithmetic, stated once: a 100-coin pledge into a 200-coin target
// leaves the pool unmet; cancelling it returns exactly the 100 pledged coins.
const REFUND_TARGET = '200';
const PLEDGED = '100';

test('crowdshipai-settlement-e5a.11: a cancelled pool refunds its backers in view of the stream', async ({
  browser,
}) => {
  const run = Date.now();
  const handle = `refundr_${run}`;
  const title = `Doomed feature ${run}`;

  const builderCtx = await browser.newContext();
  const backerCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const builder = await builderCtx.newPage();
  const backer = await backerCtx.newPage();
  const viewer = await viewerCtx.newPage();

  try {
    // (1) A builder claims a channel and opens a funding pool from the studio.
    await ensureAccount(builder, `refundr-builder-${run}@example.com`);
    await claimChannel(builder, handle, `Refundr ${run}`);
    await builder.locator('input[name="title"]').fill(title);
    await builder.locator('input[name="target"]').fill(REFUND_TARGET);
    await builder.getByRole('button', { name: 'Open Pool' }).click();
    await expect(builder.getByText(`Pool "${title}" opened`)).toBeVisible({ timeout: 15_000 });

    // (2) A passive viewer opens the watch page FIRST — the refund must reach them
    // over the live channel, not from anything they did.
    await viewer.goto(`/watch/${handle}`);
    await expect(viewer.getByText(title)).toBeVisible({ timeout: 15_000 });

    // (3) A backer funds a wallet and pledges — the pool stays short of its target.
    await ensureAccount(backer, `refundr-backer-${run}@example.com`);
    await backer.goto(`/watch/${handle}`);
    await backer.getByRole('button', { name: '+2,000' }).click();
    await expect(backer.getByText(/◎\s*2,000/).first()).toBeVisible({ timeout: 15_000 });
    await backer.getByRole('button', { name: `Pledge ${PLEDGED} to ${title}` }).click();
    await expect(backer.getByText(`Pledged — ◎ ${PLEDGED} / ${REFUND_TARGET} pooled.`)).toBeVisible({
      timeout: 15_000,
    });
    // The backer's wallet is down by the pledge: 2,000 − 100 = 1,900.
    await expect(backer.getByText(/◎\s*1,900/).first()).toBeVisible({ timeout: 15_000 });

    // (4) The builder cancels the pool from the studio and sees the refunded total —
    // the ledger's own recorded refund legs, not a client tally.
    await builder.getByRole('button', { name: 'Cancel pool — refund backers' }).click();
    await expect(
      builder.getByText(`Pool "${title}" cancelled — ◎ ${PLEDGED} refunded to its backers.`),
    ).toBeVisible({ timeout: 15_000 });

    // (5) Every watcher sees the failure mode as plainly as a ship: the broadcast
    // REFUNDED line with the recorded total, the timeline's refund entry under the
    // backer's public pseudonym, and the pool card flipping to CANCELLED.
    for (const page of [viewer, backer]) {
      await expect(page.getByText(new RegExp(`◎ ${PLEDGED} to the backers`))).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`− ◎ ${PLEDGED}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/refunded to/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('CANCELLED', { exact: true })).toBeVisible({ timeout: 15_000 });
    }

    // (6) The backer is made whole — the wallet re-reads 2,000 from the ledger on the
    // next money action; the durable proof is the timeline, and the coins themselves:
    // reload and the authoritative balance shows the pledge returned.
    await backer.reload();
    await expect(backer.getByText(/◎\s*2,000/).first()).toBeVisible({ timeout: 15_000 });

    // The money moment, captured: the passive viewer's page after the refund.
    await viewer.screenshot({ path: 'test-results/settlement-evidence/viewer-at-refund.png', fullPage: true });

    // (7) Durability: reload the passive viewer. The REFUNDED chat line was the live
    // channel's (gone, as live-not-history promises); the timeline's refund entry and
    // the CANCELLED badge re-render from the ledger and registry — and the card no
    // longer invites pledges the market would refuse.
    await viewer.reload();
    await expect(viewer.getByText(`− ◎ ${PLEDGED}`)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(/refunded to/)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText('CANCELLED', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByRole('button', { name: `Pledge ${PLEDGED} to ${title}` })).toHaveCount(0);
    await viewer.screenshot({ path: 'test-results/settlement-evidence/viewer-after-refund-reload.png', fullPage: true });
  } finally {
    await builderCtx.close();
    await backerCtx.close();
    await viewerCtx.close();
  }
});
