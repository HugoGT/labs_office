// Local mux harness driver (issue #19, spec Rung B). Builds the REAL
// `infra/gcp/docker/caddy.Dockerfile` image, boots it with the REAL
// `infra/gcp/Caddyfile` against stub backends on a private Docker network,
// and runs the seven assertions the design lists.
//
// Written before the production Caddyfile change it is meant to catch
// (Phase 1 of the change): the first honest RED here is the compose build
// failing because `caddy.Dockerfile` does not exist yet. Once that exists
// (Phase 2), assertion 4 is the next RED -- `turn.*` appears nowhere in the
// pre-change Caddyfile -- until the Caddyfile itself changes (Phase 3).
//
// Never runs in CI, not even behind a path filter: the first run compiles
// Caddy with `xcaddy`, and that cost is only for whoever explicitly asks
// for `pnpm test:mux`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MUX_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = 'docker-compose.test.yml';
const READY_DEADLINE_MS = 60000;
const READY_POLL_INTERVAL_MS = 1000;

function compose(args, options = {}) {
  return spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    cwd: MUX_DIR,
    encoding: 'utf8',
    ...options,
  });
}

function describeResult(result) {
  return `exit ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

/** Runs `probe.mjs` inside the already-running `probe` container via
 * `docker compose exec`, and parses its single JSON line of output. */
function runProbe(args) {
  const result = compose([
    'exec',
    '-T',
    'probe',
    'node',
    '/harness/probe.mjs',
    ...args,
  ]);
  if (result.status !== 0 && !result.stdout.trim()) {
    throw new Error(`probe.mjs exec failed: ${describeResult(result)}`);
  }
  const line = result.stdout.trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`probe.mjs printed non-JSON output: ${describeResult(result)}`);
  }
}

let validateResult;
let upResult;

before(async () => {
  const buildResult = compose(['build']);
  assert.equal(buildResult.status, 0, `docker compose build failed:\n${describeResult(buildResult)}`);

  // Assertion 0: `caddy validate` inside the built image, before anything
  // is even started. A syntax gate for the layer4 block (design D6), run
  // here at zero marginal cost because the harness already builds the image.
  validateResult = compose([
    'run',
    '--rm',
    '--no-deps',
    'caddy',
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);

  upResult = compose(['up', '-d']);
  assert.equal(upResult.status, 0, `docker compose up failed:\n${describeResult(upResult)}`);

  // Caddy issues its internal certificates on first request per hostname;
  // poll instead of sleeping a fixed amount.
  const start = Date.now();
  let lastError;
  while (Date.now() - start < READY_DEADLINE_MS) {
    try {
      const result = runProbe(['--mode', 'tls-http', '--host', 'caddy', '--port', '443', '--servername', 'app.local.test', '--path', '/']);
      if (result.ok) return;
      lastError = new Error(JSON.stringify(result));
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  const logs = compose(['logs', 'caddy']);
  throw new Error(
    `caddy never became ready within ${READY_DEADLINE_MS}ms: ${lastError?.message}\n--- caddy logs ---\n${logs.stdout}`,
  );
});

after(async () => {
  compose(['down', '-v', '--remove-orphans']);
});

test('assertion 0: caddy validate accepts the Caddyfile', () => {
  assert.equal(
    validateResult.status,
    0,
    `caddy validate failed:\n${describeResult(validateResult)}`,
  );
});

test('assertion 1: app.* / reaches the web stub (blast-radius guard)', () => {
  const result = runProbe(['--mode', 'tls-http', '--host', 'caddy', '--port', '443', '--servername', 'app.local.test', '--path', '/']);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.status, 200);
  assert.equal(result.body.stub, 'web');
});

test('assertion 2: app.*/health reaches the colyseus stub (blast-radius guard)', () => {
  const result = runProbe(['--mode', 'tls-http', '--host', 'caddy', '--port', '443', '--servername', 'app.local.test', '--path', '/health']);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.status, 200);
  assert.equal(result.body.stub, 'colyseus');
});

test('assertion 3: lk.* reaches the LiveKit signalling stub (blast-radius guard)', () => {
  const result = runProbe(['--mode', 'tls-http', '--host', 'caddy', '--port', '443', '--servername', 'lk.local.test', '--path', '/']);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.status, 200);
  assert.equal(result.body.stub, 'lk');
});

test('assertion 4: SNI turn.* reaches the TURN stub with the real client address via PROXY v2', () => {
  const result = runProbe(['--mode', 'tls-raw', '--host', 'caddy', '--port', '443', '--servername', 'turn.local.test', '--write', 'PING\n']);
  assert.ok(result.ok, `TLS handshake to turn.local.test failed: ${JSON.stringify(result)}`);
  assert.match(result.response, /^PROXY_SRC=/, `turn-stub did not report a PROXY v2 source: ${result.response}`);
  const reportedAddr = result.response.split('=')[1];
  assert.equal(
    reportedAddr,
    result.selfAddress,
    'the TURN stub must see the probe container\'s real address, not Caddy\'s own',
  );
});

test('assertion 5: colyseus sees the real client IP via X-Forwarded-For, never 127.0.0.1 (D2 guard)', () => {
  const result = runProbe(['--mode', 'tls-http', '--host', 'caddy', '--port', '443', '--servername', 'app.local.test', '--path', '/health']);
  assert.ok(result.ok, JSON.stringify(result));
  assert.notEqual(result.body.xff, '127.0.0.1');
  assert.equal(result.body.xff, result.selfAddress);
});

test('assertion 6: http://app.* redirects to https://app.* with no :8443 suffix (D1 guard)', () => {
  const result = runProbe(['--mode', 'http', '--host', 'caddy', '--port', '80', '--servername', 'app.local.test', '--path', '/']);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.status, 308);
  assert.equal(result.location, 'https://app.local.test/');
});
