---
name: verify
description: Verify a change to the CrowdShip web app by driving the real Next.js app in real browsers via Playwright. Use when a change to apps/web needs runtime observation — the watch page, studio, signup/login, the coin economy, pools, chat, or live events.
---

# Verifying apps/web changes at the surface

The surface is the browser. The repo already has a working Playwright harness —
use it rather than hand-rolling a launcher.

## Handle

- `pnpm exec playwright test e2e/<spec>.spec.ts` from `apps/web` runs a spec and
  **auto-starts the app** on port 3100 (`playwright.config.ts` `webServer`,
  `reuseExistingServer: true`). No manual dev-server management needed.
- First run on a fresh machine: `pnpm exec playwright install chromium`.
- `e2e/demo-acceptance.spec.ts` needs real LiveKit env (`requireLiveKitEnv`);
  `e2e/settlement-acceptance.spec.ts` does not — money flows run without video.
- For ad-hoc probes (console capture etc.), a standalone `.mjs` script importing
  `@playwright/test`'s `chromium` **must live under `apps/web/`** for ESM module
  resolution, and needs the dev server started separately:
  `pnpm exec next dev --port 3100 &`.

## Proven flow recipes (selectors verified 2026-07)

- **Account**: `/signup`, fill `input[name=email]` / `input[name=password]`,
  click button `create account`, wait for `**/account` (fallback: `/login`,
  button `log in`). Copy `ensureAccount` from either acceptance spec.
- **Channel**: `/studio`, fill `input[name=handle]` / `input[name=displayName]`,
  click `claim channel`, wait for button `go live`.
- **Open a pool**: on `/studio`, fill `input[name=title]` / `input[name=target]`,
  click `Open Pool`, expect text `Pool "<title>" opened`.
- **Buy coins on /watch/[slug]**: click wallet pack button `+2,000` — NOT
  `+500`, which collides with the pledge button of the same label.
- **Pledge**: pool card buttons `+100` / `+500` / `+1000` (exact: true).
- **Multi-viewer**: one `browser.newContext()` per person; the in-memory market
  and live feed are process-global on the one dev server, so all contexts share
  the economy.

## Gotchas

- `waitUntil: 'networkidle'` **never settles on /watch** — the SSE EventSource
  stays open. Use `'load'` + a short timeout.
- The Next dev overlay shows a "1 Issue" badge on /watch when the builder is not
  live: the LiveKit player throws an unhandled `could not establish signal
  connection` pageerror in headless. Pre-existing; do not attribute it to a
  money/UI change. Home `/` is console-clean — use it as the baseline.
- The route is `/` (browse grid), not `/browse`.
- Text like `SHIPPED` appears both as a pool badge and inside the broadcast chat
  line — assert with `toHaveCount(n)` or amount-bearing text (`− ◎ 180`), not
  bare `getByText`.
- The in-memory economy resets when the dev server restarts; specs must create
  their own world (fresh handle per run: `` `x_${Date.now()}` ``).
