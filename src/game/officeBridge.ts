/**
 * Puente tipado Phaser<->React, portado del `window.officeAPI` global y los
 * `CustomEvent` en `document` del prototipo (`app.js:95,603`). Ver diseno D1:
 * envuelve un `EventTarget` privado por instancia; `on`/`onCommand` devuelven
 * su propia funcion de desuscripcion (un `AbortController` por suscripcion).
 *
 * Deliberadamente sin `destroy()`: React preserva `useState` entre el remonte
 * de StrictMode, asi que un `destroy()` en la limpieza de un efecto mataria
 * el puente que el arbol remontado aun sostiene. En vez de eso, cada
 * suscriptor es dueno de su propia desuscripcion; cuando el arbol se
 * desmonta nada referencia el puente y queda para el recolector de basura.
 */

import type { NpcStatus } from './npcData';

export interface OfficeEventMap {
  nearby: { names: string[] };
  room: { room: string | null };
  npcmenu: { id: number; name: string; status: string; statusCode: NpcStatus; x: number; y: number };
  closemenu: undefined;
  /**
   * Estado de la conexion con el servidor Colyseus y cuantos avatares reales
   * hay ademas del propio. `online: false` no es un error a mostrar en rojo:
   * la oficina sigue siendo jugable en solitario con los NPCs simulados.
   */
  presence: { online: boolean; peers: number };
}

export interface OfficeCommandMap {
  teleportTo: { npcId: number };
  callNpc: { npcId: number };
}

export interface OfficeBridge {
  on<K extends keyof OfficeEventMap>(type: K, handler: (payload: OfficeEventMap[K]) => void): () => void;
  emit<K extends keyof OfficeEventMap>(type: K, payload: OfficeEventMap[K]): void;
  onCommand<K extends keyof OfficeCommandMap>(
    type: K,
    handler: (payload: OfficeCommandMap[K]) => void,
  ): () => void;
  teleportTo(npcId: number): void;
  callNpc(npcId: number): void;
}

export function createOfficeBridge(): OfficeBridge {
  const events = new EventTarget();
  const commands = new EventTarget();

  function subscribe<T>(target: EventTarget, type: string, handler: (payload: T) => void): () => void {
    const controller = new AbortController();
    target.addEventListener(
      type,
      (event) => handler((event as CustomEvent<T>).detail),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }

  return {
    on(type, handler) {
      return subscribe(events, type, handler);
    },
    emit(type, payload) {
      events.dispatchEvent(new CustomEvent(type, { detail: payload }));
    },
    onCommand(type, handler) {
      return subscribe(commands, type, handler);
    },
    teleportTo(npcId) {
      commands.dispatchEvent(new CustomEvent('teleportTo', { detail: { npcId } }));
    },
    callNpc(npcId) {
      commands.dispatchEvent(new CustomEvent('callNpc', { detail: { npcId } }));
    },
  };
}
