import { chromium, expect, test } from '@playwright/test';

import { openSecurePage, requireLiveKitEnv, tokenMinter } from './support';

/**
 * The transport-layer check: does real WebRTC media flow builder→SFU→viewer through the
 * REAL LiveKit cloud, headless? It is the foundation the app-driven acceptance smoke stands
 * on — deliberately app-INDEPENDENT (it mints its own tokens and runs livekit-client on a
 * blank page) so a failure here is a media-transport fact, not an app-wiring bug. The
 * acceptance smoke proves the same media flows through the real app; this proves the layer
 * beneath it in isolation, so a regression is localised in one read [LAW:decomposition].
 */

const env = requireLiveKitEnv();
const mint = tokenMinter(env);

// setCameraEnabled (getUserMedia) and setScreenShareEnabled (getDisplayMedia) are the two
// real-world capture paths go-live drives; this exercises each on the bare client and asserts
// the viewer receives a live track tagged with the source the StreamPlayer routes by.
const runTransport = async (kind: 'camera' | 'screen', expectedSource: 'camera' | 'screen_share') => {
  const room = `transport-${kind}-${Date.now()}`;
  const [publishToken, subscribeToken] = await Promise.all([
    mint(room, `pub-${kind}`, 'publish'),
    mint(room, `view-${kind}`, 'subscribe'),
  ]);

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
    ],
  });
  try {
    const pubPage = await (await browser.newContext()).newPage();
    const viewPage = await (await browser.newContext()).newPage();
    await openSecurePage(pubPage);
    await openSecurePage(viewPage);

    const pub = await pubPage.evaluate(
      async ({ url, token, kind }) => {
        const LK = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
        const room = new LK.Room();
        await room.connect(url, token);
        try {
          if (kind === 'camera') await room.localParticipant.setCameraEnabled(true);
          else await room.localParticipant.setScreenShareEnabled(true);
          return { ok: true, error: '' };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
        }
      },
      { url: env.url, token: publishToken, kind },
    );
    expect(pub.ok, `publisher enabled ${kind} headless (error: ${pub.error})`).toBe(true);

    const view = await viewPage.evaluate(
      async ({ url, token }) => {
        const LK = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
        const room = new LK.Room();
        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        document.body.appendChild(video);
        const got = new Promise<string>((res) => {
          room.on(LK.RoomEvent.TrackSubscribed, (track, pub) => {
            if (track.kind === 'video') {
              track.attach(video);
              res(String(pub.source));
            }
          });
        });
        await room.connect(url, token);
        const source = await Promise.race([
          got,
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('no video track subscribed within 15s')), 15_000)),
        ]);
        const t0 = video.currentTime;
        await new Promise((r) => setTimeout(r, 1500));
        return { source, width: video.videoWidth, advanced: video.currentTime > t0 };
      },
      { url: env.url, token: subscribeToken },
    );

    // Non-zero dimensions could be a single decoded keyframe; an advancing currentTime proves
    // a LIVE RTP flow, the thing a viewer means by "I can see them building" [LAW:verifiable-goals].
    expect(view.width, 'viewer received real video frames').toBeGreaterThan(0);
    expect(view.advanced, 'received video is live (currentTime advanced)').toBe(true);
    expect(view.source, 'track is tagged with the source the StreamPlayer routes by').toBe(expectedSource);
  } finally {
    await browser.close();
  }
};

test('a real camera track publishes to the real LiveKit cloud and a second browser receives live frames', () =>
  runTransport('camera', 'camera'));

test('a real getDisplayMedia screen track publishes tagged ScreenShare and a second browser receives live frames', () =>
  runTransport('screen', 'screen_share'));
