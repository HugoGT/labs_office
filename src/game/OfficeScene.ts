import Phaser from 'phaser';
import type { AnchorWriter } from './anchorChannel';
import { preloadOfficeAssets } from './assets';
import { beginAutoWalk, stepAutoWalk, type AutoWalkState } from './autoWalk';
import {
  setCharacterFacing,
  setCharacterStatus,
  spawnPlayer,
  type CharacterContainer,
} from './characters';
import { mergeColliderRects } from './colliderMerge';
import { deskItemName, deskSlotRect, deskZoneName } from './deskLayout';
import type { OfficeDesk } from './desksPort';
import { placeFurniture, placeNature, placeZoneLabels, renderGround } from './mapBuilder';
import {
  BUILT_IN_SPACES,
  BUILT_IN_SPACES_VERSION,
  PROX_RADIUS,
  TILE,
  WORLD_H,
  WORLD_W,
  type SpaceArea,
} from './mapData';
import type { OfficeBridge } from './officeBridge';
import {
  DEFAULT_FACING,
  DEFAULT_NAME,
  DEFAULT_STATUS,
  facingFrom,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import {
  connectOfficeRoom,
  type ConnectOfficeRoomOptions,
  type OfficeConnection,
  type OfficeConnectionState,
} from './officeRoomClient';
import { createRemoteAvatarRegistry, type RemoteAvatarRegistry } from './remoteAvatars';
import { createPhaserAvatarSink, type RemoteAvatarContainer } from './remoteAvatarSink';
import { detectSpace, nearbyKey } from './proximity';
import { audiblePeers, type AudioPeer } from './proximityAudio';
import { buildTerrainGrid, findFreeAdjacentTile, isBlocked, type TerrainGrid } from './terrainGrid';
import { AVATAR_KEYS, PLAYER_TEXTURE, avatarTextureKey, createOfficeTextures } from './textures';

/** Clave de la escena (D5): reemplaza `BootScene`, que se retira en este mismo cambio. */
export const OFFICE_SCENE_KEY = 'office';

const PLAYER_SPEED = 230;
const PROXIMITY_TICK_MS = 250;
const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;
const MINIMAP_MARGIN = 14;
/**
 * Los tres estados en los que se puede ver un escritorio asignable (#7, slice
 * 5). Es lo unico que los distingue, y basta: un tinte se lee de un vistazo
 * desde cualquier punto del mapa, y esta slice solo dibuja -- el editor de
 * decoracion es otra PR.
 */
const DESK_COLOR = {
  /** Libre: se puede coger. */
  free: 0x22c55e,
  /** El propio. El unico que se puede soltar. */
  mine: 0x3b82f6,
  /** De otra persona. No ofrece nada. */
  taken: 0x6b7280,
} as const;
const DESK_FILL_ALPHA = 0.22;
const DESK_STROKE_WIDTH = 2;

/**
 * Como se conecta la escena al servidor. `connect` se inyecta para poder
 * probar el cableado sin levantar un Colyseus real: el protocolo por cable ya
 * lo cubren los tests de la capa node contra un servidor de verdad.
 */
export interface OfficeSceneOptions {
  /** `null` desactiva el multijugador: la oficina corre en solitario. */
  endpoint?: string | null;
  /**
   * Nombre de la sesion (#6): etiqueta la pildora del avatar local y viaja
   * con el a la sala. Ausente sin autenticacion, donde la escena cae en
   * `DEFAULT_NAME` en vez de inventarse un nombre propio.
   */
  playerName?: string;
  /**
   * ID token de la sesion (#8), reenviado tal cual al cliente de la sala.
   * Ausente sin autenticacion: la sala vuelve a ser la puerta abierta de
   * siempre y la escena no nota la diferencia.
   */
  getIdToken?: () => Promise<string | null>;
  connect?: (options: ConnectOfficeRoomOptions) => Promise<OfficeConnection>;
}

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

/**
 * Escena principal de la oficina virtual, portada de `OfficeScene`
 * (`prototype/js/app.js:67-96,325-501`). Orquesta texturas, mapa, jugador,
 * input, camaras, colisiones y el ciclo de proximidad/salas. Los unicos
 * personajes que pinta son reales: el jugador local y los avatares remotos.
 *
 * El puente se inyecta por constructor (D2), no por `registry`: es
 * deterministico y evita depender de que una escritura llegue antes de que
 * `create()` arranque de forma asincrona.
 */
export class OfficeScene extends Phaser.Scene {
  private readonly bridge: OfficeBridge;
  private grid!: TerrainGrid;
  private player!: CharacterContainer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  private mmMarker?: Phaser.GameObjects.Arc;
  /** Clave de dedupe de "voice" (D3): incluye espacio y `selfSessionId`, no solo los pares. */
  private lastVoiceKey = '';
  private currentSpaceId: string | null = null;
  /**
   * Config de espacios que la escena usa para derivar pertenencia (#7, D3).
   * Empieza en `BUILT_IN_SPACES` y solo cambiaria al llegar la config
   * servida -- que no existe todavia en esta slice (slice 3).
   */
  private spaces: readonly SpaceArea[] = BUILT_IN_SPACES;
  /**
   * Version que este cliente publica de su config de espacios (#7, D4). Se
   * inicia en la constante fallback y viaja en el join Y en cada tic de
   * proximidad -- sin fetch en esta slice, jamas cambia, y por eso el
   * predicado mutuo de `audiblePeers` es constante-verdadero en produccion:
   * la guarda llega ANTES del riesgo que defiende (D4).
   */
  private spacesVersion: string = BUILT_IN_SPACES_VERSION;
  private unsubscribeSetStatus?: () => void;
  private unsubscribeSpeakers?: () => void;
  /** Solo se asigna bajo `__OFFICE_E2E__` (D4): produccion nunca la toca. */
  private unsubscribeTeleportToTile?: () => void;
  private unsubscribeCallPeer?: () => void;
  private unsubscribeRespondCall?: () => void;
  private unsubscribeWalkToPeer?: () => void;
  private unsubscribeSpacesConfig?: () => void;
  private unsubscribeDesks?: () => void;
  private unsubscribeReconnect?: () => void;
  /**
   * Todo lo dibujado del ultimo comando `desks` (#7, slice 5): zonas,
   * etiquetas y decoracion. Se guarda entero porque cada lista nueva sustituye
   * a la anterior y hay que poder retirar la vieja de una vez -- dibujar
   * encima dejaria pintado como ocupado un sitio que alguien acaba de soltar.
   */
  private deskObjects: Phaser.GameObjects.GameObject[] = [];
  /** Escritor del canal de anclas (issue #17, D4); abierto en `create()`, cerrado en SHUTDOWN. */
  private anchorWriter?: AnchorWriter;
  /**
   * Objetivo de auto-caminata en curso (issue #2, D9/D10). `undefined` cuando
   * nadie esta siendo perseguido: `update()` solo dirige al reductor mientras
   * este campo tiene valor.
   */
  private autoWalk?: AutoWalkState;

  private readonly options: OfficeSceneOptions;
  private remotes?: RemoteAvatarRegistry<RemoteAvatarContainer>;
  private connection?: OfficeConnection;
  private facing: Facing = DEFAULT_FACING;
  /** Estado de presencia del jugador local; React es quien lo cambia (ver `setStatus`). */
  private status: PresenceStatus = DEFAULT_STATUS;
  /** Vivo mientras la escena lo este: corta las respuestas tardias de la red. */
  private alive = true;
  /**
   * Ultima salud de la sesion publicada por el puente (#52). Se guarda porque
   * `emitPresence` se dispara tambien desde altas y bajas de pares, que cambian
   * el recuento pero NO el estado: sin recordarlo, cada alta durante una
   * reconexion volveria a anunciar "conectado".
   */
  private connectionState: OfficeConnectionState = 'offline';
  /**
   * Hay un reintento manual en vuelo (#52). Protege el unico camino de este
   * archivo que puede reentrarse desde fuera: el comando `reconnect` lo dispara
   * el HUD, y un humano nervioso pulsa el boton mas de una vez.
   */
  private reconnecting = false;

  constructor(bridge: OfficeBridge, options: OfficeSceneOptions = {}) {
    super(OFFICE_SCENE_KEY);
    this.bridge = bridge;
    this.options = options;
  }

  /** Las hojas Kenney tienen que estar cargadas antes de que `create()` dibuje. */
  preload(): void {
    preloadOfficeAssets(this);
  }

  create(): void {
    createOfficeTextures(this);
    // Una sola vez, no por sesion: la fidelidad exige la textura real, no un
    // redibujo en React que duplicaria `drawAvatar` y podria desincronizarse
    // de forma invisible (issue #17, D1).
    this.bridge.emit('portraits', { byKey: this.exportPortraits() });
    this.anchorWriter = this.bridge.anchors.open();

    const grid: TerrainGrid = buildTerrainGrid();
    this.grid = grid;
    renderGround(this, grid);
    placeFurniture(this, grid);
    placeNature(this, grid);
    placeZoneLabels(this);

    // El nombre de la sesion manda sobre la pildora del avatar local (#6).
    // Sin sesion (desarrollo local, e2e) cae en `DEFAULT_NAME`, que es como
    // llama el servidor a quien entra sin identidad verificada.
    this.player = spawnPlayer(this, this.options.playerName ?? DEFAULT_NAME);

    this.buildColliders(grid);
    this.setupCameras();
    this.setupInput();

    this.unsubscribeSetStatus = this.bridge.onCommand('setStatus', ({ status }) => {
      this.setStatus(status);
    });
    this.unsubscribeSpeakers = this.bridge.onCommand('speakers', ({ sessionIds }) => {
      this.applySpeakers(sessionIds);
    });
    // Issue #2, D3: los 3 comandos de llamada, cada uno suscrito por su
    // cuenta como los de arriba -- `walkToPeer` es ademas un seam probable
    // por si solo, sin tener que pasar por el apreton de manos completo de
    // aceptar una invitacion.
    this.unsubscribeCallPeer = this.bridge.onCommand('callPeer', ({ sessionId }) => {
      this.connection?.sendCall(sessionId);
    });
    this.unsubscribeRespondCall = this.bridge.onCommand('respondCall', ({ from, accept }) => {
      this.connection?.sendCallRespond(from, accept);
      // D3: la escena es quien sabe que "aceptar" implica caminar y quien
      // conoce coordenadas del mundo -- React nunca aprende esa consecuencia.
      if (accept) this.walkToPeer(from);
    });
    this.unsubscribeWalkToPeer = this.bridge.onCommand('walkToPeer', ({ sessionId }) => {
      this.walkToPeer(sessionId);
    });

    // #7, slice 3. Llega una sola vez por sesion, poco despues de arrancar.
    this.unsubscribeSpacesConfig = this.bridge.onCommand('spacesconfig', ({ spaces, version }) => {
      this.applySpacesConfig(spaces, version);
    });

    // #7, slice 5. A diferencia del anterior, llega cada vez que alguien coge
    // o suelta un sitio.
    this.unsubscribeDesks = this.bridge.onCommand('desks', ({ desks }) => {
      this.applyDesks(desks);
    });

    // #52: reintento manual, el ultimo recurso cuando la escalera automatica
    // de `reconnectPolicy` ya se rindio. No reutiliza la sesion caida -- de eso
    // se encarga el envoltorio mientras le quedan intentos -- sino que entra de
    // cero, que es lo unico que queda cuando el servidor ya solto el asiento.
    this.unsubscribeReconnect = this.bridge.onCommand('reconnect', () => {
      // Entrar es asincrono, asi que sin esta guarda un segundo clic arranca un
      // join mientras el primero sigue en vuelo: gana el que resuelva el ultimo
      // y el otro queda huerfano, vivo y publicando la posicion del jugador. Dos
      // sesiones para una persona son DOS avatares suyos en la oficina de los
      // demas -- la misma clase de fantasma que esta issue viene a quitar.
      if (this.reconnecting) return;
      this.reconnecting = true;
      // Se anuncia ANTES del `await` del join, no despues: entrar tarda lo que
      // tarde la red, y durante ese rato el HUD seguiria pintando "Sin
      // servidor" con su boton al lado, o sea, sin acuse de recibo de un clic
      // que si hizo algo. Ademas es lo que retira el boton de en medio, que es
      // la otra mitad de la guarda de arriba.
      this.emitPresence('reconnecting');
      // La conexion vieja se suelta sin esperarla: puede estar colgada contra
      // un socket muerto, y bloquear el reintento en ella seria hacer que el
      // boton no respondiese justo cuando la red esta mal.
      void this.connection?.leave();
      this.connection = undefined;
      // Los avatares de la sesion anterior no sobreviven a la nueva, por la
      // misma razon que en un resync: el join reparte los suyos y mezclarlos
      // dejaria fantasmas que ningun `onRemove` va a retirar.
      this.remotes?.clear();
      void this.connectToOffice().finally(() => {
        this.reconnecting = false;
      });
    });

    // D4: unico bloque muerto en produccion de este archivo -- deja tanto el
    // literal 'teleportToTile' como su handler fuera de `dist/`. Mueve al
    // jugador a una tile exacta, sin buscar una libre adyacente: el hook de
    // test necesita entrar a una sala concreta, no junto a nadie.
    if (__OFFICE_E2E__) {
      this.unsubscribeTeleportToTile = this.bridge.onCommand('teleportToTile', ({ tx, ty }) => {
        if (isBlocked(this.grid, tx, ty)) return;
        this.player.setPosition(tx * TILE + 16, ty * TILE + 16);
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      this.unsubscribeSetStatus?.();
      this.unsubscribeSpeakers?.();
      this.unsubscribeTeleportToTile?.();
      this.unsubscribeCallPeer?.();
      this.unsubscribeRespondCall?.();
      this.unsubscribeWalkToPeer?.();
      this.unsubscribeSpacesConfig?.();
      this.unsubscribeDesks?.();
      this.unsubscribeReconnect?.();
      this.anchorWriter?.close();
      this.anchorWriter = undefined;
      this.remotes?.clear();
      void this.connection?.leave();
      this.connection = undefined;
    });

    this.time.addEvent({
      delay: PROXIMITY_TICK_MS,
      loop: true,
      callback: () => this.proximityTick(),
    });

    void this.connectToOffice();
  }

  /**
   * Conecta con el servidor de avatares reales (PRD 6.2). Un fallo NO es
   * fatal: la oficina se queda en solitario, sin nadie mas, y se avisa
   * por el puente. Cualquier otra cosa dejaria la pantalla en negro cada vez
   * que el servidor no este levantado, que en desarrollo es la mitad del rato.
   */
  private async connectToOffice(): Promise<void> {
    const {
      endpoint,
      connect = connectOfficeRoom,
      playerName = this.player.nameText,
      getIdToken,
    } = this.options;

    if (endpoint === null || endpoint === undefined) {
      this.emitPresence('offline');
      // Sin sesion Colyseus nunca se intenta LiveKit (matriz de degradacion, PRD 6.3).
      this.emitVoice(null, [], this.currentSpaceId);
      return;
    }

    const joinedStatus = this.status;

    try {
      const connection = await connect({
        endpoint,
        name: playerName,
        status: joinedStatus,
        // Viaja en el join (#7, D4), no en un mensaje posterior: sin esto este
        // par quedaria "brevemente sin version" para todo el mundo hasta el
        // primer tic de proximidad.
        spacesVersion: this.spacesVersion,
        getIdToken,
        handlers: {
          onAdd: (snapshot) => {
            this.remotes?.upsert(snapshot);
            this.emitPresence();
          },
          onChange: (snapshot) => this.remotes?.upsert(snapshot),
          onRemove: (sessionId) => {
            this.remotes?.remove(sessionId);
            this.emitPresence();
          },
          // Issue #2: mensajes sueltos del servidor, no estado sincronizado
          // (D4) -- se relanzan tal cual al puente, mismo patron que el resto
          // de este objeto de handlers.
          onCallInvite: (payload) => this.bridge.emit('callinvite', payload),
          onCallerLeft: (payload) => this.bridge.emit('callerleft', payload),
          onCallAccepted: (payload) => this.bridge.emit('callaccepted', payload),
          onConnectionState: (state) => this.emitPresence(state),
          onResync: () => this.resyncAfterReconnect(),
        },
      });

      // La escena pudo apagarse mientras el `await` estaba en vuelo. Sin esta
      // guarda quedaria una conexion viva publicando la posicion de un jugador
      // ya destruido.
      if (!this.alive) {
        void connection.leave();
        return;
      }

      this.connection = connection;
      // El `await` de arriba dura lo que dure el saludo con el servidor, y
      // `setStatus` no tenia conexion a la que publicar mientras tanto. Sin
      // esta reconciliacion, quien elige "No molestar" durante ese hueco queda
      // publicado "En linea": aislado en su cliente y audible para el resto.
      if (this.status !== joinedStatus) connection.sendStatus(this.status);
      // Unit 8 (issue #2): el sink ahora necesita el bridge para poder emitir
      // `peermenu` al clicar un peer real; toque mecanico, la escena ya guarda
      // `this.bridge` desde su constructor.
      this.remotes = createRemoteAvatarRegistry(createPhaserAvatarSink(this, this.bridge), {
        ignoreSessionId: connection.sessionId,
      });
      this.emitPresence('connected');
      // Sesion viva, todavia sin pares conocidos (el primer tic los completa).
      this.emitVoice(connection.sessionId, [], this.currentSpaceId);
    } catch {
      if (!this.alive) return;
      this.emitPresence('offline');
      this.emitVoice(null, [], this.currentSpaceId);
    }
  }

  /**
   * La sesion volvio tras una caida (#52): olvida lo que sabias de los pares,
   * viene un replay completo de la sala nueva.
   *
   * Vaciar el registro es seguro justo POR ese replay -- la sala nueva reparte
   * a todos los presentes como altas, asi que no depende de ningun supuesto de
   * orden ni puede dejar a nadie fuera. Y es necesario porque quien se fuese
   * durante la caida no tiene `onRemove` que lo retire: ese borrado ocurrio en
   * una sala que ya no existe.
   *
   * `lastVoiceKey` se borra por la trampa que ya mordio en la issue #41:
   * `emitVoice` deduplica por esa clave, y tras una reconexion el conjunto de
   * pares audibles suele ser IDENTICO al de antes de la caida -- misma gente,
   * mismas posiciones. Sin invalidarla, el evento nunca se reemitiria y el par
   * recuperado se veria pero no se oiria, porque nadie volveria a pedirle a
   * LiveKit que lo suscriba.
   *
   * Y NO se llama a `proximityTick()` aqui a proposito: el registro acaba de
   * quedarse vacio, asi que una emision inmediata publicaria cero pares y
   * tumbaria el audio de todos durante un instante. El siguiente tic natural
   * (<=250 ms) ya publica el conjunto repoblado, y como la clave esta borrada
   * reemite aunque ese conjunto no haya cambiado ni un byte.
   */
  private resyncAfterReconnect(): void {
    this.remotes?.clear();
    this.lastVoiceKey = '';
  }

  /**
   * Aplica el estado que eligio el usuario en el HUD: lo pinta, lo publica y
   * reconcilia el audio en el acto. Lo ultimo es lo que no puede esperar al
   * siguiente tic: un cambio a "No molestar" que tarda un cuarto de segundo en
   * cortar el audio no es un corte, es un retraso.
   */
  private setStatus(status: PresenceStatus): void {
    if (this.status === status) return;
    this.status = status;
    setCharacterStatus(this.player, status);
    this.connection?.sendStatus(status);
    this.proximityTick();
  }

  /**
   * Aplica el conjunto de habla real reportado por React (D7): solo enciende
   * el anillo de avatares REMOTOS. El jugador local no tiene tile ni anillo
   * propio que mostrar en este canvas -- eso lo cubrira React en PR3b. El
   * comando trae el conjunto AUTORITATIVO completo (no un delta), asi que
   * cada sessionId conocido se apaga salvo que este en el arreglo.
   */
  private applySpeakers(sessionIds: readonly string[]): void {
    const speaking = new Set(sessionIds);
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      this.remotes?.get(sessionId)?.ring.setVisible(speaking.has(sessionId));
    }
  }

  /**
   * Retrato real de cada clave base de avatar (issue #17, D1): exporta la
   * textura de orientacion "down" ya generada por `createOfficeTextures`, no
   * un redibujo. `getBase64` es sincrono (canvas real, sin WebGL).
   */
  private exportPortraits(): Record<string, string> {
    const byKey: Record<string, string> = {};
    for (const base of [...AVATAR_KEYS, PLAYER_TEXTURE]) {
      byKey[base] = this.textures.getBase64(avatarTextureKey(base, 'down'));
    }
    return byKey;
  }

  /**
   * Proyecta la posicion del jugador local y de cada avatar remoto a
   * coordenadas de pantalla y las publica por el canal de anclas (issue #17,
   * D4). Se ejecuta cada cuadro, no cada tic de proximidad: la posicion es
   * continua, la existencia/contenido del tile no lo es.
   *
   * El jugador local se proyecta con la MISMA formula que un avatar remoto
   * (decision F, textual del mantenedor: "Tu propio recuadro cuelga de tu
   * avatar igual que el de los demas") -- el self-tile deja de ser un overlay
   * fijo en una esquina y pasa a anclarse y seguir al avatar como cualquier
   * otro. Sin `selfSessionId` (aun sin conexion) no hay a que clave publicar,
   * asi que se omite ese ancla ese cuadro.
   */
  private publishAnchors(): void {
    if (!this.anchorWriter) return;
    const cam = this.cameras.main;
    const selfSessionId = this.connection?.sessionId ?? null;
    if (selfSessionId !== null) {
      const screenX = (this.player.x - cam.scrollX) * cam.zoom;
      const screenY = (this.player.y - cam.scrollY) * cam.zoom;
      this.anchorWriter.set(
        selfSessionId,
        screenX,
        screenY,
        cam.worldView.contains(this.player.x, this.player.y),
      );
    }
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (!avatar) continue;
      const screenX = (avatar.x - cam.scrollX) * cam.zoom;
      const screenY = (avatar.y - cam.scrollY) * cam.zoom;
      this.anchorWriter.set(sessionId, screenX, screenY, cam.worldView.contains(avatar.x, avatar.y));
    }
    this.anchorWriter.commit();
  }

  /**
   * Adopta la config servida (#7, slice 3). Llega por comando poco despues de
   * arrancar, porque la escena no puede esperar a un viaje de red para
   * existir.
   *
   * Los dos campos cambian JUNTOS y en la misma vuelta: entre el momento en
   * que `spaces` fuese la nueva y `spacesVersion` la vieja, este cliente
   * estaria derivando pertenencia de unos rectangulos mientras declara otros,
   * y eso es exactamente lo que el predicado mutuo de `proximityAudio.ts` no
   * puede ver.
   *
   * No hace falta invalidar `lastVoiceKey` ni `currentSpaceId`: los dos se
   * comparan cada tic contra un valor RECALCULADO desde `this.spaces`, asi que
   * un cambio de config se propaga solo en el siguiente tic, y una config que
   * deja al jugador donde estaba no emite nada -- que es lo correcto.
   */
  private applySpacesConfig(spaces: readonly SpaceArea[], version: string): void {
    // Misma version = misma config. Es el caso normal de un despliegue sin
    // editar, donde lo servido coincide con lo incorporado; reenviarlo al
    // servidor seria un mensaje por sesion que no dice nada nuevo.
    if (version === this.spacesVersion) return;

    this.spaces = spaces;
    this.spacesVersion = version;

    // Los pares tienen que enterarse, o seguiran creyendo que coincidimos.
    // Si la conexion todavia no existe no hay nada que anunciar: el join lee
    // `this.spacesVersion` cuando se construya, y ya llevara esta.
    this.connection?.sendSpacesVersion(version);
  }

  /**
   * Adopta la lista de escritorios asignables servida (#7, slice 5). Llega por
   * comando poco despues de arrancar, y otra vez cada vez que alguien coge o
   * suelta un sitio.
   *
   * La lista es AUTORITATIVA y completa, no un delta, asi que lo dibujado se
   * retira entero antes de volver a dibujar. Reconciliar objeto a objeto seria
   * mas rapido y no hace falta: son unas decenas de rectangulos que solo se
   * redibujan cuando alguien se sienta o se levanta, y el estado incremental
   * es justo donde aparecerian los escritorios fantasma.
   *
   * Una lista vacia es un estado legitimo y el modo degradado a la vez: sin
   * directorio configurado `/desks` responde 503, `desksClient` devuelve
   * `NO_DESKS` y la oficina se dibuja exactamente como antes de esta slice.
   */
  private applyDesks(desks: readonly OfficeDesk[]): void {
    for (const object of this.deskObjects.splice(0)) object.destroy();
    for (const desk of desks) this.drawDesk(desk);
  }

  /**
   * Dibuja la zona de 3x3 de un escritorio, su etiqueta y la decoracion de
   * quien lo ocupe.
   *
   * La profundidad es el borde INFERIOR del area, misma convencion que
   * `placeFurniture` (`(y + alto) * TILE`) y misma razon: los avatares se
   * dibujan a la altura de sus pies (`setDepth(this.player.y)` en `update`),
   * asi que cualquier otro valor pondria a quien pasa por delante DEBAJO del
   * escritorio.
   */
  private drawDesk(desk: OfficeDesk): void {
    // Lo contesta el servidor y la escena lo lee (`OfficeDesk.mine`). Deducirlo
    // comparando `occupant.displayName` con el nombre del jugador local haria
    // que renombrar a alguien cambiase de manos un escritorio en pantalla --
    // la misma trampa que la slice 1 de esta issue retiro de
    // `proximityAudio.ts`.
    const mine = desk.mine;
    const color =
      desk.occupant === null ? DESK_COLOR.free : mine ? DESK_COLOR.mine : DESK_COLOR.taken;
    const depth = desk.y + desk.h;

    const zone = this.add
      .rectangle(desk.x + desk.w / 2, desk.y + desk.h / 2, desk.w, desk.h, color, DESK_FILL_ALPHA)
      .setStrokeStyle(DESK_STROKE_WIDTH, color)
      .setDepth(depth)
      .setName(deskZoneName(desk.id));
    this.deskObjects.push(zone);

    const label = this.add
      .text(desk.x + 3, desk.y + 2, desk.label, {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
        fontSize: '11px',
        color: '#e5e7eb',
      })
      .setDepth(depth);
    this.deskObjects.push(label);

    for (const item of desk.occupant?.items ?? []) {
      // `null` = ese slot no es una de las nueve cajas. Se salta la pieza y no
      // el escritorio: pintarla en una caja inventada la dejaria fuera del
      // area, y renunciar al escritorio entero quitaria un sitio que si existe.
      const box = deskSlotRect(desk, item.slot);
      if (box === null) continue;
      this.deskObjects.push(this.drawDeskItem(item.id, item.textureKey, item.rotation, box, depth));
    }

    // Un escritorio ajeno no se hace clicable siquiera: no tiene ninguna
    // accion que ofrecer, y `release` solo suelta el propio.
    if (desk.occupant !== null && !mine) return;

    zone.setInteractive();
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Mismo `stopPropagation` que el clic de un peer: sin el, el
      // `pointerdown` de la escena cerraria el menu contextual a la vez.
      pointer.event.stopPropagation();
      this.bridge.emit('deskclick', {
        deskId: desk.id,
        label: desk.label,
        action: mine ? 'release' : 'claim',
      });
    });
  }

  /**
   * Una pieza de decoracion ocupando su caja.
   *
   * Si la textura no esta cargada se dibuja un recuadro neutro en su sitio.
   * El catalogo es curado y promete claves que el bundle ya trae, pero esto
   * lee una respuesta de red: `add.image` con una clave desconocida pinta la
   * textura de error verde y negra de Phaser en mitad de la oficina, y un
   * hueco silencioso escondería que ese escritorio SI tiene algo puesto.
   */
  private drawDeskItem(
    itemId: string,
    textureKey: string,
    rotation: number,
    box: { x: number; y: number; w: number; h: number },
    depth: number,
  ): Phaser.GameObjects.GameObject {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const name = deskItemName(itemId);

    if (!this.textures.exists(textureKey)) {
      return this.add
        .rectangle(cx, cy, box.w, box.h, DESK_COLOR.taken, DESK_FILL_ALPHA)
        .setDepth(depth)
        .setName(name);
    }

    return this.add
      .image(cx, cy, textureKey)
      .setDisplaySize(box.w, box.h)
      .setAngle(rotation)
      .setDepth(depth)
      .setName(name);
  }

  /**
   * Unico punto de emision de "presence". Sin argumento reemite la salud
   * vigente y solo refresca el recuento, que es lo que quieren las altas y
   * bajas de pares; con argumento la cambia.
   *
   * `canRetry` sale del endpoint y no del estado: sin endpoint la oficina corre
   * en solitario por decision, no por averia, y no hay absolutamente nada que
   * un boton de reintento pudiera hacer ahi.
   */
  private emitPresence(state: OfficeConnectionState = this.connectionState): void {
    this.connectionState = state;
    const endpoint = this.options.endpoint;
    this.bridge.emit('presence', {
      // Se conserva con su significado exacto de siempre para que ensanchar el
      // evento no le cambie el sentido en silencio a nada rio abajo.
      online: state === 'connected',
      peers: this.remotes?.sessionIds().length ?? 0,
      state,
      canRetry: endpoint !== null && endpoint !== undefined,
    });
  }

  /**
   * Unico punto de emision de "voice" (D3): tic, conexion exitosa y fallo de
   * conexion comparten el mismo `lastVoiceKey`, asi que un evento disparado
   * por conexion que no cambia nada frente al ultimo tic no duplica el aviso.
   */
  private emitVoice(
    selfSessionId: string | null,
    peers: readonly { sessionId: string; name: string }[],
    spaceId: string | null,
  ): void {
    // El nombre entra en la clave de dedupe (issue #17): un cambio de nombre
    // sin cambio de conjunto de pares SI debe reemitir, o la etiqueta del
    // tile quedaria pegada al valor viejo.
    const key = `${nearbyKey(peers.map((peer) => `${peer.sessionId}:${peer.name}`))}|${spaceId ?? ''}|${selfSessionId ?? ''}`;
    if (key === this.lastVoiceKey) return;
    this.lastVoiceKey = key;
    this.bridge.emit('voice', {
      selfSessionId,
      selfName: this.player.nameText,
      peers,
      spaceId,
    });
  }

  /** Fusiona tiles solidos en rectangulos estaticos y los colisiona con el jugador (app.js:392-408, D6). */
  private buildColliders(grid: TerrainGrid): void {
    const rects = mergeColliderRects(grid.solid).map((r) => {
      const w = r.w * TILE;
      const h = r.h * TILE;
      const rect = this.add.rectangle(r.x * TILE + w / 2, r.y * TILE + h / 2, w, h);
      this.physics.add.existing(rect, true);
      return rect;
    });
    this.physics.add.collider(this.player, rects);
  }

  /** Camara principal siguiendo al jugador + minimapa en la esquina superior derecha (app.js:410-431). */
  private setupCameras(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.setBackgroundColor('#0d1117');

    const minimap = this.cameras.add(
      this.scale.width - (MINIMAP_WIDTH + 16),
      MINIMAP_MARGIN,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    minimap.setZoom(Math.min(MINIMAP_WIDTH / WORLD_W, MINIMAP_HEIGHT / WORLD_H));
    minimap.centerOn(WORLD_W / 2, WORLD_H / 2);
    minimap.setBackgroundColor(0x0d1117);

    this.mmMarker = this.add.circle(0, 0, 42, 0xffffff, 0.45).setDepth(99999);
    cam.ignore(this.mmMarker);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      minimap.setPosition(gameSize.width - (MINIMAP_WIDTH + 16), MINIMAP_MARGIN);
    });
  }

  /** WASD + flechas; el menu contextual se cierra al hacer clic fuera de el (app.js:433-441). */
  private setupInput(): void {
    const keyboard = this.input.keyboard as Phaser.Input.Keyboard.KeyboardPlugin;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as WasdKeys;
    keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');

    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!currentlyOver || currentlyOver.length === 0) {
          this.bridge.emit('closemenu', undefined);
        }
      },
    );
  }

  /**
   * Cercania + deteccion de sala cada 250 ms (app.js:444-471), emitidas por el
   * puente (D1). Desde este cambio (D7) tambien pliega `this.remotes` en la
   * misma regla de audibilidad que gobierna las suscripciones de LiveKit:
   * los chips y el audio nunca pueden desacordar sobre quien esta presente.
   */
  private proximityTick(): void {
    const player = this.player;
    const space = detectSpace({ x: player.x, y: player.y }, this.spaces);
    const selfSessionId = this.connection?.sessionId ?? null;

    // Espacio detectado POR PAR, no el del jugador: cada avatar remoto puede
    // estar en un espacio distinto al propio.
    const audioPeers: AudioPeer[] = (this.remotes?.sessionIds() ?? []).flatMap((sessionId) => {
      const avatar = this.remotes?.get(sessionId);
      if (!avatar) return [];
      // El estado y la version salen del contenedor, que el sink ya mantiene
      // al dia con lo que llega del servidor: es la misma fuente que pinta el
      // punto, asi que el color y el audio no pueden contarse historias
      // distintas.
      return [
        {
          sessionId,
          x: avatar.x,
          y: avatar.y,
          spaceId: detectSpace(avatar, this.spaces)?.id ?? null,
          spacesVersion: avatar.spacesVersion,
          status: avatar.status,
        },
      ];
    });
    const audibleIds = audiblePeers({
      self: {
        sessionId: selfSessionId,
        x: player.x,
        y: player.y,
        spaceId: space?.id ?? null,
        spacesVersion: this.spacesVersion,
        status: this.status,
      },
      peers: audioPeers,
      radius: PROX_RADIUS,
    });
    // Nombre de cada audible (issue #17, D-voz): la etiqueta del tile se
    // resuelve desde aqui, nunca redibujada -- misma fuente que ya pintaba
    // los chips retirados (D9).
    const peers = audibleIds.flatMap((sessionId) => {
      const name = this.remotes?.get(sessionId)?.nameText;
      return name === undefined ? [] : [{ sessionId, name }];
    });

    const spaceId = space?.id ?? null;
    if (spaceId !== this.currentSpaceId) {
      this.currentSpaceId = spaceId;
      this.bridge.emit('room', { spaceId, name: space?.name ?? null });
    }

    this.emitVoice(selfSessionId, peers, spaceId);
  }

  /**
   * Arranca la auto-caminata del jugador hasta una tile libre junto al peer
   * (issue #2, D9/D10): el reflejo de `teleportTo`, pero por steering en vez
   * de salto, y con destino congelado en el momento de aceptar (D10: "el
   * caller se mueve mid-walk" no persigue, no hay pathfinding en este repo).
   */
  private walkToPeer(sessionId: string): void {
    const peer = this.remotes?.get(sessionId);
    if (!peer) return; // se desconecto antes de que esto corriera: no-op silencioso.

    const destination = findFreeAdjacentTile(
      this.grid,
      Math.floor(peer.x / TILE),
      Math.floor(peer.y / TILE),
    );
    if (!destination) return;

    this.autoWalk = beginAutoWalk(
      { x: destination.tx * TILE + 16, y: destination.ty * TILE + 16 },
      this.player,
    );
  }

  update(_time: number, delta: number): void {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Auto-caminata (issue #2, D9/D10): se resuelve ANTES de decidir la
    // velocidad final del cuadro, para que todo lo que viene despues (depth,
    // facing, throttle de red, minimapa, anclas) siga leyendo this.player.x/y
    // sin enterarse de este bloque, exactamente como pedia el diseno D9.
    let steeredByAutoWalk = false;
    if (this.autoWalk) {
      const step = stepAutoWalk({
        state: this.autoWalk,
        position: this.player,
        keyboard: { vx, vy },
        deltaMs: delta,
        speed: PLAYER_SPEED,
      });

      if (step.kind === 'walking') {
        this.autoWalk = step.state;
        // TRAMPA DE INTEGRACION (ver discovery de la unit 12): jamas
        // renormalizar esto con `new Phaser.Math.Vector2(step.vx,
        // step.vy).normalize().scale(PLAYER_SPEED)`. El reductor ya recorta
        // la velocidad del ULTIMO cuadro para aterrizar dentro de
        // ARRIVE_EPSILON_PX (D10); normalizar tira esa magnitud y la
        // reescala a una velocidad constante, asi que el jugador oscilaria
        // alrededor del destino sin llegar nunca. Se aplica DIRECTO al body.
        body.setVelocity(step.vx, step.vy);
        // `facingFrom` solo mira los signos, asi que funciona igual con la
        // velocidad ya escalada del reductor -- pero jamas con (0,0), o el
        // avatar se congelaria mirando la ultima direccion del teclado en vez
        // de hacia donde camina.
        this.facing = facingFrom(step.vx, step.vy, this.facing);
        steeredByAutoWalk = true;
      } else {
        this.autoWalk = undefined;
        // D10: llegar o bloquearse detienen en silencio -- un "no pude
        // llegar" seria ruido si la tarjeta ya se fue. Una cancelacion por
        // input YA se esta moviendo bajo la velocidad de teclado leida
        // arriba: no hay nada que limpiar, cae al camino normal de abajo con
        // ese vx/vy real (esa lectura ES la cancelacion, sin listener aparte).
        if (step.kind !== 'cancelled' || step.reason === 'blocked') {
          vx = 0;
          vy = 0;
        }
      }
    }

    if (!steeredByAutoWalk) {
      const velocity = new Phaser.Math.Vector2(vx, vy).normalize().scale(PLAYER_SPEED);
      body.setVelocity(velocity.x, velocity.y);
      this.facing = facingFrom(vx, vy, this.facing);
    }

    this.player.setDepth(this.player.y);
    setCharacterFacing(this.player, this.facing);

    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (avatar) avatar.setDepth(avatar.y);
    }

    // Se publica cada frame a proposito: el agrupado de `createMoveThrottle`
    // decide que sale por el cable y que se descarta por no haber cambiado.
    this.connection?.sendMove(this.player.x, this.player.y, this.facing);

    this.mmMarker?.setPosition(this.player.x, this.player.y);

    this.publishAnchors();
  }
}
