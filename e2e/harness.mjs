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
import { fileURLToPath } from 'node:url';

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
    `${description} did not become ready within ${deadlineMs}ms polling ${url}: ` +
      `${lastError?.message ?? 'unknown error'}`,
  );
}

/** `vite preview` prints its serving URL on stdout; the harness treats that
 * printed URL as truth rather than assuming the requested port was honored. */
function waitForUrlOnStdout(child, description) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const timer = setTimeout(() => {
      child.stdout?.off('data', onData);
      reject(new Error(`${description} did not print its URL within ${READINESS_DEADLINE_MS}ms`));
    }, READINESS_DEADLINE_MS);

    function onData(chunk) {
      buffer += chunk.toString();
      const match = buffer.match(/https?:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve(match[0].replace(/\/+$/, ''));
      }
    }

    child.stdout?.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      reject(error);
    });
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

export async function startHarness() {
  await checkPortFree(SERVER_PORT);

  // D6: server env is scrubbed of LiveKit credentials so `/livekit/token`
  // deterministically answers 503 -- no `.env.e2e`/CI ever provides them.
  const serverEnv = { ...process.env, PORT: String(SERVER_PORT) };
  delete serverEnv.LIVEKIT_API_KEY;
  delete serverEnv.LIVEKIT_API_SECRET;

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

    const browser = await chromium.launch({ args: CHROMIUM_LAUNCH_ARGS });

    return {
      previewUrl,
      browser,
      newContext() {
        return browser.newContext();
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
