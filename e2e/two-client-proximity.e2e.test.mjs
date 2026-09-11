// Two-client proximity E2E (D5/D6/D7/D8). Drives two independent Playwright
// browser contexts against the real instrumented bundle (`dist-e2e`) and the
// real Colyseus server, asserting only on rendered HUD text -- never on
// hashed CSS class names or peer identity (both clients render `HugoGT`).
//
// Slice C adds S3 (entering a private room isolates the occupant from the
// open-floor peer, mutually) and S4 (leaving the room reverses isolation).
// S1 lives in `bundle-hook-absent.e2e.test.mjs`; S6 lands in a later slice.
import { after, before, test } from 'node:test';
import {
  startHarness,
  teleportToTile,
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

before(async () => {
  harness = await startHarness();
  contextA = await harness.newContext();
  contextB = await harness.newContext();
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
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

test('S5: closing one browser context drops the other client\'s peer chip', async () => {
  await contextB.close();
  await waitForOnlineCount(pageA, 0);
  await waitForPeerChipCount(pageA, 0);
});
