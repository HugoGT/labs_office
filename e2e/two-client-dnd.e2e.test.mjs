// Real-LiveKit two-client E2E for #84: coming back from "No molestar" must
// bring back the peers' cameras and a working screen share, also when the
// LiveKit room died while the status was on. Skipped unless
// `VITE_LIVEKIT_E2E` is set, same gate and prerequisites as
// `two-client-audio.e2e.test.mjs`. The space scenario also needs the
// directory (`DATABASE_URL`): without it there are no space rooms and no
// screen share.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enableCam,
  getOwnSessionId,
  setStatus,
  startHarness,
  startScreenShare,
  teleportToTile,
  waitForAudioAvailable,
  waitForNoPeerVideo,
  waitForOnlineCount,
  waitForPeerVideoPlaying,
  waitForRoomIndicator,
  waitForScreenShareStage,
  waitForScreenShareThumbnail,
} from './harness.mjs';

const AUDIO_E2E_ENABLED = Boolean(process.env.VITE_LIVEKIT_E2E);
const SPACES_ENABLED = AUDIO_E2E_ENABLED && Boolean(process.env.DATABASE_URL);

/** @type {Awaited<ReturnType<typeof startHarness>>} */
let harness;
let pageA;
let pageB;
let peerAId;
let peerBId;

before(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  harness = await startHarness({ realLivekit: true, fakeMedia: true });

  pageA = await (await harness.newContext()).newPage();
  await pageA.goto(harness.previewUrl);
  await waitForAudioAvailable(pageA);

  pageB = await (await harness.newContext()).newPage();
  await pageB.goto(harness.previewUrl);
  await waitForAudioAvailable(pageB);
  await enableCam(pageB);

  await waitForOnlineCount(pageA, 1);
  await waitForOnlineCount(pageB, 1);

  peerAId = await getOwnSessionId(pageA);
  peerBId = await getOwnSessionId(pageB);
  assert.ok(typeof peerAId === 'string' && peerAId.length > 0, 'expected pageA to report its session id');
  assert.ok(typeof peerBId === 'string' && peerBId.length > 0, 'expected pageB to report its session id');
});

after(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  await harness?.teardown();
});

test("back from No molestar: A sees B's camera again", { skip: !AUDIO_E2E_ENABLED }, async () => {
  // Control: the camera is visible before any status change.
  await waitForPeerVideoPlaying(pageA, peerBId);

  await setStatus(pageA, 'r');
  await waitForNoPeerVideo(pageA, peerBId);

  await setStatus(pageA, 'g');
  await waitForPeerVideoPlaying(pageA, peerBId);
});

test('camera off with real LiveKit: the own tile drops the video, and gets it back (#304)', { skip: !AUDIO_E2E_ENABLED }, async () => {
  const ownVideo = pageB.locator(`[data-testid="video-tile-bar"] [data-session-id="${peerBId}"] video`);
  await ownVideo.waitFor();

  await enableCam(pageB);
  await ownVideo.waitFor({ state: 'detached' });
  // In company the tile stays, with the portrait.
  await pageB.locator(`[data-testid="video-tile-bar"] [data-session-id="${peerBId}"]`).waitFor();

  await enableCam(pageB);
  await ownVideo.waitFor();
  await waitForPeerVideoPlaying(pageA, peerBId);
});

/**
 * The room dies while "No molestar" is on (#84). Nothing is published or
 * subscribed then, which is why nobody notices until coming back.
 */
async function loseRoomDuringDnd() {
  await setStatus(pageA, 'r');
  await waitForNoPeerVideo(pageA, peerBId);
  await harness.dropFromLivekit(peerAId);
  await setStatus(pageA, 'g');
}

test(
  "room lost during No molestar: back online, A sees B's camera again",
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    await waitForPeerVideoPlaying(pageA, peerBId);
    await loseRoomDuringDnd();
    await waitForPeerVideoPlaying(pageA, peerBId);
  },
);

test(
  'room lost during No molestar inside a space: back online, A can share its screen with B',
  { skip: !SPACES_ENABLED },
  async () => {
    await teleportToTile(pageA, 58, 20);
    await teleportToTile(pageB, 59, 20);
    await waitForRoomIndicator(pageA, 'Cafetería');
    await waitForRoomIndicator(pageB, 'Cafetería');
    await waitForPeerVideoPlaying(pageA, peerBId);

    await loseRoomDuringDnd();

    await waitForPeerVideoPlaying(pageA, peerBId);
    await startScreenShare(pageA);
    await waitForScreenShareStage(pageB, peerAId);
  },
);

