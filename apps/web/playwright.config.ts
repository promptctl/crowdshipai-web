import { defineConfig } from '@playwright/test';

/**
 * End-to-end harness config. These specs drive REAL browsers against the REAL LiveKit
 * cloud (and, for the acceptance smoke, the real Next app), so they are deliberately kept
 * out of the fast vitest suite and run explicitly with `pnpm e2e`. Single worker: the
 * specs share one LiveKit project and real rooms, so serial execution keeps them from
 * racing each other's room state [LAW:no-ambient-temporal-coupling].
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // On a failed run, keep the trace and a screenshot so a failure is diagnosable after the
    // fact without re-running — these e2e specs touch the real cloud, so reproducing a flake is
    // not free [LAW:verifiable-goals].
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Synthetic media + auto-granted permissions, the configuration proven to publish both
    // a fake CAMERA (getUserMedia) and a fake SCREEN (getDisplayMedia) headless against the
    // real LiveKit cloud — see e2e/livekit-transport.spec.ts. With these, go-live needs no
    // hardware and no human gesture, so the builder's real screen+webcam publish path runs
    // unattended.
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--auto-accept-this-tab-capture',
      ],
    },
  },
  // The real Next app, run on a dedicated port so it never collides with a hand-run dev
  // server on 3000. It loads apps/web/.env.local itself, so the real LiveKit broker is bound
  // (LIVEKIT_* present) and go-live returns a real publish credential rather than the no-sfu
  // fake — the acceptance smoke is meaningless against the fake [LAW:no-silent-failure].
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
