/**
 * Guards the service worker contract of #13: it precaches the hashed bundles
 * and nothing else, never answers a navigation (so a page always boots the
 * deployed index.html, never the one of an older deploy), and goes away in
 * the E2E build.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PWA_ICONS } from './icons.ts';
import { PWA_MANIFEST, pwaOptions } from './pwaOptions.ts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

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

  it('precaches the hashed bundles but never the art pack, whose names are stable', () => {
    expect(workbox.globPatterns).toEqual(['**/*.{js,css}']);
    expect(workbox.globIgnores).toEqual(expect.arrayContaining(['assets/pack/**']));
  });

  it('never answers a navigation: every load boots the deployed index.html, not an older one', () => {
    // vite-plugin-pwa defaults the fallback to index.html; only an explicit null turns it off.
    expect(workbox).toHaveProperty('navigateFallback', null);
    expect(workbox.navigateFallbackDenylist).toBeUndefined();
    // A precached index.html would still answer `/` through Workbox's directoryIndex.
    expect(workbox.globPatterns?.some((pattern) => pattern.includes('html'))).toBe(false);
  });
});
