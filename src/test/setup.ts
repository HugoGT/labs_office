import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true`, Testing Library no registra su limpieza automatica:
// hay que desmontar a mano o cada test hereda el DOM del anterior.
afterEach(() => {
  cleanup();
  // Palettes remember their colors in the browser (usePersistedColors): no test inherits another's.
  window.localStorage.clear();
});
