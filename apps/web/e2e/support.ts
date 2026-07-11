import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { liveKitTokenSigner } from '@crowdship/stream-livekit';
import type { Page } from '@playwright/test';

/**
 * THE one place the e2e suite reads LiveKit credentials [LAW:single-enforcer]. Every spec
 * here is meaningless against the in-memory fake — no media flows, every channel reads
 * offline — so absent or partial creds are a setup error surfaced LOUDLY at the boundary,
 * never a skip that lets a green run lie that the demo works [LAW:no-silent-failure].
 */
export interface LiveKitEnv {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export const requireLiveKitEnv = (): LiveKitEnv => {
  const text = readFileSync(resolve(import.meta.dirname, '../.env.local'), 'utf8');
  const read = (key: string): string => {
    const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (!m || m[1].trim() === '') {
      throw new Error(`e2e: ${key} missing from apps/web/.env.local — the LiveKit harness cannot run against the fake`);
    }
    return m[1].trim();
  };
  return { url: read('LIVEKIT_URL'), apiKey: read('LIVEKIT_API_KEY'), apiSecret: read('LIVEKIT_API_SECRET') };
};

// The local livekit-client browser bundle, injected verbatim into a page so a transport
// check runs the SAME client the app ships. Addressed by file path because the package's
// `exports` map intentionally hides the dist subpath from module resolution.
export const LIVEKIT_UMD_PATH = resolve(
  import.meta.dirname,
  '../node_modules/livekit-client/dist/livekit-client.umd.js',
);

// Mint a token through the app's OWN signer — the same seam the broker's `open` and the
// viewer subscribe-token mint route through — so a transport check proves the real auth
// path, not a re-implemented one [LAW:single-enforcer].
export const tokenMinter = (env: LiveKitEnv) => {
  const sign = liveKitTokenSigner(env.apiKey, env.apiSecret);
  return (room: string, identity: string, access: 'publish' | 'subscribe'): Promise<string> =>
    sign({ room, identity, access, ttlSeconds: 600 });
};

/**
 * A blank but SECURE-CONTEXT page for transport checks: getUserMedia/getDisplayMedia are
 * only exposed over https/localhost, so a routed localhost stub is the cheapest origin that
 * satisfies the requirement. Only this one html document is fulfilled locally — the real wss
 * traffic to LiveKit is never intercepted.
 */
export const openSecurePage = async (page: Page): Promise<void> => {
  await page.route('http://localhost/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  );
  await page.goto('http://localhost/');
  await page.addScriptTag({ path: LIVEKIT_UMD_PATH });
};

// ── App-driving helpers ───────────────────────────────────────────────────────────
// The one copy of "become a signed-in builder with a channel" every acceptance spec
// drives the app through [LAW:one-source-of-truth] — these had drifted into per-spec
// copies before they were hoisted here.

const PASSWORD = 'password1';

/**
 * Sign `email` up, or log it in if it already exists — either way the page ends
 * authenticated.
 *
 * The auth edges rate-limit scrypt-bearing attempts per IP (a deliberate production
 * posture), and every account this suite mints comes from 127.0.0.1 — so back-to-back
 * tests can trip the window. The signup arm ADVERTISES its retry-after ("Please wait
 * Ns"); this helper obeys exactly that advertised backpressure and tries again, rather
 * than failing on the app behaving as designed [LAW:no-ambient-temporal-coupling]: the
 * wait is the server's own figure, never a magic sleep.
 */
export const ensureAccount = async (page: Page, email: string): Promise<void> => {
  // The signed-in truth is the header's session-aware "log out" — rendered from the
  // real session, so it cannot race a redirect the way URL matching does (a first-hit
  // dev compile can hold the /account navigation past any fixed URL wait)
  // [LAW:one-source-of-truth].
  const loggedOut = page.getByRole('button', { name: 'log out' });
  const settle = async (): Promise<boolean> => {
    await Promise.race([
      loggedOut.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined),
    ]);
    return loggedOut.isVisible().catch(() => false);
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/signup');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'create account' }).click();
    if (await settle()) return;

    const notice = (await page.getByRole('alert').textContent().catch(() => null)) ?? '';
    const throttled = notice.match(/wait (\d+)s/);
    if (throttled !== null) {
      await page.waitForTimeout((Number(throttled[1]) + 1) * 1000);
      continue;
    }

    // "Account created — please log in" (a throttled auto-login) or "already
    // registered" (a retried signup): the account exists, log in explicitly.
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'log in' }).click();
    if (await settle()) return;
    // Login refuses with one silent message for both bad credentials and a tripped
    // throttle; the credentials here are known-good, so wait one window and retry.
    await page.waitForTimeout(11_000);
  }
  throw new Error(`could not authenticate ${email} within the rate-limit budget`);
};

/** Claim a builder channel; a successful claim lands on /studio's live surface, where
 *  the go-live control appears. */
export const claimChannel = async (page: Page, handle: string, displayName: string): Promise<void> => {
  await page.goto('/studio');
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.getByRole('button', { name: 'claim channel' }).click();
  await page.getByRole('button', { name: 'go live' }).waitFor({ state: 'visible', timeout: 20_000 });
};

/** Go live: screen capture is mandatory (the fake-media launch flags make getDisplayMedia
 *  resolve headless); the webcam is published too. Live is reached when the control flips
 *  to "end stream". */
export const goLive = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'go live' }).click();
  await page.getByRole('button', { name: 'end stream' }).waitFor({ state: 'visible', timeout: 60_000 });
};
