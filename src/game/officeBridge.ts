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

import { createAnchorChannel, type AnchorChannel } from './anchorChannel';
import type { SpaceArea } from './mapData';
import type { PresenceStatus } from './officeProtocol';

export interface OfficeEventMap {
  /**
   * Espacio actual del jugador local (#7, D2). `spaceId` es la clave de
   * pertenencia estable; `name` es lo unico que pinta el HUD -- por eso
   * `useOfficeBridge` sigue exponiendo `room: string | null` = `name`, sin
   * que el indicador visible note el cambio de identidad por debajo.
   */
  room: { spaceId: string | null; name: string | null };
  /**
   * Menu contextual al hacer clic en un personaje (issue #2, D1): union
   * discriminada por `target.kind`. Antes era un `id` plano que solo servia
   * para NPCs simulados; ahora un peer real se direcciona por `sessionId` y
   * un NPC sigue direccionandose por `npcId` (renombrado desde `id`, movido
   * DENTRO de la variante). `ContextMenu`/`OfficeShell` ramifican sobre
   * `target.kind`; `characters.ts` (NPCs) y `remoteAvatarSink.ts` (peers)
   * son los unicos emisores.
   */
  npcmenu: {
    target: { kind: 'npc'; npcId: number } | { kind: 'peer'; sessionId: string };
    name: string;
    status: string;
    statusCode: PresenceStatus;
    x: number;
    y: number;
  };
  closemenu: undefined;
  /**
   * Invitacion de llamada entrante (issue #2, D3/D5): una por llamador
   * pendiente, sin id de invitacion -- el propio `from` (sessionId del
   * llamador) identifica la tarjeta, porque el registro del servidor ya
   * deduplica por llamador (D5).
   */
  callinvite: { from: string; name: string };
  /**
   * El llamador de una invitacion pendiente se desconecto (issue #2, D7). La
   * tarjeta sobrevive del lado del receptor como un "tombstone": deja de
   * poder aceptarse, solo puede descartarse.
   */
  callerleft: { from: string };
  /**
   * El receptor acepto la llamada (issue #2, D3). Es la UNICA reaccion que
   * el llamador recibe -- pasar, DND, destino desconocido y duplicado son
   * todos el mismo silencio (regla de feedback del llamador).
   */
  callaccepted: { by: string; name: string };
  /**
   * Estado de la conexion con el servidor Colyseus y cuantos avatares reales
   * hay ademas del propio. `online: false` no es un error a mostrar en rojo:
   * la oficina sigue siendo jugable en solitario con los NPCs simulados.
   */
  presence: { online: boolean; peers: number };
  /**
   * Instantanea completa de la capa de audio/video (D3): quien soy, a quien
   * escucho y en que sala estoy. Un solo evento aditivo en vez de dos
   * (sesion + audibles) para que quien lo consuma nunca actue sobre un par
   * a medio actualizar (sala nueva, pares viejos). `selfSessionId: null`
   * significa "desconectate de LiveKit"; no null dispara pedir un token.
   * `peers` trae el nombre de cada audible (issue #17): la etiqueta del tile
   * lo resuelve de aqui, sin reintroducir el contrato de los chips `nearby`.
   */
  voice: {
    selfSessionId: string | null;
    selfName: string;
    peers: readonly { sessionId: string; name: string }[];
    /** Espacio del jugador local (#7, D2). `null` = piso abierto. */
    spaceId: string | null;
  };
  /**
   * Retratos fieles exportados una sola vez desde `create()` (issue #17, D1):
   * la clave base (`av0`..`av9`, `avP`) a su textura real codificada en base64
   * (`scene.textures.getBase64`). Es un evento discreto, no el canal continuo
   * de `anchors` -- el contenido no cambia cuadro a cuadro.
   */
  portraits: { byKey: Record<string, string> };
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
  /**
   * Los 3 comandos de llamada (issue #2, D3) viajan solo por `emitCommand`,
   * como `setStatus`: ningun metodo de conveniencia nuevo (`bridge.callPeer()`
   * no existe) para no regrowth-ear el `window.officeAPI` que D1 retiro.
   */
  callPeer: { sessionId: string };
  /**
   * Un solo comando para aceptar/pasar (D3), no dos: la escena es quien sabe
   * que "aceptar" implica caminar y quien conoce coordenadas del mundo.
   * React nunca aprende esa consecuencia.
   */
  respondCall: { from: string; accept: boolean };
  walkToPeer: { sessionId: string };
  /**
   * Config de espacios servida (#7, slice 3). React la lee de `/spaces` una
   * sola vez y la escena la sigue, mismo patron que `setStatus` y `speakers`.
   *
   * Es un comando y no una opcion de construccion porque llega DESPUES de que
   * Phaser arranque: por prop entraria en las dependencias del efecto de
   * `GameCanvas` y recrearia el juego entero, y retrasar el montaje hasta
   * tenerla le costaria a todo el mundo una espera de red antes de ver la
   * oficina.
   *
   * Las dos mitades viajan juntas y nunca por separado: los rectangulos con
   * los que este cliente deriva pertenencia, y el hash que declara cuales son.
   * Publicar una version que no corresponda a estos rectangulos es justo lo
   * que el predicado mutuo de `proximityAudio.ts` NO puede detectar.
   */
  spacesconfig: { spaces: readonly SpaceArea[]; version: string };
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
  /**
   * Canal continuo posicion-por-cuadro (issue #17, D4): deliberadamente NO es
   * un `EventTarget`. La escena escribe cada `update()`; el overlay de tiles
   * lo lee desde un unico `requestAnimationFrame`, nunca via `on`/`emit`.
   */
  readonly anchors: AnchorChannel;
}

export function createOfficeBridge(): OfficeBridge {
  const events = new EventTarget();
  const commands = new EventTarget();
  const anchors = createAnchorChannel();

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
    anchors,
  };
}
