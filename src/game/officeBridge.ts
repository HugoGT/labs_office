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

import type { OfficeDesk } from './desksPort';
import type { LayoutEditCommand } from './layoutEditor';
import type { LayoutMaterial, TerrainColors } from './officeLayout';
import type { SpaceArea } from './mapData';
import type { AccessDeniedReason, PresenceStatus, RecordingReadyPayload } from './officeProtocol';
import type { RosterPeer } from './roster';
import type { TerrainEditCommand } from './terrainEditor';
import type { DecorEditCommand } from './decorEditor';
import type { DecorItem } from './officeDecor';
import type { CollisionEditCommand } from './collisionEditor';
import type { CollisionRect, CollisionRotation } from './pieceCollisions';
import type { ActiveRecordingSnapshot, OfficeConnectionState } from './officeRoomClient';
import type { ZoomAction, ZoomView } from './mapZoom';

export interface OfficeEventMap {
  /** Current entrance art has rendered, or cannot be loaded. */
  entry: { state: 'ready' | 'failed' };
  /**
   * Espacio actual del jugador local (#7, D2). `spaceId` es la clave de
   * pertenencia estable; `name` es lo unico que pinta el HUD -- por eso
   * `useOfficeBridge` sigue exponiendo `room: string | null` = `name`, sin
   * que el indicador visible note el cambio de identidad por debajo.
   */
  room: { spaceId: string | null; name: string | null };
  /**
   * Menu contextual al hacer clic en un personaje. Al retirarse los NPCs
   * simulados dejo de ser una union discriminada: el unico personaje clicable
   * es un peer real, asi que el destino es su `sessionId` a secas y
   * `remoteAvatarSink.ts` es el unico emisor.
   */
  peermenu: {
    sessionId: string;
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
   * la oficina sigue siendo recorrible en solitario.
   *
   * `online` se conserva (issue #52) y sigue significando EXACTAMENTE lo mismo
   * que antes -- `state === 'connected'` -- para que ensanchar este evento no
   * le cambie el sentido en silencio a nada rio abajo. Lo que aporta `state` es
   * el tercer caso que `online` no sabia expresar: hay sesion que recuperar y
   * se esta intentando, que no es ni estar conectado ni estar en solitario.
   *
   * `canRetry` distingue "no hay servidor porque no hay ninguno configurado"
   * (modo solitario: no hay nada que reintentar y ofrecer un boton seria
   * ofrecer uno muerto) de "no hay servidor porque se perdio". Lo decide la
   * escena, que es la unica que sabe si hay endpoint.
   *
   * `reason` comes only with `state: 'denied'` (#129): why the server refused
   * the join, which the owner of the office turns into a login notice.
   */
  presence: {
    online: boolean;
    peers: number;
    state: OfficeConnectionState;
    reason?: AccessDeniedReason;
    canRetry: boolean;
  };
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
  /**
   * Portrait of each session drawn from its pack character (art migration,
   * step 6): the idle frame facing the viewer, as a data URL. Re-emitted
   * whole whenever a character's sheet loads or a peer comes or goes; a
   * session missing here keeps its procedural `portraits` entry.
   */
  characterportraits: { bySession: Record<string, string> };
  /**
   * The assignable desk under the pointer, for its hover banner, with the
   * client point (CSS px) of the middle of its top edge: the banner sits
   * there. Re-emitted when that point moves (the camera follows the player);
   * `null` once the pointer leaves it, leaves the canvas or an editor opens.
   * Who holds the desk is React's to read from the same `/desks` list it sent.
   */
  deskhover: { deskId: string; x: number; y: number } | null;
  /** A committed occupancy/decor mutation; refetch the authenticated desk list. */
  deskschanged: undefined;
  /**
   * The local player tried to walk into a desk that already holds
   * `MAX_DESK_OCCUPANCY` other people (`deskDecorRules.ts`): once per
   * attempt, so pushing against it says it once.
   */
  deskfull: undefined;
  /**
   * The local player tried to walk into a locked space from outside it
   * (`spaceLocks.ts`): once per attempt, like `deskfull`.
   */
  spacelocked: { spaceId: string };
  /**
   * Whether the space the local player stands in is locked, and whether by
   * the local player (only they may unlock it); on every change.
   */
  roomlock: { locked: boolean; mine: boolean };
  /** An admin edited the spaces (#183); refetch `/spaces` (and the desks with them). */
  spaceschanged: undefined;
  /**
   * Every active recording in the office, keyed by spaceId (#5). Server-owned
   * synced state, so every occupant gets the same map; always the whole map.
   */
  recordings: { active: Record<string, ActiveRecordingSnapshot> };
  /**
   * A finished recording this user took part in is uploaded and can be
   * watched or downloaded (#58). Only participants receive it.
   */
  recordingready: RecordingReadyPayload;
  /**
   * Roster de personas conectadas (#74), reenviado tal cual desde
   * `createRosterTracker`. Nunca incluye al propio jugador (mismo
   * `ignoreSessionId` que `remoteAvatars.ts`): el HUD ya conoce su propio
   * nombre y estado por otra via y los antepone en `rosterView.ts`.
   */
  roster: { peers: readonly RosterPeer[] };
  /**
   * Un par reporto una `spacesVersion` distinta de la mia (#74, PR3a):
   * `spacesVersion` NO es un push de cambios de layout, es el propio cliente
   * reportando su hash (ver `OfficeScene.applySpacesConfig`), asi que un par
   * desacompasado es la unica senal de que hay algo nuevo que pedir. Cubre
   * TANTO una edicion en la oficina como una hecha desde `/dashboard`, porque
   * las dos publican por el mismo estado replicado. `OfficeShell` reacciona
   * releyendo `/spaces` y `/desks`, como mucho una vez por version distinta
   * (`createStaleSpacesVersionTracker` en `spacesConfig.ts`).
   */
  spacesstale: { version: string };
  /**
   * Se clico un rectangulo pickable del editor de layout (#74, PR3b): un
   * escritorio o sala existente, elegible para mover o borrar. Lo emite
   * `LayoutEditLayer`, no la escena -- es la capa quien sabe que rectangulo
   * dibujado corresponde a que id.
   */
  layoutpick: { id: string };
  /**
   * Se confirmo una colocacion (crear o mover) en el editor de layout (#74,
   * PR3b): la posicion ya viene encajada a tile y con su validez de
   * pre-chequeo resuelta (`layoutEditor.isPlacementValid`) -- el reductor en
   * React decide que hacer con eso, incluido pedirselo al servidor.
   */
  layoutplace: { tx: number; ty: number; valid: boolean };
  /**
   * The live terrain blocks (#123 phase 2) and walls (one per tile, row
   * major), as the room replicates them: after every accepted edit, and
   * again when the terrain editor opens, so it starts from what the map
   * shows without a fetch of its own.
   */
  terrain: {
    blocks: readonly LayoutMaterial[];
    walls: readonly (string | null)[];
    /** The color of each painted block (#222); a block absent draws its material's default art. */
    colors: TerrainColors;
  };
  /** The terrain editor has a floor picked and someone clicked a block on the map (#123 phase 2). */
  terrainpick: { index: number };
  /** The terrain editor has a wall (or the wall eraser) picked and someone clicked a tile on the map. */
  wallpick: { index: number };
  /**
   * The office decor layer (#208) as the room replicates it, sorted by
   * anchor: after every change, and again when a decor editor opens, so it
   * starts from what the map shows without a fetch of its own.
   */
  decor: { items: readonly DecorItem[] };
  /** A decor editor has a piece picked and someone clicked this tile of the map. */
  decorpick: { index: number };
  /**
   * A decor editor has nothing picked and someone clicked the map: the anchor
   * of the placed item under the pointer (`decorPickAt`, inside the editor's
   * area), or `null` for a click on no item, which deselects.
   */
  decorselect: { index: number | null };
  /** The move button of the selected decor item was clicked: the item anchored there becomes a move brush. */
  decormove: { index: number };
  /** The trash button of the selected decor item was clicked: the item anchored there goes. */
  decordelete: { index: number };
  /**
   * Turn the picked decor brush (`nextDecorRotation`): a chair or desk table
   * a quarter turn, `1` down, left, up, right, `-1` back; a room table
   * between horizontal and vertical either way. The map sends it for the R key (Shift+R
   * back) while a rotatable piece is picked; the wheel can send it too (#207).
   */
  decorrotate: { step: 1 | -1 };
  /**
   * The collision editor is open and someone clicked a placed piece: its id,
   * the rectangles it collides with now (saved, or its default turned into
   * piece space) and its default, for "Restablecer", plus how the clicked
   * instance is turned, so the panel shows its numbers as the map does (#218).
   */
  collisionpick: { pieceId: string; rotation: CollisionRotation; rects: readonly CollisionRect[]; saved: boolean; defaults: readonly CollisionRect[] };
  /** A rectangle was drawn, moved or resized on the map: the whole new draft, and the rectangle it touched. */
  collisiondraft: { rects: readonly CollisionRect[]; selectedRect: number | null };
  /** The map zoom: the TARGET stop and what the zoom control may still do, never the animated value. */
  zoomchanged: ZoomView;
}

export interface OfficeCommandMap {
  /**
   * Cambio de estado de presencia (#1). React es el dueno del estado y la
   * escena lo sigue. Viaja por `emitCommand` sin metodo de conveniencia: los
   * dos que existian (`teleportTo`/`callNpc`) se fueron con los NPCs, y
   * reponer esa superficie por cada comando nuevo reconstruiria el
   * `window.officeAPI` que D1 retiro.
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
   * Sit on the free seat in reach, or stand up when seated (art migration,
   * step 6). Same as pressing E in the canvas; the room has the last word.
   */
  toggleSeat: undefined;
  /**
   * The bottom bar's desk button: walk with the planner to a free chair of
   * the own desk and sit on it. Without an own desk it does nothing.
   */
  walkToOwnDesk: undefined;
  /** Lock the space the local player stands in; the room decides and replicates it. */
  lockRoom: undefined;
  /** Unlock the space the local player stands in; the room only lets whoever locked it. */
  unlockRoom: undefined;
  /**
   * Los 3 comandos de llamada (issue #2, D3) viajan solo por `emitCommand`,
   * como `setStatus`: ningun metodo de conveniencia (`bridge.callPeer()` no
   * existe) para no regrowth-ear el `window.officeAPI` que D1 retiro.
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
  /**
   * Escritorios asignables servidos (#7, slice 5). Mismo patron y misma razon
   * que `spacesconfig`: React los lee de `/desks` y la escena los sigue.
   *
   * Es un comando y no una opcion de construccion porque llega DESPUES de que
   * Phaser arranque. La escena empieza sin ninguno y los adopta al llegar; si
   * no llegan nunca -- 503 sin directorio, red caida -- se queda sin ninguno
   * para siempre y el resto de la oficina no se entera.
   *
   * A diferencia de `spacesconfig`, este comando llega VARIAS veces por
   * sesion: cada vez que alguien coge o suelta un sitio hay que releer la
   * lista. Trae siempre el estado COMPLETO, nunca un delta -- ver
   * `applyDesks`.
   */
  desks: { desks: readonly OfficeDesk[] };
  /**
   * Reintento manual de la conexion con el servidor de avatares (#52), el
   * ultimo recurso cuando la escalera de backoff se agoto y el HUD ya pinta
   * "Sin servidor". Viaja solo por `emitCommand`, como `setStatus` y los tres
   * de llamada, y por la misma razon: un metodo de conveniencia por comando
   * reconstruiria el `window.officeAPI` que D1 retiro.
   *
   * Sin payload porque no hay nada que decidir desde fuera: la escena ya sabe a
   * que endpoint iba y con que identidad. Pasarle parametros seria dejar que el
   * HUD reabriese una sesion distinta de la que se cayo.
   */
  reconnect: undefined;
  /**
   * Estado del editor de layout que la escena debe seguir (#74, PR3b),
   * proyectado por `layoutEditor.toLayoutEditCommand` desde el reductor que
   * React posee. `null` = salir del modo edicion: sin esto la escena no
   * tendria forma de saber que ya no hay nada pickable ni ghost que mostrar,
   * mismo motivo por el que `spacesconfig` viaja como comando y no como
   * opcion de construccion.
   */
  layoutedit: LayoutEditCommand | null;
  /**
   * The terrain editor (#123 phase 2): the block outlined and the local
   * preview, or `null` when it closes. Drawn by `TerrainEditLayer`; the
   * preview is painted by the scene, which owns the tilemap.
   */
  terrainedit: TerrainEditCommand | null;
  /**
   * A decor editor (#208, "Decoración", either scope): the brush, where it
   * may act and the local preview, or `null` when it closes. The ghost is
   * drawn by `DecorEditLayer`; the preview is painted by the scene, which
   * owns the decor layer.
   */
  decoredit: DecorEditCommand | null;
  /**
   * The collision editor: the piece, its draft drawn over every instance and
   * the rectangle with handles, or `null` when it closes. Drawn by
   * `CollisionEditLayer`; the colliders change only when the room says so.
   */
  collisionedit: CollisionEditCommand | null;
  /**
   * Step or reset the map zoom (map-zoom). An action, not state: it is not in
   * `STATE_COMMANDS`, so a late subscriber never replays an old press.
   */
  zoom: { action: ZoomAction };
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
}

/**
 * Commands whose payload is the whole current state, not an action (#144).
 * React emits them as soon as it knows them, which can be before the scene
 * subscribes: `preload()` waits for the art pack, and `create()` subscribes
 * only after it. The bridge keeps the latest one of each and hands it to a
 * subscriber that arrives later. Actions (teleport, calls, reconnect, seat)
 * are never replayed: running one twice, or late, would be a new action.
 */
const STATE_COMMANDS: ReadonlySet<keyof OfficeCommandMap> = new Set<keyof OfficeCommandMap>([
  'spacesconfig',
  'desks',
  'setStatus',
  'speakers',
]);

export function createOfficeBridge(): OfficeBridge {
  const events = new EventTarget();
  const commands = new EventTarget();
  const latestState = new Map<keyof OfficeCommandMap, unknown>();

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
    if (STATE_COMMANDS.has(type)) latestState.set(type, payload);
    commands.dispatchEvent(new CustomEvent(type, { detail: payload }));
  }

  function subscribeCommand<K extends keyof OfficeCommandMap>(
    type: K,
    handler: (payload: OfficeCommandMap[K]) => void,
  ): () => void {
    let delivered = false;
    let active = true;
    const unsubscribe = subscribe<OfficeCommandMap[K]>(commands, type, (payload) => {
      delivered = true;
      handler(payload);
    });
    // After the subscriber's current task, not inside it: the scene subscribes
    // early in `create()` and its handlers draw with what it builds later. A
    // live emit in between already brought something newer, so it wins.
    if (latestState.has(type)) {
      queueMicrotask(() => {
        if (active && !delivered) handler(latestState.get(type) as OfficeCommandMap[K]);
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }

  return {
    on(type, handler) {
      return subscribe(events, type, handler);
    },
    emit(type, payload) {
      events.dispatchEvent(new CustomEvent(type, { detail: payload }));
    },
    onCommand: subscribeCommand,
    emitCommand: dispatchCommand,
  };
}
