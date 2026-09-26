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
