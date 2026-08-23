import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./game/createGame', () => ({
  createGame: vi.fn(() => ({ destroy: vi.fn() })),
}));

beforeEach(() => {
  // El arranque se evalua una vez por modulo: sin reset, el segundo test
  // reutilizaria el registro del primero y no volveria a ejecutar main.tsx.
  vi.resetModules();
  document.body.innerHTML = '';
  // main.tsx llama a render() por su cuenta, fuera de cualquier act().
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
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
  });
});
