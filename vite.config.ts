import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { AccessToken } from 'livekit-server-sdk';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
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
export default defineConfig(({ mode }) => {
  /**
   * D2: `VITE_E2E_HOOK` se lee aqui, en tiempo de config (Node), y no via
   * `import.meta.env` en codigo de aplicacion. Una clave `VITE_*` sin definir
   * no la reemplaza estaticamente Rolldown, asi que su eliminacion de codigo
   * muerto dependeria del minificador. `define` compila la guarda a un
   * literal `if (false)` en todos los modos salvo `e2e` (`.env.e2e`), y eso
   * si lo elimina cualquier minificador. Vitest carga esta misma config con
   * `mode: 'test'`, asi que ninguna capa de test ve el hook expuesto.
   */
  const env = loadEnv(mode, process.cwd(), '');
  const officeE2eDefine = { __OFFICE_E2E__: JSON.stringify(env.VITE_E2E_HOOK === '1') };

  return {
    plugins: [react()],
    server: { port: 5173, host: true },
    // Sin esto, la primera corrida de `pnpm test:browser` que toca
    // `livekitRoom.ts` re-optimiza dependencias a mitad de ejecucion y Vite
    // recarga el test, con el aviso "unexpectedly reloaded a test" de Vitest.
    optimizeDeps: { include: ['livekit-client'] },
    define: officeE2eDefine,
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
          // `test.projects` no hereda el `define` de la raiz (verificado en
          // implementacion: sin esto, `__OFFICE_E2E__` explota con
          // `ReferenceError` al montarse `OfficeShell` bajo jsdom). Cada
          // proyecto es una config de Vite casi independiente y necesita el
          // suyo.
          define: officeE2eDefine,
          test: {
            name: { label: 'unit', color: 'cyan' },
            environment: 'jsdom',
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: ['src/**/*.browser.test.{ts,tsx}', 'src/**/*.node.test.ts'],
            setupFiles: ['./src/test/officeE2eGlobal.setup.ts', './src/test/setup.ts'],
          },
        },
        {
          define: officeE2eDefine,
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
          define: officeE2eDefine,
          test: {
            name: { label: 'browser', color: 'magenta' },
            include: ['src/**/*.browser.test.{ts,tsx}'],
            // Scene waits get 20s (`SCENE_BOOT_TIMEOUT_MS`, `LOOP_WAIT`) because
            // the CI main thread stalls for whole seconds (#68). Under the 5s
            // default those budgets were cut short; this fits two boots in a row.
            testTimeout: 60_000,
            setupFiles: ['./src/test/officeE2eGlobal.setup.ts'],
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
                  const livekitEnv = loadLivekitEnv();
                  const apiKey = livekitEnv.LIVEKIT_API_KEY;
                  const apiSecret = livekitEnv.LIVEKIT_API_SECRET;
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
  };
});
