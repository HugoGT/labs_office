/**
 * `vite-plugin-pwa` options (#13): the web app manifest that makes the office
 * installable and the Workbox service worker generated at build time. Read by
 * `vite.config.ts`; guarded by `pwaOptions.test.ts`.
 *
 * What the service worker caches is the whole privacy story, so it is kept
 * to one rule: it precaches the hashed bundles `vite build` emits under
 * /assets/ (plus the icons and the manifest the plugin adds) and nothing
 * else. There is no runtime caching at all: every request the precache does
 * not list (the whole server API, Colyseus, LiveKit, uploaded and pending
 * art, the art pack) is never answered by the worker, so the browser sends it
 * to the network as if no worker existed. A private response cannot be
 * cached because no cache ever sees a response.
 *
 * Navigations are never answered either, index.html included: a precached
 * shell is the previous deploy's, which booted the old office and then
 * reloaded onto the new one once the new worker took over. From the network,
 * every load runs the deployed build, and the precache only saves the
 * download of bundles that did not change. Offline there is no shell, which
 * costs nothing: the office cannot work without its server.
 *
 * Updates: `autoUpdate` with `skipWaiting` + `clientsClaim`. A deploy changes
 * the bundle names, so the next load installs a new worker that precaches
 * them, activates at once and deletes every entry the new manifest dropped.
 * `cleanupOutdatedCaches` also drops caches left by older Workbox versions.
 * The page is not reloaded (`src/pwa/registerServiceWorker.ts`): it already
 * runs that build.
 */
import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa';
import { PWA_ICONS } from './pwaIcons.ts';

/** Body background of `src/index.css`: splash screen and title bar of the installed app. */
const PAGE_BACKGROUND = '#0d1117';

export const PWA_MANIFEST = {
  id: '/',
  name: 'Oficina Virtual',
  short_name: 'Oficina',
  description: 'Oficina virtual 2D con audio y video por proximidad.',
  lang: 'es',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: PAGE_BACKGROUND,
  background_color: PAGE_BACKGROUND,
  icons: PWA_ICONS.map((icon) => ({ src: icon.src, sizes: icon.sizes, type: 'image/png', purpose: icon.purpose })),
} satisfies Partial<ManifestOptions>;

export function pwaOptions(mode: string): Partial<VitePWAOptions> {
  return {
    // The E2E build gets no worker at all: Playwright drives a page whose
    // network the harness controls, never one a worker could answer.
    disable: mode === 'e2e',
    // Registered from `src/main.tsx`.
    injectRegister: false,
    registerType: 'autoUpdate',
    manifest: PWA_MANIFEST,
    workbox: {
      // No html: a precached index.html would answer `/` (Workbox's
      // directoryIndex) with the shell of the deploy that installed the worker.
      globPatterns: ['**/*.{js,css}'],
      // The art pack keeps stable names and nginx revalidates it with
      // `no-cache`; precached, a new `pnpm art:export` would wait for a
      // worker update, and it is megabytes the shell does not need to start.
      globIgnores: ['assets/pack/**'],
      // Navigations go to the network, so every load boots the deployed
      // index.html. The plugin defaults this to index.html; null turns it off.
      navigateFallback: null,
      runtimeCaching: [],
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      // One file to serve with `no-cache` (web-nginx.conf) instead of a
      // separate workbox-<hash>.js next to it.
      inlineWorkboxRuntime: true,
      sourcemap: false,
    },
  };
}
