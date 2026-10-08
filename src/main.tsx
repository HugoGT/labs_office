import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { startInstallPromptCapture } from './pwa/installPromptStore';
import { registerServiceWorker } from './pwa/registerServiceWorker';

// Before React: Chromium fires `beforeinstallprompt` once, early, and the
// office that offers installing mounts much later (#13).
startInstallPromptCapture();

const container = document.getElementById('root');
if (!container) throw new Error('No se encontro el elemento #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Production builds only (#13): no worker in `pnpm dev`, where it would serve
// stale modules, nor in the instrumented E2E build (`vite.config.ts` does not
// even generate one there). Both flags are build-time literals, so the
// registration is dead code outside `pnpm build`. After `load`, so the
// worker's precache downloads do not compete with the page's own.
if (import.meta.env.PROD && !__OFFICE_E2E__ && 'serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => void registerServiceWorker(navigator.serviceWorker),
    { once: true },
  );
}
