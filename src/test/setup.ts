import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true`, Testing Library no registra su limpieza automatica:
// hay que desmontar a mano o cada test hereda el DOM del anterior.
afterEach(() => {
  cleanup();
});
