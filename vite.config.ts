import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
});
