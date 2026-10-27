import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./game/createGame', () => ({
  createGame: vi.fn(() => ({ destroy: vi.fn() })),
}));

// main.tsx no expone la raiz que crea: se captura aqui para desmontarla.
const roots = vi.hoisted((): Root[] => []);

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});

beforeEach(() => {
  // El arranque se evalua una vez por modulo: sin reset, el segundo test
  // reutilizaria el registro del primero y no volveria a ejecutar main.tsx.
  vi.resetModules();
  document.body.innerHTML = '';
  // main.tsx llama a render() por su cuenta, fuera de cualquier act().
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(async () => {
  // Sin desmontar, React deja tareas en su scheduler (setImmediate) que
  // pueden correr tras el teardown de jsdom: "window is not defined" (#228).
  for (const root of roots.splice(0)) root.unmount();
  // Deja correr cualquier tarea del scheduler ya encolada mientras jsdom vive.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('arranque de la aplicacion', () => {
  it('falla ruidosamente si el HTML no trae #root', async () => {
    await expect(import('./main')).rejects.toThrow(
      'No se encontro el elemento #root',
    );
  });

  it('monta la app dentro de #root', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    await import('./main');

    await vi.waitFor(() => {
      expect(root.querySelector('main')).not.toBeNull();
    });
    expect(roots).toHaveLength(1);
  });
});
