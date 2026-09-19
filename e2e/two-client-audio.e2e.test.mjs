// Real-LiveKit two-client audio E2E (spec "remote-audio-playback" and the
// "livekit-subscription-reconciliation" amendment; design D5/D6/D7). Every
// test here is skipped unless `VITE_LIVEKIT_E2E` is set. Requires
// `docker compose up -d redis livekit` in `infra/livekit/` and its `.env`
// populated with real `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`. Runs in CI via
// `pnpm test:e2e:audio` (D7), gated behind a real, reachable LiveKit server --
// never part of the credential-free `pnpm test:e2e` step (D6).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enableMic,
  getOwnSessionId,
  startHarness,
  teleportToTile,
  waitForAudioAvailable,
  waitForNoPeerAudio,
  waitForOnlineCount,
  waitForPeerAudioPlaying,
  waitForRoomIndicator,
} from './harness.mjs';

const AUDIO_E2E_ENABLED = Boolean(process.env.VITE_LIVEKIT_E2E);

/** @type {Awaited<ReturnType<typeof startHarness>>} */
let harness;
let contextA;
let contextB;
let pageA;
let pageB;
/** A's and B's own Colyseus/LiveKit session ids -- exactly the identities the
 * OTHER client's remote `<audio data-session-id>` must carry. */
let peerAId;
let peerBId;
/**
 * D5: `node:test` runs tests independently, so a failing scenario does not
 * stop the next one from running. The unsubscribe scenario below depends on
 * the control scenario having actually proven A hears B first -- asserted
 * explicitly instead of assumed from declaration order.
 */
let playbackProvenFor = null;

before(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  harness = await startHarness({ realLivekit: true, fakeMedia: true });

  // D6: A connects and publishes FIRST, deterministically. B is therefore
  // unambiguously the newcomer against an already-publishing A -- a fixed,
  // always-same arrival order would only ever exercise one direction and
  // could pass while the newcomer-never-subscribes asymmetry is present.
  contextA = await harness.newContext();
  pageA = await contextA.newPage();
  await pageA.goto(harness.previewUrl);
  await waitForAudioAvailable(pageA);
  // Click real de Playwright, no `page.evaluate`: es el gesto de usuario que
  // la politica de autoplay acepta sin discusion. Ver `enableMic` en
  // `harness.mjs` para lo que aqui NO se afirma.
  await enableMic(pageA);

  contextB = await harness.newContext();
  pageB = await contextB.newPage();
  await pageB.goto(harness.previewUrl);
  await waitForAudioAvailable(pageB);
  await enableMic(pageB);

  await waitForOnlineCount(pageA, 1);
  await waitForOnlineCount(pageB, 1);

  peerAId = await getOwnSessionId(pageA);
  peerBId = await getOwnSessionId(pageB);
  assert.ok(
    typeof peerAId === 'string' && peerAId.length > 0,
    'expected pageA to report its own session id via lastVoice()',
  );
  assert.ok(
    typeof peerBId === 'string' && peerBId.length > 0,
    'expected pageB to report its own session id via lastVoice()',
  );
});

after(async () => {
  if (!AUDIO_E2E_ENABLED) return;
  await harness?.teardown();
});

test(
  "already-present subscriber: A plays B's audio (control -- passes even against the pre-fix bug)",
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    // A was already in the room when B published: this direction was always
    // covered by `livekitRoom.ts`'s TrackPublished/ParticipantConnected
    // reconcile, even before the fix.
    await waitForPeerAudioPlaying(pageA, peerBId);
    playbackProvenFor = peerBId;
  },
);

test(
  "newcomer subscriber: B plays A's audio (the gate -- fails against the pre-fix in-flight race)",
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    // B is the newcomer: A was already publishing before B's connection
    // resolved. This is the direction obs #570 found broken (the in-flight
    // `voice` update dropped by `useProximityAudio.ts`'s stale snapshot).
    await waitForPeerAudioPlaying(pageB, peerAId);
  },
);

test(
  "selective unsubscribe: A stops hearing B once B enters a private room, both stay audio-available",
  { skip: !AUDIO_E2E_ENABLED },
  async () => {
    assert.equal(
      playbackProvenFor,
      peerBId,
      'expected the control scenario to have proven A hears B before this one runs',
    );

    await teleportToTile(pageB, 58, 20);
    await waitForRoomIndicator(pageB, 'Cafetería');

    // Absence proven only after presence was already proven for this id.
    await waitForNoPeerAudio(pageA, peerBId);
    await waitForAudioAvailable(pageA);
    await waitForAudioAvailable(pageB);
  },
);
