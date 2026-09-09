import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { AccessToken } from 'livekit-server-sdk';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Lee `infra/livekit/.env` para mintar tokens reales desde un comando de
 * Vitest Browser (Node), nunca desde el navegador: el secreto no debe
 * entrar al bundle de la pagina de prueba. Usado solo por
 * `livekitRoom.browser.test.ts`, gateado tras `VITE_LIVEKIT_E2E` (slice 1
 * ADJUST (b): las flags de dispositivo falso SI son configurables aqui, pero
 * sigue haciendo falta un LiveKit real -- sin provision de Docker en CI).
 */
function loadLivekitEnv(): Record<string, string> {
  try {
    const content = readFileSync(new URL('./infra/livekit/.env', import.meta.url), 'utf8');
    const vars: Record<string, string> = {};
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return vars;
  } catch {
    return {};
  }
}

// PRD 6.1: Vite + React + TypeScript. El plugin PWA se agrega en Fase 1 (PRD seccion 9).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  // Sin esto, la primera corrida de `pnpm test:browser` que toca
  // `livekitRoom.ts` re-optimiza dependencias a mitad de ejecucion y Vite
  // recarga el test, con el aviso "unexpectedly reloaded a test" de Vitest.
  optimizeDeps: { include: ['livekit-client'] },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Phaser pesa ~1.3 MB por si mismo: en su propio chunk el codigo de la app
    // se revalida sin reenviar el motor.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'phaser', test: /[\\/]node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
  },
  test: {
    // Dos capas deliberadas. jsdom no implementa canvas ni WebGL, asi que todo lo
    // que necesita que Phaser *renderice* de verdad vive en la capa `browser`;
    // mockearlo en jsdom solo probaria el mock.
    projects: [
      {
        test: {
          name: { label: 'unit', color: 'cyan' },
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.{ts,tsx}', 'src/**/*.node.test.ts'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        test: {
          // Tercera capa: lo que necesita un servidor Colyseus real y por tanto
          // Node. Incluye el envoltorio de cliente de `src/`, porque su unico
          // riesgo serio es el protocolo por cable y ese solo se prueba
          // hablando con un servidor de verdad.
          name: { label: 'server', color: 'yellow' },
          environment: 'node',
          include: ['server/**/*.test.ts', 'src/**/*.node.test.ts'],
        },
      },
      {
        test: {
          name: { label: 'browser', color: 'magenta' },
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            // Slice 1 ADJUST (b): estas flags SI son configurables bajo
            // @vitest/browser-playwright 4.1.11 (contra lo que asumia el
            // diseno original) -- confirmadas por ejecucion, no documentacion.
            // Habilitan camara/microfono falsos para livekitRoom.browser.test.ts
            // sin afectar al resto de la capa `browser` (nadie mas pide medios).
            provider: playwright({
              launchOptions: {
                args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
              },
              contextOptions: { permissions: ['microphone', 'camera'] },
            }),
            instances: [{ browser: 'chromium' }],
            commands: {
              /**
               * Mintea un token de LiveKit real desde Node (nunca desde el
               * navegador: el secreto no debe llegar al bundle de la pagina
               * de prueba). Requiere `infra/livekit/.env` con credenciales
               * validas y el stack de Docker levantado -- solo se invoca
               * cuando `VITE_LIVEKIT_E2E` habilita el describe.
               */
              async mintLivekitToken(_context, identity: string, room: string) {
                const env = loadLivekitEnv();
                const apiKey = env.LIVEKIT_API_KEY;
                const apiSecret = env.LIVEKIT_API_SECRET;
                if (!apiKey || !apiSecret) {
                  throw new Error(
                    'Faltan LIVEKIT_API_KEY/LIVEKIT_API_SECRET en infra/livekit/.env',
                  );
                }
                const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '10m' });
                at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
                return at.toJwt();
              },
            },
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      // Los dos arranques quedan fuera del reporte: `main.tsx` se cubre por su
      // propio test y `server/src/main.ts` solo lee el puerto y llama a
      // `createOfficeServer`, que si esta cubierto.
      exclude: ['src/test/**', 'src/vite-env.d.ts', 'server/src/main.ts'],
    },
  },
});
