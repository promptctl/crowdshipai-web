import { expect, test, type Page } from '@playwright/test';

import { requireLiveKitEnv } from './support';

/**
 * crowdshipai-stream-evf.10 acceptance, as a DETERMINISTIC check — the automated replacement
 * for the "manual two-browser smoke" the ticket had been parked on. A criterion only a human
 * can run is an unverifiable goal; this drives the WHOLE loop through two real browsers against
 * the real app and the real LiveKit cloud and asserts each acceptance item as an observable
 * fact [LAW:verifiable-goals]:
 *
 *   1. a real builder opens their channel and goes live — real screen capture publishes;
 *   2. a separate viewer SEES that real video playing (screen + face), not a placeholder;
 *   3. liveness is derived from the real room — the LIVE badge lights for the viewer;
 *   4. the live loop rides it — a fired menu effect moves coins on the ledger and pops on
 *      screen for everyone watching.
 *
 * It drives the app exactly as a person would (the same inputs and buttons) and asserts what a
 * person would see (frames moving, the badge, the balance, the effect line) — behaviour, never
 * internal structure [LAW:behavior-not-structure].
 */

const PASSWORD = 'password1';

// Sign-up auto-logs-in and redirects to /account; if that arm instead returns the "please log
// in" notice, fall back to an explicit login. Either way the page ends authenticated.
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

// Claim a builder channel; a successful claim redirects to /studio's live surface, where the
// go-live control appears.
const claimChannel = async (page: Page, handle: string, displayName: string): Promise<void> => {
  await page.goto('/studio');
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.getByRole('button', { name: 'claim channel' }).click();
  await page.getByRole('button', { name: 'go live' }).waitFor({ state: 'visible', timeout: 20_000 });
};

interface Offer {
  readonly label: string;
  readonly price: string;
  readonly kind: string;
  readonly summary: string;
  readonly id: string;
}

// The menu form carries data only through a hidden serialized field; the visible inputs (which
// have no name=) are the editing surface. So we fill them by placeholder — exactly:true because
// the name placeholder "Shoutout" and the effect placeholder "shoutout" differ only in case, and
// a loose match would resolve to both [LAW:one-source-of-truth].
const authorOffer = async (page: Page, o: Offer): Promise<void> => {
  await page.getByRole('button', { name: '+ add offer' }).click();
  await page.getByPlaceholder('Shoutout', { exact: true }).fill(o.label);
  await page.getByPlaceholder('50', { exact: true }).fill(o.price);
  await page.getByPlaceholder('shoutout', { exact: true }).fill(o.kind);
  await page.getByPlaceholder('I read your name out loud, on stream.', { exact: true }).fill(o.summary);
  await page.getByPlaceholder('offer-1', { exact: true }).fill(o.id);
  await page.getByRole('button', { name: 'save menu' }).click();
  await expect(page.getByRole('status')).toContainText('Menu saved', { timeout: 15_000 });
};

// Go live: screen capture is mandatory (the fake-media launch flags make getDisplayMedia resolve
// headless); the webcam is published too. Live is reached when the control flips to "end stream".
const goLive = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'go live' }).click();
  await page.getByRole('button', { name: 'end stream' }).waitFor({ state: 'visible', timeout: 60_000 });
};

// A subscribed track with non-zero dimensions could be a single decoded keyframe; an advancing
// currentTime proves a LIVE flow — what a viewer means by "I can see them" [LAW:verifiable-goals].
const assertLiveVideo = async (page: Page, index: number, label: string): Promise<void> => {
  await page.waitForFunction(
    (i) => {
      const v = document.querySelectorAll('video')[i] as HTMLVideoElement | undefined;
      return !!v && v.videoWidth > 0 && v.videoHeight > 0;
    },
    index,
    { timeout: 30_000 },
  );
  const advanced = await page.evaluate(async (i) => {
    const v = document.querySelectorAll('video')[i] as HTMLVideoElement;
    const t0 = v.currentTime;
    await new Promise((r) => setTimeout(r, 1500));
    return v.currentTime > t0;
  }, index);
  expect(advanced, `${label} video is live (currentTime advanced)`).toBe(true);
};

test('the full live demo loop: a real builder streams real video, watched live, and a fired menu effect moves coins', async ({
  browser,
}) => {
  // The smoke is meaningless against the in-memory fake; fail loud at setup if creds are absent
  // rather than time out mid-test on video that never arrives [LAW:no-silent-failure].
  requireLiveKitEnv();

  const run = Date.now();
  const handle = `builder_${run}`;
  const offer: Offer = {
    label: 'Shoutout',
    price: '50',
    kind: 'shoutout',
    summary: 'Reads your name aloud, live.',
    id: 'offer-1',
  };

  const builderCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const builder = await builderCtx.newPage();
  const viewer = await viewerCtx.newPage();

  try {
    // (1) A real builder claims a channel, wires up a priced menu, and goes live.
    await ensureAccount(builder, `builder-${run}@example.com`);
    await claimChannel(builder, handle, `Builder ${run}`);
    await authorOffer(builder, offer);
    await goLive(builder);

    // (2) A separate viewer opens the watch page and SEES the real video — screen and face.
    await ensureAccount(viewer, `viewer-${run}@example.com`);
    await viewer.goto(`/watch/${handle}`);
    await assertLiveVideo(viewer, 0, 'screen');
    await assertLiveVideo(viewer, 1, 'face');

    // (3) Liveness is derived from the real room: the LIVE badge lights for the viewer. The
    // badge text is the uppercase token "LIVE" run together with the viewer count ("LIVE1"), so
    // match the case-sensitive substring — the lowercase "live" used elsewhere never collides.
    // The badge is server-computed at page load, so allow a reload in case the viewer's first
    // render raced just ahead of the room being observable [LAW:no-ambient-temporal-coupling].
    const liveBadge = () => viewer.getByText(/LIVE/).first();
    await expect
      .poll(
        async () => {
          if (await liveBadge().isVisible().catch(() => false)) return true;
          await viewer.reload().catch(() => undefined);
          return liveBadge().isVisible().catch(() => false);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // (4) The live loop rides the stream: the viewer funds a wallet and fires the offer; coins
    // move on the ledger and the effect pops on-screen for everyone watching.
    await viewer.getByRole('button', { name: '+500' }).click();
    const spend = viewer.getByRole('button', { name: `spend ◎${offer.price}` });
    await spend.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(spend).toBeEnabled();
    await spend.click();

    await expect(viewer.getByText('Sent — it fired live.')).toBeVisible({ timeout: 15_000 });
    await expect(viewer.getByText(new RegExp(`fired\\s+${offer.kind}`, 'i'))).toBeVisible({ timeout: 15_000 });
    // 500 bought − 50 spent = 450: the balance re-read from the ledger proves coins actually moved.
    await expect(viewer.getByText(/◎\s*450/).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await builderCtx.close();
    await viewerCtx.close();
  }
});
