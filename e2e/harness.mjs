// Real-process E2E harness (D5/D6/D8). Boots the actual Colyseus server
// (`server/src/main.ts`) and a real `vite preview` of the instrumented
// build (`dist-e2e`), then drives independent Playwright browser contexts
// against it. Nothing in this file is mocked: readiness, port occupancy,
// and process teardown all come from a real subprocess or a real socket.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import net from 'node:net';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPreviewUrl } from './preview-url.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** D5: fixed dedicated port, baked into `.env.e2e`'s `VITE_COLYSEUS_URL`. */
const SERVER_PORT = 2599;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/health`;
const READINESS_DEADLINE_MS = 15000;
const READINESS_POLL_INTERVAL_MS = 100;
const TEARDOWN_GRACE_MS = 3000;

/** D8: disables Chromium's background-tab throttling so a second, unfocused
 * page still ticks Phaser's `update()` loop fast enough for `sendMove`. */
const CHROMIUM_LAUNCH_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/** Slice E: same fake-device recipe already used by the Vitest browser layer
 * (`vite.config.ts`'s `browser.provider` for `livekitRoom.browser.test.ts`)
 * so `connectLivekitRoom`'s `setMicrophoneEnabled`/`setCameraEnabled` can
 * actually publish against a real LiveKit server instead of rejecting for
 * lack of a real camera/mic in the sandbox. */
const FAKE_MEDIA_LAUNCH_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

/** Mirrors `vite.config.ts`'s `loadLivekitEnv()`: reads `infra/livekit/.env`
 * from Node (never from the browser bundle) to inject real LiveKit
 * credentials into the spawned server's env for Slice E's gated audio
 * harness. Returns `{}` if the file is absent -- callers decide whether
 * that is fatal. */
function loadLivekitEnv() {
  try {
    const content = readFileSync(path.join(projectRoot, 'infra', 'livekit', '.env'), 'utf8');
    const vars = {};
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return vars;
  } catch {
    return {};
  }
}

/** D5 preflight: fails fast if the fixed port is already occupied, instead
 * of the harness silently talking to someone else's server. */
function checkPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      reject(
        new Error(
          `Port ${port} is already in use. Stop whatever is listening on it ` +
            '(e.g. a stray `pnpm server`) before running the E2E harness.',
        ),
      );
    });
    socket.once('error', () => {
      socket.destroy();
      resolve();
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** D6: readiness by polling a real endpoint, never a fixed sleep. */
async function pollUntilOk(url, description, deadlineMs = READINESS_DEADLINE_MS) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < deadlineMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${description} answered with status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_INTERVAL_MS));
  }
  throw new Error(
    `${description} did not start listening within ${deadlineMs}ms polling ${url}: ` +
      `${lastError?.message ?? 'unknown error'}`,
  );
}

/**
 * `vite preview` prints its serving URL on stdout; the harness treats that
 * printed URL as truth rather than assuming the requested port was honored.
 *
 * Parsing is delegated to `extractPreviewUrl`, which waits for a terminated
 * `Local:` line and de-colors it first. A line that arrives complete but
 * unparseable rejects immediately instead of being handed to `fetch()`: that
 * is the difference between "the URL was never readable" and "the server never
 * came up", and conflating the two is what made this take three red CI runs to
 * find.
 */
function waitForUrlOnStdout(child, description) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    function cleanup() {
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('error', onError);
    }

    function succeed(url) {
      if (settled) return;
      cleanup();
      resolve(url);
    }

    function fail(error) {
      if (settled) return;
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      buffer += chunk.toString();
      let url;
      try {
        url = extractPreviewUrl(buffer);
      } catch (error) {
        fail(error);
        return;
      }
      if (url) succeed(url);
    }

    function onError(error) {
      fail(error);
    }

    const timer = setTimeout(() => {
      fail(new Error(`${description} did not print its URL within ${READINESS_DEADLINE_MS}ms`));
    }, READINESS_DEADLINE_MS);

    child.stdout?.on('data', onData);
    child.on('error', onError);
  });
}

/** D6: kills the whole process group, never just the direct child, so a
 * subprocess spawned by `vite preview`/Colyseus never survives teardown. */
function killProcessGroup(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Group already gone.
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already dead.
    }
  }, TEARDOWN_GRACE_MS).unref();
}

/**
 * @param {{ realLivekit?: boolean, fakeMedia?: boolean }} [options]
 *   `realLivekit`: inject real `LIVEKIT_API_KEY`/`SECRET` (from
 *   `infra/livekit/.env`) into the spawned server's env instead of D6's
 *   default scrub, so `/livekit/token` mints real tokens (Slice E, gated
 *   behind `VITE_LIVEKIT_E2E` at the call site, never in CI).
 *   `fakeMedia`: launch Chromium with the fake-device flags and grant
 *   mic/camera permissions on every context, so `connectLivekitRoom` can
 *   actually publish (Slice E only -- the unattended CI scenarios never
 *   need it).
 */
export async function startHarness({ realLivekit = false, fakeMedia = false } = {}) {
  await checkPortFree(SERVER_PORT);

  const serverEnv = { ...process.env, PORT: String(SERVER_PORT) };
  if (realLivekit) {
    const livekitEnv = loadLivekitEnv();
    if (!livekitEnv.LIVEKIT_API_KEY || !livekitEnv.LIVEKIT_API_SECRET) {
      throw new Error(
        'realLivekit: true but infra/livekit/.env is missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET',
      );
    }
    serverEnv.LIVEKIT_API_KEY = livekitEnv.LIVEKIT_API_KEY;
    serverEnv.LIVEKIT_API_SECRET = livekitEnv.LIVEKIT_API_SECRET;
    if (livekitEnv.LIVEKIT_URL) serverEnv.LIVEKIT_URL = livekitEnv.LIVEKIT_URL;
  } else {
    // D6: server env is scrubbed of LiveKit credentials so `/livekit/token`
    // deterministically answers 503 -- no `.env.e2e`/CI ever provides them.
    delete serverEnv.LIVEKIT_API_KEY;
    delete serverEnv.LIVEKIT_API_SECRET;
  }

  const serverProcess = spawn('node', [path.join(projectRoot, 'server', 'src', 'main.ts')], {
    cwd: projectRoot,
    env: serverEnv,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const children = [serverProcess];
  function killAll() {
    for (const child of children) killProcessGroup(child);
  }
  // D6 safety net: a mid-test throw must never leave a listener on 2599.
  process.on('exit', killAll);

  try {
    await pollUntilOk(HEALTH_URL, 'Colyseus server /health');

    const previewPort = await findFreePort();
    const previewProcess = spawn(
      path.join(projectRoot, 'node_modules', '.bin', 'vite'),
      ['preview', '--outDir', 'dist-e2e', '--port', String(previewPort), '--strictPort'],
      {
        cwd: projectRoot,
        detached: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(previewProcess);

    const previewUrl = await waitForUrlOnStdout(previewProcess, 'vite preview');
    await pollUntilOk(previewUrl, 'vite preview');

    const launchArgs = fakeMedia
      ? [...CHROMIUM_LAUNCH_ARGS, ...FAKE_MEDIA_LAUNCH_ARGS]
      : CHROMIUM_LAUNCH_ARGS;
    const browser = await chromium.launch({ args: launchArgs });

    return {
      previewUrl,
      browser,
      newContext() {
        return browser.newContext(fakeMedia ? { permissions: ['microphone', 'camera'] } : {});
      },
      async teardown() {
        process.off('exit', killAll);
        await browser.close();
        killAll();
      },
    };
  } catch (error) {
    process.off('exit', killAll);
    killAll();
    throw error;
  }
}

// D7: wait predicates keyed on HUD text (CSS module class names are hashed
// and duplicated, so identity has to come from what is actually rendered).
export async function waitForOnlineCount(page, count) {
  await page.waitForFunction(
    (n) => {
      const text = document.querySelector('#office-shell')?.textContent ?? '';
      return new RegExp(`\u{1F7E2} ${n} en línea`, 'u').test(text);
    },
    count,
    { timeout: READINESS_DEADLINE_MS },
  );
}

export async function waitForPeerChipCount(page, count) {
  await page.waitForFunction(
    (n) => {
      const text = document.querySelector('#office-shell')?.textContent ?? '';
      const matches = text.match(/\u{1F50A} HugoGT/gu) ?? [];
      return matches.length === n;
    },
    count,
    { timeout: READINESS_DEADLINE_MS },
  );
}

/** D4: drives the local player onto a tile through the gated `__officeE2E`
 * test hook, bypassing keyboard input. */
export async function teleportToTile(page, tx, ty) {
  await page.evaluate(
    ([x, y]) => window.__officeE2E.teleportToTile(x, y),
    [tx, ty],
  );
}

/** D7 W3: the private-room indicator (`BottomBar.tsx`) names the room the
 * local player is currently inside. */
export async function waitForRoomIndicator(page, roomName) {
  await page.waitForFunction(
    (name) => {
      const text = document.querySelector('#office-shell')?.textContent ?? '';
      return text.includes(`\u{1F512} Sala privada: ${name}`);
    },
    roomName,
    { timeout: READINESS_DEADLINE_MS },
  );
}

/** D7 W6: mic/cam buttons carry `disabled` + the exact degradation title
 * (`BottomBar.tsx`'s `AUDIO_UNAVAILABLE_TITLE`) while LiveKit is unreachable.
 * Attribute checks can't key on `#office-shell` textContent alone (D7's other
 * predicates), so this walks the real button elements instead of the hashed
 * CSS module classes. */
