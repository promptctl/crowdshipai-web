/**
 * The ONE definition of the e2e browser proxy [LAW:one-source-of-truth]: the port the
 * `connect-proxy.mjs` tunnel listens on (playwright.config.ts starts it as a
 * webServer), and the Playwright proxy setting every e2e browser uses — the config's
 * default contexts and the transport spec's own `chromium.launch` alike. See
 * connect-proxy.mjs for WHY the tunnel exists (a process-level firewall resets the
 * hermetic browser's direct outbound connections).
 *
 * Localhost is bypassed: the app under test is reached directly, so the tunnel carries
 * only the real-cloud traffic (LiveKit signal + TURN/TLS media).
 */
export const E2E_PROXY_PORT = 3180;

export const E2E_PROXY = {
  server: `http://127.0.0.1:${E2E_PROXY_PORT}`,
  bypass: 'localhost,127.0.0.1',
} as const;
