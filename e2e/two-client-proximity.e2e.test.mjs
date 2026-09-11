// Two-client proximity E2E (D5/D6/D7/D8). Drives two independent Playwright
// browser contexts against the real instrumented bundle (`dist-e2e`) and the
// real Colyseus server, asserting only on rendered HUD text -- never on
// hashed CSS class names or peer identity (both clients render `HugoGT`).
//
// Slice B scope: S2 (mutual presence at spawn) and S5 (disconnect drops the
// peer chip). S1 lives in `bundle-hook-absent.e2e.test.mjs`; S3/S4/S6 land in
// later slices.
import { after, before, test } from 'node:test';
import { startHarness, waitForOnlineCount, waitForPeerChipCount } from './harness.mjs';

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

test('S5: closing one browser context drops the other client\'s peer chip', async () => {
  await contextB.close();
  await waitForOnlineCount(pageA, 0);
  await waitForPeerChipCount(pageA, 0);
});
