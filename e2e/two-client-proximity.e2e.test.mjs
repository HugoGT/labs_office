// Two-client proximity E2E (D5/D6/D7/D8). Drives two independent Playwright
// browser contexts against the real instrumented bundle (`dist-e2e`) and the
// real Colyseus server, asserting only on rendered HUD text -- never on
// hashed CSS class names or peer identity (both clients render `HugoGT`).
//
// Slice C adds S3 (entering a private room isolates the occupant from the
// open-floor peer, mutually) and S4 (leaving the room reverses isolation).
// S1 lives in `bundle-hook-absent.e2e.test.mjs`. Slice D adds S6: with no
// LiveKit server reachable, the harness's shared server spawn already scrubs
// `LIVEKIT_API_KEY`/`SECRET` (D6), so this is a characterization test of the
// degradation path shipped in `useProximityAudio.ts`/`BottomBar.tsx`
// (commit `3eaa371`), not test-driven new behaviour.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  teleportToTile,
  waitForAudioUnavailable,
  waitForOnlineCount,
  waitForPeerChipCount,
  waitForRoomIndicator,
} from './harness.mjs';

/** @type {Awaited<ReturnType<typeof startHarness>>} */
let harness;
let contextA;
let contextB;
let pageA;
let pageB;
/** D7 W6 / spec "LiveKit-down degradation": collected for the whole run, not
 * just S6, so any unhandled exception anywhere in the suite fails it. */
let pageErrorsA;
let pageErrorsB;

before(async () => {
  harness = await startHarness();
  contextA = await harness.newContext();
  contextB = await harness.newContext();
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  pageErrorsA = [];
  pageErrorsB = [];
  pageA.on('pageerror', (error) => pageErrorsA.push(error));
  pageB.on('pageerror', (error) => pageErrorsB.push(error));
  await pageA.goto(harness.previewUrl);
  await pageB.goto(harness.previewUrl);
});

after(async () => {
  await harness?.teardown();
});

test('S2: both open-floor peers see each other online and chipped at spawn', async () => {
  await waitForOnlineCount(pageA, 1);
  await waitForOnlineCount(pageB, 1);
  await waitForPeerChipCount(pageA, 1);
  await waitForPeerChipCount(pageB, 1);
});

test('S3: entering a private room isolates its occupant from the open-floor peer', async () => {
  // Design's stated (56, 25) is a solid table tile (mapBuilder.ts
  // `markSolid(grid.solid, 53, 23, 5, 3)`); (58, 20) is a verified
  // non-solid interior tile of the same room (Cafeteria: x 50-62, y 18-31).
  await teleportToTile(pageB, 58, 20);
  await waitForRoomIndicator(pageB, 'Cafetería'); // W3: B sees the private-room indicator
  await waitForOnlineCount(pageB, 1); // positive control: B is still connected, not stalled
  await waitForPeerChipCount(pageB, 0); // W4: B no longer sees A's chip
  await waitForOnlineCount(pageA, 1); // positive control: A is still connected and reading online
  await waitForPeerChipCount(pageA, 0); // W4: A no longer sees B's chip
});

test('S4: returning to the open floor reverses room isolation', async () => {
  await teleportToTile(pageB, 22, 28); // PLAYER_SPAWN_TX/TY (mapData.ts) -- back on the open floor
  await waitForOnlineCount(pageB, 1);
  await waitForPeerChipCount(pageB, 1); // W2: B sees A's chip again
  await waitForOnlineCount(pageA, 1);
  await waitForPeerChipCount(pageA, 1); // W2: A sees B's chip again -- isolation was reversible
});

test('S6: with no LiveKit reachable, both HUDs report audio unavailable and presence stays intact', async () => {
  // W6: mic/cam disabled with the exact degradation title, on both clients,
  // while the S2 state (both online, mutually chipped) still holds.
  await waitForAudioUnavailable(pageA);
  await waitForAudioUnavailable(pageB);
  await waitForOnlineCount(pageA, 1);
  await waitForOnlineCount(pageB, 1);
  await waitForPeerChipCount(pageA, 1);
  await waitForPeerChipCount(pageB, 1);
  assert.equal(pageErrorsA.length, 0, `pageA had unhandled errors: ${pageErrorsA.join(', ')}`);
  assert.equal(pageErrorsB.length, 0, `pageB had unhandled errors: ${pageErrorsB.join(', ')}`);
});

test('S5: closing one browser context drops the other client\'s peer chip', async () => {
  await contextB.close();
  await waitForOnlineCount(pageA, 0);
  await waitForPeerChipCount(pageA, 0);
  assert.equal(pageErrorsA.length, 0, `pageA had unhandled errors: ${pageErrorsA.join(', ')}`);
});