// Follows the scenario above, which leaves A sharing with B in a space.
test(
  'Escape minimizes the view of a share without cutting it, for the sharer and for whoever watches (#304)',
  { skip: !SPACES_ENABLED },
  async () => {
    const sidebarOf = (page) => page.getByRole('complementary', { name: 'Personas' });
    // The sharer starts with the share in the foreground; whoever watches keeps the right side.
    assert.equal(await sidebarOf(pageA).isVisible(), false);
    assert.equal(await sidebarOf(pageB).isVisible(), true);

    await pageA.keyboard.press('Escape');
    await sidebarOf(pageA).waitFor();
    await waitForScreenShareStage(pageA, peerAId);

    await pageA.keyboard.press('Escape');
    await waitForScreenShareThumbnail(pageA);
    assert.equal(await sidebarOf(pageA).isVisible(), true);
    assert.equal(await pageA.getByRole('button', { name: /Dejar de compartir/ }).isVisible(), true);
    // B still gets the share: the sharer only moved its own view.
    await waitForScreenShareStage(pageB, peerAId);

    await pageB.keyboard.press('Escape');
    await waitForScreenShareThumbnail(pageB);

    await pageA.getByRole('button', { name: 'Ampliar pantalla compartida' }).click();
    await waitForScreenShareStage(pageA, peerAId);

    await pageA.getByRole('button', { name: /Dejar de compartir/ }).click();
    await pageB.getByTestId('screen-share-thumbnail').waitFor({ state: 'detached' });
    assert.equal(await sidebarOf(pageA).isVisible(), true);
  },
);

test(
  'a click brings the screen or a camera to the foreground, for the sharer and for whoever watches (#304)',
  { skip: !SPACES_ENABLED },
  async () => {
    const sidebarOf = (page) => page.getByRole('complementary', { name: 'Personas' });
    await startScreenShare(pageA);
    await waitForScreenShareStage(pageB, peerAId);

    await pageB.getByRole('button', { name: 'Ampliar pantalla compartida' }).click();
    await sidebarOf(pageB).waitFor({ state: 'hidden' });
    await pageB.getByRole('button', { name: 'Reducir pantalla compartida' }).click();
    await sidebarOf(pageB).waitFor();
    await pageB.getByRole('button', { name: 'Ampliar pantalla compartida' }).click();
    await sidebarOf(pageB).waitFor({ state: 'hidden' });
    await pageB.keyboard.press('Escape');
    await sidebarOf(pageB).waitFor();
    await waitForScreenShareStage(pageB, peerAId);

    await pageA.locator(`[data-testid="video-tile-bar"] [data-session-id="${peerBId}"] button`).click();
    await pageA.locator(`[data-testid="camera-stage"][data-session-id="${peerBId}"] video`).waitFor();
    await waitForScreenShareThumbnail(pageA);
    await pageA.keyboard.press('Escape');
    await waitForScreenShareStage(pageA, peerAId);
    await waitForPeerVideoPlaying(pageA, peerBId);

    await pageA.getByRole('button', { name: /Dejar de compartir/ }).click();
    await pageB.getByTestId('screen-share-stage').waitFor({ state: 'detached' });
  },
);

test('camera off once alone in a space: the tile goes away, no black window left (#304)', { skip: !SPACES_ENABLED }, async () => {
  const ownTile = pageB.locator(`[data-testid="video-tile-bar"] [data-session-id="${peerBId}"]`);
  await teleportToTile(pageA, 94, 67);
  await waitForOnlineCount(pageB, 1);
  await pageB.waitForFunction(() => window.__officeE2E.lastVoice?.().peers.length === 0);
  await ownTile.locator('video').waitFor();

  await enableCam(pageB);
  await ownTile.waitFor({ state: 'detached' });

  await enableCam(pageB);
  await ownTile.locator('video').waitFor();
  await teleportToTile(pageA, 58, 20);
  await waitForRoomIndicator(pageA, 'Cafetería');
  await waitForPeerVideoPlaying(pageA, peerBId);
});

// Last: A is left out of LiveKit on purpose.
test(
  'removed from LiveKit by the server: never comes back on its own (#283)',
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    await waitForPeerVideoPlaying(pageA, peerBId);

    await harness.removeFromLivekit(peerAId);
    await waitForNoPeerVideo(pageA, peerBId);
    // Well past the first rebuild step (1-2 s) and the second (2-4 s): a
    // rebuild would have put A back in a room by now.
    await new Promise((resolve) => setTimeout(resolve, 8000));

    assert.deepEqual(await harness.livekitRoomsOf(peerAId), []);
  },
);
