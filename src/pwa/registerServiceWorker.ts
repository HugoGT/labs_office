/**
 * Registers the Workbox service worker that `vite-plugin-pwa` generates
 * (#13, strategy in `tools/pwa/pwaOptions.ts`) and moves the page onto a new
 * version once that version takes control.
 *
 * The worker activates at once (`skipWaiting` + `clientsClaim`) and deletes
 * the previous build's bundles from its cache, so a page still running the
 * old build could ask for a lazy chunk that no longer exists anywhere. The
 * reload avoids that. It happens right after a load that found a new deploy,
 * since the browser only looks for a new `sw.js` on navigation and this SPA
 * never navigates: nobody is reloaded out of a call that is already going.
 *
 * The very first worker also claims the page, but that page already runs the
 * current build, so it is not reloaded.
 */

export interface ServiceWorkerHost {
  readonly controller: object | null;
  register(url: string, options: { scope: string }): Promise<unknown>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export const SERVICE_WORKER_URL = '/sw.js';

export async function registerServiceWorker(host: ServiceWorkerHost, reload: () => void): Promise<void> {
  let current = host.controller;
  let reloading = false;
  host.addEventListener('controllerchange', () => {
    const replaced = current !== null;
    current = host.controller;
    if (!replaced || reloading) return;
    reloading = true;
    reload();
  });
  try {
    await host.register(SERVICE_WORKER_URL, { scope: '/' });
  } catch (error) {
    // Not installable (plain HTTP, private window with storage blocked): the
    // office works exactly as without a worker.
    console.warn('No se pudo registrar el service worker', error);
  }
}
