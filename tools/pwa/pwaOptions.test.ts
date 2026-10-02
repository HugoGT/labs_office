/**
 * Guards the service worker contract of #13: it precaches the app shell and
 * nothing else, never answers a server route with the SPA, and goes away in
 * the E2E build. Server routes come from source text, like
 * `server/src/caddyRoutes.test.ts`, so a new route cannot slip past it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PWA_ICONS } from './icons.ts';
import { NAVIGATE_FALLBACK_DENYLIST, PWA_MANIFEST, pwaOptions } from './pwaOptions.ts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function serverRoutes(): string[] {
  const routes: string[] = [];
  const pattern = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(read('server/src/createOfficeServer.ts'))) !== null) {
    routes.push((match[2] as string).replace(/:[A-Za-z]+/g, 'x1'));
  }
  return [...new Set(routes)];
}

/** Every Caddy `handle` path sends its traffic to the server, never to the `web` container. */
function caddyServerPaths(): string[] {
  const paths: string[] = [];
  const pattern = /handle (\/\S+) \{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(read('infra/gcp/Caddyfile'))) !== null) {
    paths.push((match[1] as string).replace(/\*$/, 'x1'));
  }
  return paths;
}

/** Workbox's NavigationRoute tests the denylist against `pathname + search`. */
const denied = (pathAndSearch: string) => NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathAndSearch));

describe('web app manifest', () => {
  it('describes an installable, standalone Spanish app rooted at /', () => {
    expect(PWA_MANIFEST).toMatchObject({
      name: 'Oficina Virtual',
      short_name: 'Oficina',
      lang: 'es',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(PWA_MANIFEST.description).toBeTruthy();
  });

  it('paints the splash and title bar with the page background of src/index.css', () => {
    const background = /html, body, #root \{[^}]*background: (#[0-9a-f]{6});/i.exec(read('src/index.css'))?.[1];
    expect(background).toBeDefined();
    expect(PWA_MANIFEST.theme_color).toBe(background);
    expect(PWA_MANIFEST.background_color).toBe(background);
  });

  it('lists every generated icon', () => {
    expect(PWA_MANIFEST.icons).toEqual(
      PWA_ICONS.map((icon) => ({ src: icon.src, sizes: icon.sizes, type: 'image/png', purpose: icon.purpose })),
    );
  });

  it('uses the same theme color and touch icon in index.html', () => {
    const html = read('index.html');
    expect(html).toContain(`<meta name="theme-color" content="${PWA_MANIFEST.theme_color}" />`);
    expect(html).toContain(`<link rel="apple-touch-icon" href="${PWA_ICONS[0]?.src}" />`);
  });
});

describe('service worker', () => {
  const options = pwaOptions('production');
  const workbox = options.workbox ?? {};

  it('is built for production and left out of the E2E build', () => {
    expect(options.disable).toBe(false);
    expect(pwaOptions('e2e').disable).toBe(true);
  });

  it('is registered by the app, not by a script the plugin injects', () => {
    expect(options.injectRegister).toBe(false);
  });

  it('replaces the previous version as soon as a deploy reaches the browser', () => {
    expect(options.registerType).toBe('autoUpdate');
    expect(workbox).toMatchObject({ skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true });
  });

  it('caches no response at runtime: only the precached app shell is ever served from cache', () => {
    expect(workbox.runtimeCaching ?? []).toEqual([]);
  });

  it('precaches the built shell but never the art pack, whose names are stable', () => {
    expect(workbox.globPatterns).toEqual(expect.arrayContaining(['**/*.{js,css,html}']));
    expect(workbox.globIgnores).toEqual(expect.arrayContaining(['assets/pack/**']));
  });

  it('answers SPA navigations with the precached index.html', () => {
    expect(workbox.navigateFallback).toBe('index.html');
    expect(workbox.navigateFallbackDenylist).toBe(NAVIGATE_FALLBACK_DENYLIST);
  });
});

describe('navigation fallback denylist', () => {
  it('finds server routes and Caddy handles to check (guards against a broken extractor)', () => {
    expect(serverRoutes().length).toBeGreaterThan(20);
    expect(caddyServerPaths().length).toBeGreaterThan(10);
  });

  it.each(serverRoutes())('lets the server answer %s', (route) => {
    expect(denied(route)).toBe(true);
    expect(denied(`${route}?x=1`)).toBe(true);
  });

  it.each(caddyServerPaths())('lets the server answer the Caddy handle %s', (path) => {
    expect(denied(path)).toBe(true);
  });

  it.each([
    '/matchmake/joinOrCreate/office',
    '/me/art/files/0123abcd.png',
    '/assets/files/0123abcd.png',
    '/assets/pack/manifest.json',
    '/assets/index-abc123.js',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
  ])('never answers %s with index.html', (path) => {
    expect(denied(path)).toBe(true);
  });

  it.each(['/', '/?invite=1', '/dashboard', '/dashboard/', '/Dashboard', '/admins', '/medley'])(
    'keeps %s an SPA navigation',
    (path) => {
      expect(denied(path)).toBe(false);
    },
  );
});
