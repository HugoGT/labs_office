import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// PRD 6.1: Vite + React + TypeScript. El plugin PWA se agrega en Fase 1 (PRD seccion 9).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
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
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
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
