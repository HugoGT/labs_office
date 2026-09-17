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

import type { PresenceStatus } from './officeProtocol';

export interface OfficeEventMap {
  nearby: { names: string[] };
  room: { room: string | null };
  npcmenu: {
    id: number;
    name: string;
    status: string;
    statusCode: PresenceStatus;
    x: number;
    y: number;
  };
  closemenu: undefined;
  /**
   * Estado de la conexion con el servidor Colyseus y cuantos avatares reales
   * hay ademas del propio. `online: false` no es un error a mostrar en rojo:
   * la oficina sigue siendo jugable en solitario con los NPCs simulados.
   */
  presence: { online: boolean; peers: number };
  /**
   * Instantanea completa de la capa de audio (D3): quien soy, a quien
   * escucho y en que sala estoy. Un solo evento aditivo en vez de dos
   * (sesion + audibles) para que quien lo consuma nunca actue sobre un par
   * a medio actualizar (sala nueva, pares viejos). `selfSessionId: null`
   * significa "desconectate de LiveKit"; no null dispara pedir un token.
   */
  voice: { selfSessionId: string | null; sessionIds: string[]; room: string | null };
}

export interface OfficeCommandMap {
  teleportTo: { npcId: number };
  callNpc: { npcId: number };
  /**
   * Cambio de estado de presencia (#1). React es el dueno del estado y la
   * escena lo sigue. No lleva metodo de conveniencia como los dos de arriba:
   * esos existen por paridad con el prototipo, y ampliar esa superficie por
   * cada comando nuevo reconstruiria el `window.officeAPI` que D1 retiro.
   */
  setStatus: { status: PresenceStatus };
  /**
   * Test-only command (D4): moves the local player directly onto a tile.
   * Only ever emitted by `officeTestHook.ts`, which is itself dead-code
   * eliminated from the production bundle behind `__OFFICE_E2E__`. Adding
   * the type here does not add any production-visible runtime surface.
   */
  teleportToTile: { tx: number; ty: number };
  /**
   * Habla real (issue #17, D7): React es dueno del `Set` de hablantes (lo
   * deriva de `RoomEvent.ActiveSpeakersChanged`, nunca de `micOn`) y la escena
   * lo sigue por comando, mismo patron que `setStatus`. Solo enciende el
   * anillo de `RemoteAvatarContainer`s -- el jugador local no tiene por que
   * ver su propio anillo encenderse en el canvas.
   */
  speakers: { sessionIds: string[] };
}

export interface OfficeBridge {
  on<K extends keyof OfficeEventMap>(type: K, handler: (payload: OfficeEventMap[K]) => void): () => void;
  emit<K extends keyof OfficeEventMap>(type: K, payload: OfficeEventMap[K]): void;
  onCommand<K extends keyof OfficeCommandMap>(
    type: K,
    handler: (payload: OfficeCommandMap[K]) => void,
  ): () => void;
  /**
   * Generic command emitter, symmetric with `emit` for events. `commands` is
   * a closure-private `EventTarget`, so this is the only way for code
   * outside this module (e.g. `officeTestHook.ts`) to trigger a command
   * without this module exposing `commands` itself.
   */
  emitCommand<K extends keyof OfficeCommandMap>(type: K, payload: OfficeCommandMap[K]): void;
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

  function dispatchCommand<K extends keyof OfficeCommandMap>(
    type: K,
    payload: OfficeCommandMap[K],
  ): void {
    commands.dispatchEvent(new CustomEvent(type, { detail: payload }));
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
    emitCommand: dispatchCommand,
    teleportTo(npcId) {
      dispatchCommand('teleportTo', { npcId });
    },
    callNpc(npcId) {
      dispatchCommand('callNpc', { npcId });
    },
  };
}
