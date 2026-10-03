// Build-output proof for the PWA (#13): the production build ships a service
// worker whose precache is exactly the app shell (every hashed bundle, never
// the art pack or a source map) and registers it; the instrumented E2E build
// ships neither, so Playwright never talks to a page a worker could answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const distE2eDir = path.join(projectRoot, 'dist-e2e');

function requireBuildDir(dir, buildCommand) {
  if (!existsSync(dir)) {
    throw new Error(`Missing build output at "${dir}". Run \`${buildCommand}\` before this test.`);
  }
}

/** The URLs Workbox inlined into sw.js as `{url:"...",revision:...}` entries. */
function precachedUrls(swSource) {
  return [...swSource.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
}

/** Top-level files of dist/assets/: the Vite bundles (the art pack lives in a subfolder). */
function bundleFiles(dir) {
  return readdirSync(path.join(dir, 'assets'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|css)$/.test(entry.name))
    .map((entry) => `assets/${entry.name}`);
}

function bundlesMention(dir, text) {
  return bundleFiles(dir).some((file) => readFileSync(path.join(dir, file), 'utf8').includes(text));
}

test('production build precaches the whole app shell and nothing else', () => {
  requireBuildDir(distDir, 'pnpm build');
  const urls = precachedUrls(readFileSync(path.join(distDir, 'sw.js'), 'utf8'));

  assert.ok(urls.includes('index.html'), 'index.html must be precached for the navigation fallback');
  assert.ok(urls.includes('manifest.webmanifest'));
  for (const bundle of bundleFiles(distDir)) {
    assert.ok(urls.includes(bundle), `${bundle} is missing from the precache`);
  }
  for (const url of urls) {
    assert.ok(!url.startsWith('assets/pack/'), `art pack file ${url} must not be precached`);
    assert.ok(!url.endsWith('.map'), `source map ${url} must not be precached`);
    assert.ok(existsSync(path.join(distDir, url)), `precached ${url} does not exist in dist/`);
  }
});

test('production build links a valid manifest and registers the worker', () => {
  requireBuildDir(distDir, 'pnpm build');
  const manifest = JSON.parse(readFileSync(path.join(distDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(path.join(distDir, icon.src)), `manifest icon ${icon.src} is missing from dist/`);
  }
  assert.match(readFileSync(path.join(distDir, 'index.html'), 'utf8'), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.ok(bundlesMention(distDir, '/sw.js'), 'no bundle registers /sw.js');
});

test('instrumented E2E build has no worker, no manifest and no registration', () => {
  requireBuildDir(distE2eDir, 'pnpm build:e2e');
  assert.ok(!existsSync(path.join(distE2eDir, 'sw.js')));
  assert.ok(!existsSync(path.join(distE2eDir, 'manifest.webmanifest')));
  assert.doesNotMatch(readFileSync(path.join(distE2eDir, 'index.html'), 'utf8'), /rel="manifest"/);
  assert.ok(!bundlesMention(distE2eDir, '/sw.js'), 'the E2E bundle registers a service worker');
});
