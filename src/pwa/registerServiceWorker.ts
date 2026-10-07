/**
 * Registers the Workbox service worker that `vite-plugin-pwa` generates
 * (#13, strategy in `tools/pwa/pwaOptions.ts`).
 *
 * The worker never answers a navigation, so every load already boots the
 * deployed index.html and its bundles. A new worker activating afterwards
 * (`skipWaiting` + `clientsClaim`) only refreshes the precache of a page that
 * runs the current build, so nothing reloads. Reloading here used to show
 * the office twice after every deploy: once from the previous deploy's
 * precached shell, then again from the new one.
 */

export interface ServiceWorkerHost {
  register(url: string, options: { scope: string }): Promise<unknown>;
}

export const SERVICE_WORKER_URL = '/sw.js';

export async function registerServiceWorker(host: ServiceWorkerHost): Promise<void> {
  try {
    await host.register(SERVICE_WORKER_URL, { scope: '/' });
  } catch (error) {
    // Not installable (plain HTTP, private window with storage blocked): the
    // office works exactly as without a worker.
    console.warn('No se pudo registrar el service worker', error);
  }
}
