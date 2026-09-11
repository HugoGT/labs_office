// Gated real-LiveKit audio subscription E2E (spec "Real LiveKit audio
// subscription stays manual and gated", design "Gated half"). Every test here
// is skipped unless `VITE_LIVEKIT_E2E` is set -- `node:test`'s per-test
// `{ skip }` option is this file's equivalent of the
// `describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)` precedent already used
// in `livekitRoom.browser.test.ts` (a Vitest browser test; this is a
// `node:test` harness, so there is no `describe.skipIf` here). Requires
// `docker compose up -d redis livekit` in `infra/livekit/` and its `.env`
// populated with real `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`. Never run in
// CI (design residual assumption 4 / spec classification "gated and
// manual").
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOwnSessionId,
  startHarness,
  teleportToTile,
  waitForAudibleSessionId,
  waitForAudioAvailable,
  waitForNoAudibleSessionId,
  waitForOnlineCount,
  waitForRoomIndicator,
} from './harness.mjs';

const AUDIO_E2E_ENABLED = Boolean(process.env.VITE_LIVEKIT_E2E);

/** @type {Awaited<ReturnType<typeof startHarness>>} */
let harness;
let contextA;
let contextB;
let pageA;
let pageB;
/** B's own Colyseus/LiveKit session id, captured once in S7 and reused in
 * S8: it is the exact id that MUST appear in A's audible set while B is on
 * the open floor, and disappear once B enters a private room. */
let peerBId;

before(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  harness = await startHarness({ realLivekit: true, fakeMedia: true });
  contextA = await harness.newContext();
  contextB = await harness.newContext();
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  await pageA.goto(harness.previewUrl);
  await pageB.goto(harness.previewUrl);
});

after(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  await harness?.teardown();
});

test(
  'S7: the open-floor peer becomes audible in real LiveKit subscription state',
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    await waitForOnlineCount(pageA, 1);
    await waitForOnlineCount(pageB, 1);
    await waitForAudioAvailable(pageA);
    await waitForAudioAvailable(pageB);

    peerBId = await getOwnSessionId(pageB);
    assert.ok(
      typeof peerBId === 'string' && peerBId.length > 0,
      'expected pageB to report its own session id via lastVoice()',
    );

    // Presence proven first: A's real LiveKit-bound audible set contains B.
    await waitForAudibleSessionId(pageA, peerBId);
  },
);

test(
  'S8: entering a private room empties the audible session set, audio stays available',
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    await teleportToTile(pageB, 58, 20);
    await waitForRoomIndicator(pageB, 'Cafetería');

    // Absence proven only after S7 already proved presence for this same id.
    await waitForNoAudibleSessionId(pageA, peerBId);
    await waitForAudioAvailable(pageA);
    await waitForAudioAvailable(pageB);
  },
);
