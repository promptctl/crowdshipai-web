import { expect, test, type Page } from '@playwright/test';

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

const PASSWORD = 'password1';

// Sign-up auto-logs-in and redirects to /account; if that arm instead returns the
// "please log in" notice, fall back to an explicit login — same discipline as the demo
// acceptance spec. Either way the page ends authenticated.
const ensureAccount = async (page: Page, email: string): Promise<void> => {
  await page.goto('/signup');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'create account' }).click();
  await Promise.race([
    page.waitForURL('**/account', { timeout: 15_000 }).catch(() => undefined),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
  ]);
  if (!page.url().includes('/account')) {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'log in' }).click();
    await page.waitForURL('**/account', { timeout: 20_000 });
  }
};

const claimChannel = async (page: Page, handle: string, displayName: string): Promise<void> => {
  await page.goto('/studio');
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.getByRole('button', { name: 'claim channel' }).click();
  await page.getByRole('button', { name: 'go live' }).waitFor({ state: 'visible', timeout: 20_000 });
};

// The pool's arithmetic, stated once: a 200-coin target under the demo 10% cut splits
// into 180 to the builder and 20 to the platform. The assertions below read these
// figures off the SCREEN — what the audience sees must be exactly what the ledger
// recorded [LAW:one-source-of-truth].
const TARGET = '200';
const RELEASED = '180';
const CUT = '20';

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

    const pledge = backer.getByRole('button', { name: '+100', exact: true });
    await pledge.click();
    await expect(backer.getByText(`Pledged — ◎ 100 / ${TARGET} pooled.`)).toBeVisible({ timeout: 15_000 });

    // The first pledge already moves in view of the stream: the passive viewer's
    // settlement timeline shows the contribution under the backer's public pseudonym,
    // with the escrow's running total read from the ledger.
    await expect(viewer.getByText(/pooled by/)).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(/viewer-\w+/).first()).toBeVisible({ timeout: 15_000 });

    // (4) The tipping pledge ships the pool: released to the builder, cut skimmed.
    await pledge.click();
    await expect(backer.getByText('Pool hit its target — auto-released to the builder!')).toBeVisible({
      timeout: 15_000,
    });

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
