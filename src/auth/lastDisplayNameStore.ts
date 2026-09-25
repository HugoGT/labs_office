/**
 * Ultimo nombre elegido con exito, para prellenar el campo "Nombre" del Login
 * (#100, D8). Storage inyectado, mismo espiritu que el resto de adaptadores de
 * este repo: el SDK real puede lanzar (modo privado de Safari, cuota agotada)
 * y eso no puede tirar nada. Es UX -- una comodidad de reescribir menos -- y
 * nunca una garantia; la unicidad de verdad la decide el servidor en cada
 * envio.
 *
 * Se escribe SOLO tras un `POST /me/display-name` con 200, y con el nombre YA
 * CANONICALIZADO por el servidor (ver `useDisplayName.ts`): guardar lo que se
 * escribio en el formulario, en vez de lo que el servidor confirmo, prellenaria
 * "Ana   Lopez" cuando lo guardado de verdad es "Ana Lopez".
 */

export const LAST_DISPLAY_NAME_KEY = 'oficina.lastDisplayName';

/** La forma minima de `Storage` que este modulo usa, para poder inyectar un doble en los tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LastDisplayNameStore {
  /** `null` si nunca se escribio nada, o si el storage no se puede leer. */
  read(): string | null;
  write(name: string): void;
}

export function createLastDisplayNameStore(
  storage: StorageLike = window.localStorage,
): LastDisplayNameStore {
  return {
    read() {
      try {
        return storage.getItem(LAST_DISPLAY_NAME_KEY);
      } catch {
        return null;
      }
    },
    write(name) {
      try {
        storage.setItem(LAST_DISPLAY_NAME_KEY, name);
      } catch {
        // Best effort: es una comodidad de UX, nunca una garantia.
      }
    },
  };
}
