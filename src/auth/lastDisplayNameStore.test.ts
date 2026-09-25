/**
 * El ultimo nombre elegido con exito, para prellenar el campo "Nombre" en el
 * siguiente login (D8). Puro storage inyectado, mismo espiritu que el resto
 * de adaptadores de este repo: el SDK real puede lanzar (modo privado, cuota
 * agotada) y eso no puede tirar el login, que es UX y no una garantia.
 */

import { describe, expect, it } from 'vitest';
import { createLastDisplayNameStore, LAST_DISPLAY_NAME_KEY } from './lastDisplayNameStore';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe('createLastDisplayNameStore', () => {
  it('lee null cuando no hay nada guardado', () => {
    const store = createLastDisplayNameStore(fakeStorage());

    expect(store.read()).toBeNull();
  });

  it('escribe y luego lee el mismo valor', () => {
    const storage = fakeStorage();
    const store = createLastDisplayNameStore(storage);

    store.write('Ana Lopez');

    expect(store.read()).toBe('Ana Lopez');
  });

  it('usa la clave documentada, para que un dev pueda inspeccionarla a mano', () => {
    const storage = fakeStorage();
    const store = createLastDisplayNameStore(storage);

    store.write('Ana');

    expect(storage.data.get(LAST_DISPLAY_NAME_KEY)).toBe('Ana');
  });

  it('lee lo que ya hubiera de una sesion anterior', () => {
    const store = createLastDisplayNameStore(fakeStorage({ [LAST_DISPLAY_NAME_KEY]: 'Bea' }));

    expect(store.read()).toBe('Bea');
  });

  it('un storage que lanza al leer (modo privado) no revienta: null', () => {
    const throwing = {
      getItem(): string {
        throw new Error('modo privado');
      },
      setItem() {
        throw new Error('modo privado');
      },
    };

    expect(createLastDisplayNameStore(throwing).read()).toBeNull();
  });

  it('un storage que lanza al escribir (cuota agotada) no revienta', () => {
    const throwing = {
      getItem() {
        return null;
      },
      setItem(): void {
        throw new Error('cuota agotada');
      },
    };

    expect(() => createLastDisplayNameStore(throwing).write('Ana')).not.toThrow();
  });
});
