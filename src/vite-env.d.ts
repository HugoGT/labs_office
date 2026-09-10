/// <reference types="vite/client" />

// Flag de build inyectada por `define` en `vite.config.ts` (D2): un literal
// `true`/`false` en cada modo, nunca un valor `import.meta.env.VITE_*` sin
// definir. Gatea el test-only positioning hook (`officeTestHook.ts`).
declare const __OFFICE_E2E__: boolean;

// Comando de Vitest Browser definido en `vite.config.ts` (solo para
// `livekitRoom.browser.test.ts`): mintea un token real desde Node, nunca
// desde el navegador, para no filtrar el secreto de LiveKit al bundle.
declare module 'vitest/browser' {
  interface BrowserCommands {
    mintLivekitToken: (identity: string, room: string) => Promise<string>;
  }
}
