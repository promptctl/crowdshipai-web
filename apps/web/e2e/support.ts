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
