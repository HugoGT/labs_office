/// <reference types="vite/client" />

// Comando de Vitest Browser definido en `vite.config.ts` (solo para
// `livekitRoom.browser.test.ts`): mintea un token real desde Node, nunca
// desde el navegador, para no filtrar el secreto de LiveKit al bundle.
declare module 'vitest/browser' {
  interface BrowserCommands {
    mintLivekitToken: (identity: string, room: string) => Promise<string>;
  }
}
