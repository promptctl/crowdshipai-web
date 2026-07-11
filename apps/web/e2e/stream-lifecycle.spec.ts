import { expect, test } from '@playwright/test';

import { claimChannel, ensureAccount, goLive, requireLiveKitEnv } from './support';

/**
 * crowdshipai-stream-evf.6 acceptance: the stream lifecycle is typed state with one
 * owner, observable end-to-end [LAW:verifiable-goals]. Two real browsers against the
 * real app and the real LiveKit cloud:
 *
 *   1. a WAITING viewer's badge flips offline → LIVE the moment the builder goes live —
 *      the lifecycle frame on the live-event spine, not a reload;
 *   2. RECORDING is a real facet of being live: start shows REC, stop delivers an
 *      actual .webm file of the builder's own capture;
 *   3. a transport drop is the REPRESENTED `reconnecting` state, entered when the
 *      network dies and left when it returns — never a silent flap to offline;
 *   4. ending the stream flips the watching badge LIVE → offline live, and returns the
 *      builder's control to "go live".
 *
 * Everything is asserted as what a person would see — badges, buttons, a downloaded
 * file — behaviour, never internal structure [LAW:behavior-not-structure].
 */

test('the stream lifecycle in view of everyone: go-live flips the badge, recording delivers a file, a network drop is "reconnecting", ending flips it back', async ({
  browser,
}) => {
  // Meaningless against the in-memory fake; fail loud at setup [LAW:no-silent-failure].
  requireLiveKitEnv();

  const run = Date.now();
  const handle = `lifecycle_${run}`;

  const builderCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const builder = await builderCtx.newPage();
  const viewer = await viewerCtx.newPage();

  try {
    await ensureAccount(builder, `lifecycle-builder-${run}@example.com`);
    await claimChannel(builder, handle, `Lifecycle ${run}`);

    // (1) The viewer arrives BEFORE the builder goes live and sees the honest offline
    // badge. When the builder goes live, the lifecycle frame flips it to LIVE with no
    // reload — the whole point of the push signal.
    await viewer.goto(`/watch/${handle}`);
    await expect(viewer.getByText('offline').first()).toBeVisible({ timeout: 20_000 });

    await goLive(builder);
    await expect(viewer.getByText(/LIVE/).first()).toBeVisible({ timeout: 20_000 });

    // (2) Recording: REC lights while recording; stopping delivers a real .webm of the
    // builder's own screen capture, named for the channel.
    await builder.getByRole('button', { name: 'record', exact: true }).click();
    // exact: the loose match would also claim the "stop recording" button's text.
    await expect(builder.getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });
    // Let the recorder accumulate real encoded chunks before stopping.
    await builder.waitForTimeout(2_000);
    const download = builder.waitForEvent('download', { timeout: 30_000 });
    await builder.getByRole('button', { name: 'stop recording' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^crowdship-${handle}-.+\\.webm$`));
    await expect(builder.getByText('REC', { exact: true })).toBeHidden();

    // (3) A dead network is the represented `reconnecting` arm, not a flap to offline:
    // the builder's control says so while the client re-establishes, and recovers to
    // live when the network returns. The room's own events drive both transitions.
    await builderCtx.setOffline(true);
    await expect(builder.getByText(/reconnecting…/)).toBeVisible({ timeout: 45_000 });
    await builderCtx.setOffline(false);
    await expect(builder.getByText(/reconnecting…/)).toBeHidden({ timeout: 45_000 });
    await expect(builder.getByRole('button', { name: 'end stream' })).toBeVisible();

    // (4) Ending the stream flips the watching badge back to offline — live, no reload
    // — and the builder's control returns to "go live".
    await builder.getByRole('button', { name: 'end stream' }).click();
    await expect(builder.getByRole('button', { name: 'go live' })).toBeVisible({ timeout: 20_000 });
    await expect(viewer.getByText('offline').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await builderCtx.close();
    await viewerCtx.close();
  }
});
