import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { claimChannel, ensureAccount } from './support';

/**
 * Acceptance for the overlay surface (stream-evf.5): the builder styles how fired
 * effects land on their stream — the corner, the hue, the residency — and a watcher
 * sees a bought effect land ON the stream in exactly that style; a mid-watch restyle
 * reaches the already-attached watcher over the live spine without a reload.
 *
 * Runs against the in-memory stand-ins for video (no LiveKit needed): the overlay is
 * the live-event layer, and effects fire on a purchase whether or not media flows —
 * the money and the moment are independent of the SFU [LAW:decomposition].
 */

const run = `${Date.now()}`;
const builderEmail = `overlay-builder-${run}@example.com`;
const watcherEmail = `overlay-watcher-${run}@example.com`;
const slug = `ov${run}`;

/** Author a one-offer menu through the studio's real form, so the watcher has a
 *  priced thing to fire. */
const authorShoutout = async (page: Page): Promise<void> => {
  await page.goto('/studio');
  await page.getByRole('button', { name: '+ add offer' }).click();
  await page.getByRole('textbox', { name: 'name', exact: true }).fill('Big Shoutout');
  await page.getByRole('textbox', { name: 'price (coins)' }).fill('50');
  await page.getByRole('textbox', { name: 'effect', exact: true }).fill('shoutout');
  await page.getByRole('textbox', { name: 'description' }).fill('Name read out loud, live.');
  await page.getByRole('button', { name: 'save menu' }).click();
  await expect(page.getByRole('status')).toContainText('Menu saved');
};

/** Restyle the overlay through the studio's real form: pick a corner, save, and see
 *  the honest confirmation. */
const saveOverlay = async (page: Page, corner: string): Promise<void> => {
  await page.goto('/studio');
  await page.getByRole('button', { name: corner, exact: true }).click();
  await page.getByRole('button', { name: 'save overlay' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Overlay saved' })).toBeVisible();
};

test('the builder styles the overlay, the watcher sees effects land in that style, and a restyle arrives live', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // ── The builder: account, channel, a menu to buy from, and a styled overlay.
  const builderCtx: BrowserContext = await browser.newContext();
  const builder = await builderCtx.newPage();
  await ensureAccount(builder, builderEmail);
  await claimChannel(builder, slug, 'Overlay Mara');
  await authorShoutout(builder);

  // The studio preview is the REAL renderer: test-firing shows the toast locally
  // before anything is saved or bought.
  await builder.goto('/studio');
  await builder.getByRole('button', { name: '⚡ test-fire an effect' }).click();
  await expect(builder.locator('[data-placement]').getByText('⚡ Shoutout')).toBeVisible();

  await saveOverlay(builder, 'top right');

  // ── The watcher: a second person funds a wallet and fires the builder's offer.
  const watcherCtx: BrowserContext = await browser.newContext();
  const watcher = await watcherCtx.newPage();
  await ensureAccount(watcher, watcherEmail);
  await watcher.goto(`/watch/${slug}`, { waitUntil: 'load' });

  // The stage carries the builder's saved style before anything fires.
  const overlay = watcher.locator('[data-placement]');
  await expect(overlay).toHaveAttribute('data-placement', 'top-right');

  await watcher.getByRole('button', { name: '+2,000' }).click();
  await expect(watcher.getByText('Coins added to your wallet.')).toBeVisible();
  await watcher.getByRole('button', { name: 'spend ◎50' }).click();

  // The effect lands ON the stream, in the builder's words, in the builder's corner.
  await expect(overlay.getByText('⚡ Big Shoutout')).toBeVisible();
  await expect(overlay.getByText('Name read out loud, live.')).toBeVisible();

  // ── Mid-watch restyle: the builder moves the overlay; the attached watcher's
  // surface converges over the live spine, no reload.
  await saveOverlay(builder, 'bottom left');
  await expect(overlay).toHaveAttribute('data-placement', 'bottom-left', { timeout: 15_000 });

  // The next firing lands in the NEW corner, and ages out at the styled residency.
  await watcher.getByRole('button', { name: 'spend ◎50' }).click();
  await expect(overlay.getByText('⚡ Big Shoutout').last()).toBeVisible();
  // The default residency is 8s: standing toasts retire on their own [the styled
  // duration], leaving the stream clear rather than accreting cards forever.
  await expect(overlay.getByText('⚡ Big Shoutout')).toHaveCount(0, { timeout: 20_000 });

  await builderCtx.close();
  await watcherCtx.close();
});
