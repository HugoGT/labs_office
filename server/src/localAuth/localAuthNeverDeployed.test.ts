/**
 * Local auth is for a developer's machine and test environments only. The
 * deployed stack must never be able to turn it on: neither the VM compose nor
 * the deploy workflow may pass its variables, so a stray value in some `.env`
 * can never reach production. Same source-text approach as `caddyRoutes.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DEPLOYED_FILES = [
  '../../../infra/gcp/docker-compose.yml',
  '../../../.github/workflows/deploy-test.yml',
];

describe('local auth never reaches the deployed stack', () => {
  it.each(DEPLOYED_FILES)('%s passes no local auth variable', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(source).not.toMatch(/LOCAL_AUTH_|VITE_AUTH_MODE/);
  });
});
