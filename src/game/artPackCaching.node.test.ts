/**
 * Drift guard between the art pack's URLs and the `web` container's nginx
 * config. Vite bundles under `/assets/` carry a content hash in their names,
 * so nginx marks that prefix `immutable` for a year. The pack lives under the
 * same prefix with stable names (`assets/pack/manifest.json`,
 * `character/p01-...-walk.png`): cached that way, a later `pnpm art:export`
 * would never reach a browser that already visited, which would keep offering
 * retired pieces and slicing new frame layouts out of stale sheets.
 *
 * Same approach as `server/src/caddyRoutes.test.ts`: both sides read from
 * source text, no nginx binary.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_PACK_MANIFEST_URL } from './artPack';

const nginxConf = () => readFileSync(new URL('../../infra/gcp/docker/web-nginx.conf', import.meta.url), 'utf8');

interface PrefixLocation {
  readonly prefix: string;
  readonly body: string;
}

/** Plain prefix `location /x/ { ... }` blocks; exact (`=`) and regex ones never match a pack file here. */
function prefixLocations(source: string): PrefixLocation[] {
  const pattern = /location (\/\S*) \{([^}]*)\}/g;
  const found: PrefixLocation[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push({ prefix: match[1] as string, body: match[2] as string });
  }
  return found;
}

/** nginx picks the longest matching prefix among plain prefix locations. */
function locationFor(path: string, locations: readonly PrefixLocation[]): PrefixLocation | undefined {
  return locations
    .filter((location) => path.startsWith(location.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

describe('art pack caching in the web container', () => {
  const packDir = `/${ART_PACK_MANIFEST_URL.slice(0, ART_PACK_MANIFEST_URL.lastIndexOf('/') + 1)}`;
  const samples = [`/${ART_PACK_MANIFEST_URL}`, `${packDir}character/p01-burgundy-suit-walk.png`];

  it.each(samples)('never serves %s as immutable, so a new pack reaches every browser', (path) => {
    const location = locationFor(path, prefixLocations(nginxConf()));
    expect(location).toBeDefined();
    expect(location?.body).not.toMatch(/immutable|max-age=[1-9]/);
    expect(location?.body).toMatch(/Cache-Control "no-cache"/);
  });

  it('keeps the hashed Vite bundles cached forever', () => {
    const location = locationFor('/assets/index-abc123.js', prefixLocations(nginxConf()));
    expect(location?.body).toMatch(/immutable/);
  });
});
