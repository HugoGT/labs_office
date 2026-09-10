// Absence proof for the test-only positioning hook (D3). Scans the shipped
// production bundle for the hook's sentinels and asserts they are gone, then
// scans the instrumented E2E bundle for the same sentinels as a positive
// control -- without it, a typo in the glob would make the absence assertion
// on `dist/` vacuous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Sentinels that only `officeTestHook.ts` and its guarded call sites ever contain. */
const SENTINELS = ['__officeE2E', 'teleportToTile'];

function findJsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function countSentinelOccurrences(dir, sentinel) {
  let count = 0;
  for (const file of findJsFiles(dir)) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(new RegExp(sentinel, 'g'));
    if (matches) count += matches.length;
  }
  return count;
}

function requireBuildDir(dir, buildCommand) {
  if (!existsSync(dir)) {
    throw new Error(`Missing build output at "${dir}". Run \`${buildCommand}\` before this test.`);
  }
}

test('production bundle (dist) contains neither E2E sentinel', () => {
  const distDir = path.join(projectRoot, 'dist');
  requireBuildDir(distDir, 'pnpm build');

  for (const sentinel of SENTINELS) {
    const count = countSentinelOccurrences(distDir, sentinel);
    assert.equal(
      count,
      0,
      `Expected 0 occurrences of "${sentinel}" in dist/**/*.js, found ${count}. The E2E test hook leaked into the production bundle.`,
    );
  }
});

test('instrumented bundle (dist-e2e) contains both E2E sentinels (positive control)', () => {
  const distE2eDir = path.join(projectRoot, 'dist-e2e');
  requireBuildDir(distE2eDir, 'pnpm build:e2e');

  for (const sentinel of SENTINELS) {
    const count = countSentinelOccurrences(distE2eDir, sentinel);
    assert.ok(
      count >= 1,
      `Expected at least 1 occurrence of "${sentinel}" in dist-e2e/**/*.js, found 0. ` +
        'Without this positive control, the absence assertion on dist/ would be vacuous.',
    );
  }
});
