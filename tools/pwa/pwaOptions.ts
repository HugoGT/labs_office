/**
 * `vite-plugin-pwa` options (#13): the web app manifest that makes the office
 * installable and the Workbox service worker generated at build time. Read by
 * `vite.config.ts`; guarded by `pwaOptions.test.ts`.
 *
 * What the service worker caches is the whole privacy story, so it is kept
 * to one rule: it precaches the files `vite build` emits (index.html, the
 * hashed bundles under /assets/, the icons and the manifest) and nothing else.
 * There is no runtime caching at all: every request the precache does not
 * list (the whole server API, Colyseus, LiveKit, uploaded and pending art,
 * the art pack) is never answered by the worker, so the browser sends it to
 * the network as if no worker existed. A private response cannot be cached
 * because no cache ever sees a response.
 *
 * Updates: `autoUpdate` with `skipWaiting` + `clientsClaim`. A deploy changes
 * index.html's revision and the bundle names, so the next load installs a new
 * worker that precaches the new shell, activates at once (no waiting until
 * every tab closes) and deletes every entry the new manifest dropped, which
 * is how no stale bundle stays behind. `cleanupOutdatedCaches` also drops
 * caches left by older Workbox versions. The page then reloads once onto the
 * new shell (`src/pwa/registerServiceWorker.ts`). The prompt strategy was
 * rejected: a tab nobody reloads would keep running a deleted build, and the
 * office has no screen to ask from.
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

/**
 * First path segments the `web` container never answers with the SPA: every
 * server route (`server/src/createOfficeServer.ts`, routed by the Caddyfile),
 * Colyseus matchmaking, and /assets/ (Vite bundles, the art pack and uploaded
 * art are files, never pages). `pwaOptions.test.ts` reads both source files,
 * so a new server route without its prefix here fails there.
 */
const SERVER_PATH_PREFIXES = ['admin', 'assets', 'desks', 'health', 'livekit', 'matchmake', 'me', 'recordings', 'spaces'];

/**
 * Navigations the worker must leave to the network instead of answering with
 * the precached index.html. Workbox tests them against `pathname + search`.
 * Without this, opening a server URL in a tab (a signed recording link, a
 * private art preview under /me/art/files/) would show the office instead.
 * Any path with a file extension (sw.js, the manifest, icons) is a file too.
 */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  new RegExp(`^/(?:${SERVER_PATH_PREFIXES.join('|')})(?:[/?]|$)`),
  /^\/[^?]*\.[A-Za-z0-9]+(?:\?|$)/,
];

export function pwaOptions(mode: string): Partial<VitePWAOptions> {
  return {
    // The E2E build gets no worker at all: Playwright drives a page whose
    // network the harness controls, never one a worker could answer.
    disable: mode === 'e2e',
    // Registered from `src/main.tsx`, which also reloads onto a new version.
    injectRegister: false,
    registerType: 'autoUpdate',
    manifest: PWA_MANIFEST,
    workbox: {
      globPatterns: ['**/*.{js,css,html}'],
      // The art pack keeps stable names and nginx revalidates it with
      // `no-cache`; precached, a new `pnpm art:export` would wait for a
      // worker update, and it is megabytes the shell does not need to start.
      globIgnores: ['assets/pack/**'],
      navigateFallback: 'index.html',
      navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
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