export async function waitForAudioUnavailable(page) {
  await page.waitForFunction(
    () => {
      const title = 'Audio no disponible: sin conexion a LiveKit';
      const buttons = Array.from(document.querySelectorAll('#office-shell button'));
      const mic = buttons.find((button) => button.textContent?.includes('Mic'));
      const cam = buttons.find((button) => button.textContent?.includes('Cámara'));
      if (!mic || !cam) return false;
      return mic.disabled && mic.title === title && cam.disabled && cam.title === title;
    },
    undefined,
    { timeout: READINESS_DEADLINE_MS },
  );
}

// --- Slice E: gated real-LiveKit audio subscription ------------------------
// Reads the gated test-only hook's `lastVoice()` (D4), the same event object
// `useProximityAudio.ts` consumes to drive `connectLivekitRoom`'s
// `setDesiredPeers`. Only meaningful with `startHarness({ realLivekit: true,
// fakeMedia: true })` and a real LiveKit server reachable.

/** The page's own Colyseus/LiveKit identity -- exactly the id the *other*
 * client's audible set must contain while both are on the open floor. */
export async function getOwnSessionId(page) {
  return page.evaluate(() => window.__officeE2E?.lastVoice()?.selfSessionId ?? null);
}

/** Inverse of `waitForAudioUnavailable`: mic/cam enabled, no degradation title. */
export async function waitForAudioAvailable(page) {
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll('#office-shell button'));
      const mic = buttons.find((button) => button.textContent?.includes('Mic'));
      const cam = buttons.find((button) => button.textContent?.includes('Cámara'));
      if (!mic || !cam) return false;
      return !mic.disabled && !cam.disabled;
    },
    undefined,
    { timeout: READINESS_DEADLINE_MS },
  );
}

/** `hook.lastVoice().sessionIds` contains `sessionId` (presence). */
export async function waitForAudibleSessionId(page, sessionId) {
  await page.waitForFunction(
    (id) => (window.__officeE2E?.lastVoice()?.sessionIds ?? []).includes(id),
    sessionId,
    { timeout: READINESS_DEADLINE_MS },
  );
}

/** `hook.lastVoice().sessionIds` no longer contains `sessionId` (absence). */
export async function waitForNoAudibleSessionId(page, sessionId) {
  await page.waitForFunction(
    (id) => !(window.__officeE2E?.lastVoice()?.sessionIds ?? []).includes(id),
    sessionId,
    { timeout: READINESS_DEADLINE_MS },
  );
}
