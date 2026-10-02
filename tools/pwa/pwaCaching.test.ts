/**
 * Drift guard between the PWA files and the `web` container's nginx config
 * (#13), from source text like `src/game/artPackCaching.node.test.ts`.
 *
 * `sw.js` is how a deploy reaches an installed app: cached by HTTP, browsers
 * would keep checking an old worker against itself and never see the new
 * build. The manifest and icons keep stable names too. All of them must
 * revalidate, and the manifest must carry its own media type, which
 * installability checks read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PWA_ICONS } from './pwaIcons.ts';
import { SERVICE_WORKER_URL } from '../../src/pwa/registerServiceWorker.ts';

const nginxConf = () => readFileSync(new URL('../../infra/gcp/docker/web-nginx.conf', import.meta.url), 'utf8');

interface Location {
  readonly exact: boolean;
  readonly path: string;
  readonly body: string;
}

/** `location = /x { ... }` and `location /x/ { ... }` blocks, nested `types { }` included. */
function locations(source: string): Location[] {
  const pattern = /location (=\s*)?(\/\S*) \{((?:[^{}]|\{[^{}]*\})*)\}/g;
  return [...source.matchAll(pattern)].map((match) => ({
    exact: Boolean(match[1]),
    path: match[2] as string,
    body: match[3] as string,
  }));
}

/** nginx: an exact match wins outright, otherwise the longest matching prefix. */
function locationFor(path: string, all: readonly Location[]): Location | undefined {
  return (
    all.find((location) => location.exact && location.path === path) ??
    all
      .filter((location) => !location.exact && path.startsWith(location.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
  );
}

describe('PWA files in the web container', () => {
  const samples = [SERVICE_WORKER_URL, '/manifest.webmanifest', ...PWA_ICONS.map((icon) => icon.src)];

  it.each(samples)('revalidates %s on every request and never falls back to index.html', (path) => {
    const location = locationFor(path, locations(nginxConf()));
    expect(location, `no dedicated location for ${path}`).toBeDefined();
    expect(location?.path).not.toBe('/');
    expect(location?.body).toMatch(/add_header Cache-Control "no-cache";/);
    expect(location?.body).not.toMatch(/immutable|max-age=[1-9]/);
    expect(location?.body).toMatch(/try_files \$uri =404;/);
  });

  it('serves the manifest as application/manifest+json', () => {
    const location = locationFor('/manifest.webmanifest', locations(nginxConf()));
    expect(location?.body).toMatch(/types \{\s*application\/manifest\+json\s+webmanifest;\s*\}/);
  });
});
