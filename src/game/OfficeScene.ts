import Phaser from 'phaser';
import type { ArtFacing, ArtPiece, Point } from './artContract';
import { artUploadsManifestUrl, findPiece, parseArtSheetKey, type ArtAppearance } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import {
  chairPlacement,
  DEFAULT_DESK_FACING,
  deskAreaAnchor,
  deskPlacement,
  spaceFloorTiles,
} from './artPlacement';
import { feetOf, positionForFeet } from './avatarGeometry';
import { ARRIVE_EPSILON_PX, beginAutoWalk, stepAutoWalk, type AutoWalkState } from './autoWalk';
import { CameraPanLayer } from './CameraPanLayer';
import { PAN_THRESHOLD_PX } from './cameraPan';
import { advanceWalkingTime, MAX_WALK_FRAME_MS, walkingMultiplier } from './walkingSpeed';
import { walkingSweepFraction } from './walkingCollision';
import { walkFrame } from './characterAnimation';
import {
  animateCharacter,
  setCharacterFacing,
  setCharacterSheets,
  setCharacterStatus,
  spawnPlayer,
  type CharacterContainer,
  type CharacterSheets,
} from './characters';
import { mergeColliderRects } from './colliderMerge';
import {
  DESK_ZONE_DEPTH,
  MINIMAP_MARKER_DEPTH,
  specialAssetDepth,
  worldAssetDepth,
} from './depthLayers';
import { deskFurnitureName, deskItemName, deskSlotRect, deskZoneName } from './deskLayout';
import type { OfficeDesk } from './desksPort';
import { MINIMAP_HEIGHT, MINIMAP_MARGIN, MINIMAP_WIDTH, RAIL_RIGHT } from './hudLayout';
import { isEditableElementFocused } from './inputFocusGuard';
import { LayoutEditLayer } from './LayoutEditLayer';
import {
  BASE_MAP_CHAIR,
  placeLayout,
  placeSeats,
  placeZoneLabels,
  putArtSprite,
  putChair,
  putFloorTile,
  renderTerrain,
  type TerrainTilemap,
} from './mapBuilder';
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
  BASE_LAYOUT,
  BASE_TERRAIN,
  encodeTerrainBlocks,
  terrainSnapshot,
  withBlock,
  type LayoutMaterial,
  type TerrainSnapshot,
} from './officeLayout';
import { BASE_COLLISION_RECTS, STATIC_COLLISION_INSTANCES, officeCollisionInstances } from './officeCollisions';
import {
  collisionWorld,
  encodeCollisionTable,
  type CollisionInstance,
  type CollisionRect,
  type CollisionTable,
} from './pieceCollisions';
import type { TerrainEditCommand } from './terrainEditor';
import { TerrainEditLayer } from './TerrainEditLayer';
import { COLLISION_EDIT_GRAPHICS_NAME, CollisionEditLayer } from './CollisionEditLayer';
import {
  DEFAULT_FACING,
  DEFAULT_NAME,
  DEFAULT_STATUS,
  facingFrom,
  isPresenceStatus,
  type AccessDeniedReason,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import {
  OfficeAccessDeniedError,
  connectOfficeRoom,
  type ConnectOfficeRoomOptions,
  type OfficeConnection,
  type OfficeConnectionState,
} from './officeRoomClient';
import { createRemoteAvatarRegistry, type RemoteAvatarRegistry } from './remoteAvatars';
import { createPhaserAvatarSink, type RemoteAvatarContainer } from './remoteAvatarSink';
import { detectSpace, nearbyKey } from './proximity';
import { createRosterTracker, type RosterPeer, type RosterTracker } from './roster';
import { createStaleSpacesVersionTracker } from './spacesConfig';
import { audiblePeers, type AudioPeer } from './proximityAudio';
import {
  BASE_MAP_SEATS,
  deskSeatId,
  deskSeatTiles,
  inSeatReach,
  mapSeatId,
  mapSeatTiles,
  parseSeatRef,
  type SeatTiles,
} from './seating';
import {
  buildTerrainGrid,
  isBlocked,
  pickApproachTile,
  type TerrainGrid,
  type TileRect,
} from './terrainGrid';
import { AVATAR_KEYS, PLAYER_TEXTURE, avatarTextureKey, createOfficeTextures } from './textures';

/** Clave de la escena (D5): reemplaza `BootScene`, que se retira en este mismo cambio. */
export const OFFICE_SCENE_KEY = 'office';

const PLAYER_SPEED = 230;
// Below both the 14px body height and Arcade's 4px overlap bias, even at 5x.
const WALK_STEP_PX = 3;
const PROXIMITY_TICK_MS = 250;
/** Suavizado de `startFollow` (#53): compartido entre `setupCameras` y el `resumeFollow` de `CameraPanLayer`. */
const FOLLOW_LERP = 0.12;
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
 * Served space floors go over the base ground (0) and the legacy flower tiles
 * (1), under the zone labels (2) and every world asset, which starts at its
 * own bottom edge in pixels.
 */
const SPACE_FLOOR_DEPTH = 1.5;
/** A piece that cannot be drawn yet (or ever) still shows where it goes. */
const ART_FALLBACK_COLOR = 0x6b7280;
const ART_FALLBACK_ALPHA = 0.6;

/**
 * Como se conecta la escena al servidor. `connect` se inyecta para poder
 * probar el cableado sin levantar un Colyseus real: el protocolo por cable ya
 * lo cubren los tests de la capa node contra un servidor de verdad.
 */
export interface OfficeSceneOptions {
  /** The React shell supplies initial desks/spaces before the office can be revealed. */
  waitForOfficeData?: boolean;
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
  /**
   * Manifest of the art pack (art migration, step 4). Defaults to the one the
   * SPA serves; `null` turns the pack off and the office draws its fallbacks.
   */
  artManifestUrl?: string | null;
  /**
   * Manifest of the Admin uploads (#121). Defaults to the office server's
   * (`artUploadsManifestUrl(endpoint)`); `null` leaves the pack alone.
   */
  artUploadsUrl?: string | null;
}

/** A seat the scene can offer or draw a sitter on, resolved from its reference. */
interface ResolvedSeat {
  readonly id: string;
  /** Where the sitter's feet go: the chair ground point. */
  readonly ground: Point;
  readonly facing: ArtFacing;
  readonly reach: SeatTiles;
}

/** How long a sit request waits for the room before it is forgotten. */
const SEAT_ANSWER_MS = 2000;

/** Hint over the seat in reach (Spanish UI copy). */
const SIT_HINT = 'E · Sentarse';
const STAND_HINT = 'E · Levantarse';

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

/**
 * Reduce un snapshot remoto (con posicion) a lo unico que el roster mira
 * (#74). Mismo limite de confianza que `statusOf` en `remoteAvatarSink.ts`:
 * el servidor ya sanea el estado, pero un codigo desconocido no debe dejar la
 * lista sin poder pintar un color.
 */
function rosterPeerOf(snapshot: { sessionId: string; name: string; status: string }): RosterPeer {
  return {
    sessionId: snapshot.sessionId,
    name: snapshot.name,
    status: isPresenceStatus(snapshot.status) ? snapshot.status : DEFAULT_STATUS,
  };
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
  /** The terrain layers, redrawn in place when the terrain changes (#123 phase 2). */
  private terrainTilemap?: TerrainTilemap;
  /** The blocks the room replicated last (#123 phase 2); colliders and `grid` follow them. */
  private terrainBlocks: readonly LayoutMaterial[] = BASE_LAYOUT.blocks;
  /** The terrain editor's local preview, painted over `terrainBlocks` and never collided with. */
  private terrainPreview: TerrainEditCommand['preview'] = null;
  /** The static bodies of the terrain grid and their collider, replaced whole on each edit. */
  private terrainColliders?: { rects: Phaser.GameObjects.Rectangle[]; collider: Phaser.Physics.Arcade.Collider };
  /** The terrain of `terrainBlocks`, kept to rebuild `grid` when the collisions change. */
  private terrain: TerrainSnapshot = BASE_TERRAIN;
  /** The saved collision table the room replicated last; a piece missing here keeps its default. */
  private collisionTable: CollisionTable = new Map();
  /** Every placed piece: the static office plus the served desks and their decor. */
  private collisionInstances: readonly CollisionInstance[] = STATIC_COLLISION_INSTANCES;
  private collisionRects: readonly CollisionRect[] = BASE_COLLISION_RECTS;
  /** One static body per collision rectangle and their collider, replaced whole on each change. */
  private pieceColliders?: { rects: Phaser.GameObjects.Rectangle[]; collider: Phaser.Physics.Arcade.Collider };
  private terrainEditLayer?: TerrainEditLayer;
  private unsubscribeTerrainEdit?: () => void;
  private collisionEditLayer?: CollisionEditLayer;
  private unsubscribeCollisionEdit?: () => void;
  private player!: CharacterContainer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  /** Sit or stand (step 6). Not captured: E has no browser default to block. */
  private sitKey?: Phaser.Input.Keyboard.Key;
  /**
   * The seat the room confirmed for the local player, or `null` standing
   * (step 6). Only `onLocalSeat` sets it: a request alone never seats anyone.
   */
  private seat: ResolvedSeat | null = null;
  /** Seat asked for and not answered yet; moving forgets it. */
  private pendingSeat: string | null = null;
  /** Created the first time a seat comes in reach, so a scene far from any chair adds no text. */
  private seatHint?: Phaser.GameObjects.Text;
  /** Last `characterportraits` payload, so an unchanged set is not re-sent. */
  private lastPortraitsKey = '';
  private readonly portraitCache = new Map<string, string>();
  /**
   * Ultimo valor sincronizado de `isEditableElementFocused()` (#104
   * follow-up): el cierre original de #104 solo comprobo que el AVATAR
   * dejaba de moverse, nunca que la letra llegase al campo.
   * `KeyboardManager.onKeyDown` (Phaser) llama a `event.preventDefault()`
   * para cualquier keyCode en captura (W/A/S/D, mas UP/DOWN/LEFT/RIGHT/SPACE)
   * SIN mirar el foco, asi que esas teclas seguian sin poderse escribir en
   * ningun campo de texto de la pagina. `syncWasdCapture` alterna
   * `enable/disableGlobalCapture()` solo en el flanco de cambio -- son
   * llamadas globales (afectan a toda la escena), no algo para repetir cada
   * frame.
   */
  private wasdCaptureSuspended = false;
  /** Referencias estables para poder quitar los listeners en `SHUTDOWN`. */
  private readonly handleFocusChange = (): void => this.syncWasdCapture();
  private mmMarker?: Phaser.GameObjects.Arc;
  /** Lo crea `setupCameras`; `CameraPanLayer` lo necesita para el clic de navegacion (#98). */
  private minimapCamera?: Phaser.Cameras.Scene2D.Camera;
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
  private unsubscribeToggleSeat?: () => void;
  private unsubscribeSpacesConfig?: () => void;
  private unsubscribeDesks?: () => void;
  private unsubscribeReconnect?: () => void;
  private unsubscribeLayoutEdit?: () => void;
  /**
   * Capa de overlays del editor de layout (#74, PR3b). Se crea siempre en
   * `create()`, este o no activo el modo edicion -- igual que `remotes`/
   * `roster`, cuesta poco y evita un `undefined` que cada punto de uso
   * tendria que comprobar.
   */
  private layoutEditLayer?: LayoutEditLayer;
  /**
   * Capa del pan de camara (#53): se crea despues de `setupInput`, igual que
   * `layoutEditLayer` se crea en su propio punto -- ambas escuchan el mismo
   * `this.input`. `isSuspended` lee `this.layoutEditing` en el momento del
   * `pointerdown` (mismo momento en que `closemenu` ya lo consulta): un
   * `layoutedit` que llega a mitad de un pan ya en curso no lo corta, igual
   * que hoy tampoco corta un auto-walk en curso.
   */
  private cameraPanLayer?: CameraPanLayer;
  /**
   * Grupo de cuerpos de peers vivos (#59): se crea UNA vez en `buildColliders`
   * junto a un unico `collider(player, peerGroup)`, y cada `createPhaserAvatarSink`
   * nuevo (una por conexion, D-diseno) recibe el MISMO grupo -- una
   * reconexion no duplica el colisionador ni pierde a los peers que la
   * sobreviven.
   */
  private peerGroup?: Phaser.GameObjects.Group;
  /**
   * Si el modo edicion esta activo (#74, PR3b): la UNICA cosa que la escena
   * necesita saber de el para suspender claim/release en `drawDesk`. Todo lo
   * demas -- que dibujar, que es pickable, donde va el ghost -- lo sigue
   * `layoutEditLayer` por su cuenta desde el mismo comando `layoutedit`.
   */
  private layoutEditing = false;
  /**
   * Which editor holds the map (#123 phase 2): either one suspends desk
   * clicks, menus and camera pan through `layoutEditing`, which is their OR.
   */
  private layoutCommandActive = false;
  private terrainEditing = false;
  private collisionEditing = false;
  /**
   * Todo lo dibujado del ultimo comando `desks` (#7, slice 5): zonas,
   * etiquetas y decoracion. Se guarda entero porque cada lista nueva sustituye
   * a la anterior y hay que poder retirar la vieja de una vez -- dibujar
   * encima dejaria pintado como ocupado un sitio que alguien acaba de soltar.
   */
  private deskObjects: Phaser.GameObjects.GameObject[] = [];
  /** Last `desks` list, redrawn whole when a piece it needs finishes loading. */
  private desks: readonly OfficeDesk[] = [];
  /** Floors of the served spaces (art step 4), replaced whole like `deskObjects`. */
  private floorObjects: Phaser.GameObjects.GameObject[] = [];
  private floorSpaces: readonly SpaceArea[] = [];
  /** Created in `preload()`, where `this.load` first exists. */
  private art!: ArtPackLoader;
  private readonly pendingRedraws = new Set<() => void>();
  /**
   * Own character as the server replicates it (art migration, step 5); `null`
   * until the room says, and for an older server, which draws the pack
   * default (step 6).
   */
  private localAvatarId: string | null = null;
  /**
   * Whether the own character is known (step 6): the room said, or there is
   * no room. Until then the local player stays procedural rather than show
   * the pack default and then turn into someone else.
   */
  private localAvatarKnown = false;

  /** Read by tests. */
  get playerAvatarId(): string | null {
    return this.localAvatarId;
  }
  private readonly redrawDesks = (): void => this.applyDesks(this.desks);
  private readonly redrawFloors = (): void => this.drawSpaceFloors(this.floorSpaces);
  /**
   * Objetivo de auto-caminata en curso (issue #2, D9/D10). `undefined` cuando
   * nadie esta siendo perseguido: `update()` solo dirige al reductor mientras
   * este campo tiene valor.
   */
  private autoWalk?: AutoWalkState;
  private walkingMs = 0;
  private lastWalkFrame?: number;
  private walkClick?: Phaser.Input.Pointer;

  private readonly resetWalking = (): void => {
    this.walkingMs = 0;
    this.lastWalkFrame = undefined;
    this.autoWalk = undefined;
    this.walkClick = undefined;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
  };

  private readonly options: OfficeSceneOptions;
  private remotes?: RemoteAvatarRegistry<RemoteAvatarContainer>;
  /**
   * Roster de personas conectadas (#74). Creado junto a `this.remotes`, con el
   * mismo `ignoreSessionId`: la lista visible en el HUD nunca incluye al
   * propio jugador.
   */
  private roster?: RosterTracker;
  /**
   * Detector de drift de `spacesVersion` entre pares (#74, PR3a). A
   * diferencia de `remotes`/`roster`, vive DESDE EL ARRANQUE y no se recrea
   * por conexion: el limite de un aviso por version distinta debe sobrevivir
   * a una reconexion, o un `resync` volveria a avisar de una version que ya
   * se atendio.
   */
  private readonly staleSpacesVersion = createStaleSpacesVersionTracker();
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
  /** Why the join was refused, while `connectionState` is `denied` (#129). */
  private deniedReason?: AccessDeniedReason;
  /**
   * Hay un reintento manual en vuelo (#52). Protege el unico camino de este
   * archivo que puede reentrarse desde fuera: el comando `reconnect` lo dispara
   * el HUD, y un humano nervioso pulsa el boton mas de una vez.
   */
  private reconnecting = false;
  private connectionSettled = false;
  private entranceDenied = false;
  private initialSpaces = false;
  private initialDesks = false;
  private entryReported = false;
  private readonly entrancePieces = new Set<string>();

  /** Runs after a real render, never on a timer or just on scene creation. */
  private readonly checkEntry = (): void => {
    if (!this.alive || this.entryReported || this.entranceDenied || !this.connectionSettled) return;
    if (this.options.waitForOfficeData && (!this.initialSpaces || !this.initialDesks)) return;
    if (!this.localAvatarKnown) return;
    if (this.pendingRedraws.size > 0) return;
    const statuses = [...this.entrancePieces].map((id) => this.art.status(id));
    if (this.art.manifest !== null && !statuses.includes('failed') && statuses.includes('loading')) return;
    this.entryReported = true;
    const failed = this.art.manifest === null || statuses.includes('failed') || this.player.sheets === null;
    this.bridge.emit('entry', { state: failed ? 'failed' : 'ready' });
  };

  private requestArt(pieceId: string, onSettled: () => void): ReturnType<ArtPackLoader['request']> {
    if (!this.entryReported) this.entrancePieces.add(pieceId);
    return this.art.request(pieceId, onSettled);
  }

  constructor(bridge: OfficeBridge, options: OfficeSceneOptions = {}) {
    super(OFFICE_SCENE_KEY);
    this.bridge = bridge;
    this.options = options;
  }

  /**
   * Las hojas tienen que estar cargadas antes de que `create()` dibuje: el
   * manifiesto del art pack y todo lo que el mapa pinta de el (art step 8:
   * the terrain tileset and every piece of the Tiled layout).
   */
  preload(): void {
    this.art = new ArtPackLoader(this, {
      manifestUrl: this.options.artManifestUrl,
      uploadsUrl: this.options.artUploadsUrl !== undefined ? this.options.artUploadsUrl : artUploadsManifestUrl(this.options.endpoint),
    });
    this.art.preload();
  }

  create(): void {
    createOfficeTextures(this);
    // Una sola vez, no por sesion: la fidelidad exige la textura real, no un
    // redibujo en React que duplicaria `drawAvatar` y podria desincronizarse
    // de forma invisible (issue #17, D1).
    this.bridge.emit('portraits', { byKey: this.exportPortraits() });

    // The static office is the Tiled layout (art step 8); collisions come from
    // the same walkability rule the room enforces on every `move`.
    const grid: TerrainGrid = buildTerrainGrid(BASE_TERRAIN, BASE_LAYOUT, this.collisionRects);
    this.grid = grid;
    this.terrainTilemap = renderTerrain(this, BASE_TERRAIN, BASE_LAYOUT, this.art);
    placeLayout(this, BASE_LAYOUT, this.art);
    placeSeats(this, BASE_MAP_SEATS, this.art);
    placeZoneLabels(this);

    // El nombre de la sesion manda sobre la pildora del avatar local (#6).
    // Sin sesion (desarrollo local, e2e) cae en `DEFAULT_NAME`, que es como
    // llama el servidor a quien entra sin identidad verificada.
    this.player = spawnPlayer(this, this.options.playerName ?? DEFAULT_NAME, this.characterSheets(null));
    // Only art the initial office actually draws; an unused broken upload cannot block entry.
    for (const id of ['tileset-terrain', BASE_MAP_CHAIR, ...BASE_LAYOUT.walls, ...BASE_LAYOUT.hedges,
      ...BASE_LAYOUT.props.map((prop) => prop.piece)]) {
      if (id !== null) this.entrancePieces.add(id);
    }
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.checkEntry);
    const stopEntry = (): void => {
      this.alive = false;
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.checkEntry);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stopEntry);
    this.events.once(Phaser.Scenes.Events.DESTROY, stopEntry);

    // Arcade's discrete collision checks cannot safely take a whole 5x frame.
    // Step it here in bounded slices, syncing containers after each separation.
    this.physics.disableUpdate();
    this.physics.world.fixedStep = false;
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.resetWalking);
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.resetWalking);
    const removeWalkListeners = (): void => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.resetWalking);
      this.game.events.off(Phaser.Core.Events.VISIBLE, this.resetWalking);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, removeWalkListeners);
    this.events.once(Phaser.Scenes.Events.DESTROY, removeWalkListeners);

    this.buildColliders(grid);
    this.setupCameras();
    // Decals are a few pixels each: at minimap scale they are noise, and a
    // layer less to draw on every frame.
    if (this.terrainTilemap.decals !== null) this.minimapCamera?.ignore(this.terrainTilemap.decals);
    this.setupInput();
    // #53: despues de `setupInput` (comparte `this.input`, mismo momento en
    // que `layoutEditLayer` se crea mas abajo).
    this.cameraPanLayer = new CameraPanLayer({
      scene: this,
      camera: this.cameras.main,
      target: this.player,
      lerp: FOLLOW_LERP,
      worldBounds: { x: 0, y: 0, width: WORLD_W, height: WORLD_H },
      minimap: this.minimapCamera,
      isSuspended: () => this.layoutEditing,
    });

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
    this.unsubscribeToggleSeat = this.bridge.onCommand('toggleSeat', () => this.toggleSeat());

    // #7, slice 3. Llega una sola vez por sesion, poco despues de arrancar.
    this.unsubscribeSpacesConfig = this.bridge.onCommand('spacesconfig', ({ spaces, version }) => {
      this.applySpacesConfig(spaces, version);
    });

    // #7, slice 5. A diferencia del anterior, llega cada vez que alguien coge
    // o suelta un sitio.
    this.unsubscribeDesks = this.bridge.onCommand('desks', ({ desks }) => {
      this.applyDesks(desks);
    });

    // #74, PR3b. La capa dibuja overlays y traduce input por su cuenta
    // (mismo comando); la escena solo se queda con el flag que necesita para
    // gatear `drawDesk`.
    this.layoutEditLayer = new LayoutEditLayer(this, this.bridge);
    this.unsubscribeLayoutEdit = this.bridge.onCommand('layoutedit', (command) => {
      this.layoutCommandActive = command !== null;
      this.layoutEditing = this.layoutCommandActive || this.terrainEditing || this.collisionEditing;
      if (this.layoutEditing) this.resetWalking();
    });

    // #123 phase 2. The layer outlines and picks blocks; the scene paints the
    // preview, and hands the editor the live blocks when it opens.
    this.terrainEditLayer = new TerrainEditLayer(this, this.bridge, BASE_LAYOUT);
    this.unsubscribeTerrainEdit = this.bridge.onCommand('terrainedit', (command) => {
      const opening = command !== null && !this.terrainEditing;
      this.terrainEditing = command !== null;
      this.layoutEditing = this.layoutCommandActive || this.terrainEditing || this.collisionEditing;
      if (this.layoutEditing) this.resetWalking();
      const preview = command?.preview ?? null;
      const repaint = encodePreview(preview) !== encodePreview(this.terrainPreview);
      this.terrainPreview = preview;
      if (repaint) this.paintTerrain();
      if (opening) this.bridge.emit('terrain', { blocks: this.terrainBlocks });
    });

    // The collision editor: the layer draws the draft and picks pieces from
    // the live collisions; the scene only holds the map clicks for it.
    this.collisionEditLayer = new CollisionEditLayer(this, this.bridge, {
      instances: () => this.collisionInstances,
      table: () => this.collisionTable,
    });
    // Outlines a few pixels wide are noise at minimap scale.
    const collisionOutlines = this.children.getByName(COLLISION_EDIT_GRAPHICS_NAME);
    if (collisionOutlines !== null) this.minimapCamera?.ignore(collisionOutlines);
    this.unsubscribeCollisionEdit = this.bridge.onCommand('collisionedit', (command) => {
      this.collisionEditing = command !== null;
      this.layoutEditing = this.layoutCommandActive || this.terrainEditing || this.collisionEditing;
      if (this.layoutEditing) this.resetWalking();
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
      this.roster?.clear();
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
        this.standUp();
        this.player.setPosition(tx * TILE + 16, ty * TILE + 16);
      });
    }

    // Los listeners de `window` de `syncWasdCapture` se limpian en DESTROY, no
    // en SHUTDOWN: `SceneManager.destroy()` (lo que corre `game.destroy()`,
    // usado por ejemplo en el `afterEach` de los tests) llama a
    // `Systems.destroy()` DIRECTAMENTE sobre cada escena y esta SOLO emite
    // `Events.DESTROY` -- nunca pasa por `Systems.shutdown()`, asi que un
    // `SHUTDOWN` aqui no se dispararia nunca y el listener en `window`
    // (compartido por TODO el documento, no solo por esta escena) quedaria
    // vivo apuntando a un juego ya destruido.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.removeEventListener('focusin', this.handleFocusChange);
      window.removeEventListener('focusout', this.handleFocusChange);
    });

    const cleanupOffice = (): void => {
      this.alive = false;
      this.unsubscribeSetStatus?.();
      this.unsubscribeSpeakers?.();
      this.unsubscribeTeleportToTile?.();
      this.unsubscribeCallPeer?.();
      this.unsubscribeRespondCall?.();
      this.unsubscribeWalkToPeer?.();
      this.unsubscribeToggleSeat?.();
      this.unsubscribeSpacesConfig?.();
      this.unsubscribeDesks?.();
      this.unsubscribeReconnect?.();
      this.unsubscribeLayoutEdit?.();
      this.layoutEditLayer?.destroy();
      this.unsubscribeTerrainEdit?.();
      this.terrainEditLayer?.destroy();
      this.unsubscribeCollisionEdit?.();
      this.collisionEditLayer?.destroy();
      this.cameraPanLayer?.destroy();
      this.remotes?.clear();
      this.roster?.clear();
      void this.connection?.leave();
      this.connection = undefined;
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupOffice);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanupOffice);

    this.time.addEvent({
      delay: PROXIMITY_TICK_MS,
      loop: true,
      callback: () => this.proximityTick(),
    });

    void this.connectToOffice().finally(() => { this.connectionSettled = true; });
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
      // Alone, nobody will name a character: the pack default it is.
      this.adoptLocalAvatar(null);
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
            // On add, and on a change only when the character itself changed:
            // `onChange` fires on every move, and a character changes during
            // a session only when it is retired (#122).
            this.requestCharacter(snapshot.avatarId);
            this.remotes?.upsert(snapshot);
            this.roster?.upsert(rosterPeerOf(snapshot));
            this.checkSpacesVersionDrift(snapshot.spacesVersion);
            this.emitPresence();
            this.emitCharacterPortraits();
          },
          onChange: (snapshot) => {
            const previous = this.remotes?.get(snapshot.sessionId)?.avatarId;
            if (previous !== undefined && previous !== snapshot.avatarId) this.requestCharacter(snapshot.avatarId);
            this.remotes?.upsert(snapshot);
            this.roster?.upsert(rosterPeerOf(snapshot));
            this.checkSpacesVersionDrift(snapshot.spacesVersion);
          },
          onRemove: (sessionId) => {
            this.remotes?.remove(sessionId);
            this.roster?.remove(sessionId);
            this.emitPresence();
            this.emitCharacterPortraits();
          },
          // Issue #2: mensajes sueltos del servidor, no estado sincronizado
          // (D4) -- se relanzan tal cual al puente, mismo patron que el resto
          // de este objeto de handlers.
          onCallInvite: (payload) => this.bridge.emit('callinvite', payload),
          onCallerLeft: (payload) => this.bridge.emit('callerleft', payload),
          onCallAccepted: (payload) => this.bridge.emit('callaccepted', payload),
          onRecordings: (active) => this.bridge.emit('recordings', { active }),
          onRecordingReady: (payload) => this.bridge.emit('recordingready', payload),
          onDesksChanged: () => this.bridge.emit('deskschanged', undefined),
          onTerrain: (blocks) => this.applyTerrain(blocks),
          onCollisions: (table) => this.applyCollisions(table),
          onConnectionState: (state) => this.emitPresence(state),
          onLocalAvatar: (avatarId) => this.adoptLocalAvatar(avatarId),
          onLocalSeat: (seat) => this.onLocalSeat(seat),
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
      // `this.bridge` desde su constructor. Issue #59: tambien recibe
      // `peerGroup`, el mismo de siempre, para que cada peer nazca con
      // cuerpo de colision.
      this.remotes = createRemoteAvatarRegistry(
        createPhaserAvatarSink(this, this.bridge, this.peerGroup, (avatarId) => this.characterSheets(avatarId)),
        { ignoreSessionId: connection.sessionId },
      );
      this.roster = createRosterTracker((peers) => this.bridge.emit('roster', { peers }), {
        ignoreSessionId: connection.sessionId,
      });
      this.emitPresence('connected');
      this.emitCharacterPortraits();
      // Sesion viva, todavia sin pares conocidos (el primer tic los completa).
      this.emitVoice(connection.sessionId, [], this.currentSpaceId);
    } catch (error) {
      if (!this.alive) return;
      if (!this.localAvatarKnown) this.adoptLocalAvatar(null);
      // #129: a refused account is not a missing server. "Sin servidor" with
      // its retry button would send the person against a server that is up
      // and has already said no; `denied` hands the reason up instead.
      if (error instanceof OfficeAccessDeniedError) {
        this.entranceDenied = true;
        this.emitPresence('denied', error.reason);
      }
      else this.emitPresence('offline');
      this.emitVoice(null, [], this.currentSpaceId);
    }
  }

  /**
   * The own character, as the room replicates it or the pack default alone.
   * Redrawn at once: a character whose sheets are still loading shows the
   * procedural body until they land, never the previous character.
   */
  private adoptLocalAvatar(avatarId: string | null): void {
    this.localAvatarId = avatarId;
    this.localAvatarKnown = true;
    this.requestCharacter(avatarId);
    this.redrawCharacters();
  }

  /**
   * Starts loading a character's sheets as soon as its id is known (art
   * migration, step 5), and redraws every avatar once they settle (step 6).
   * Until then, and for good if they fail, the avatar keeps its procedural
   * body. `null` (no character replicated) is the pack default.
   */
  private requestCharacter(avatarId: string | null): void {
    const id = avatarId ?? this.art.manifest?.defaults.character;
    if (id === undefined || !this.alive) return;
    if (this.requestArt(id, () => this.scheduleRedraw(this.redrawCharacters)) === 'ready') this.redrawCharacters();
  }

  /** Loaded sheets of a character (`null` is the pack default), or `null` to stay procedural. */
  private characterSheets(avatarId: string | null): CharacterSheets | null {
    const id = avatarId ?? this.art.manifest?.defaults.character;
    if (id === undefined) return null;
    const walk = this.art.sheet(id, 'walk');
    const seated = this.art.sheet(id, 'seated');
    return walk === null || seated === null ? null : { walk, seated };
  }

  private readonly redrawCharacters = (): void => {
    setCharacterSheets(this.player, this.localAvatarKnown ? this.characterSheets(this.localAvatarId) : null);
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (avatar) setCharacterSheets(avatar, this.characterSheets(avatar.avatarId));
    }
    this.emitCharacterPortraits();
  };

  /**
   * Pack portrait of every session whose character is loaded (step 6), for
   * the video tiles: the idle frame facing the viewer, exported once per
   * character and only re-sent when the set changes.
   */
  private emitCharacterPortraits(): void {
    const bySession: Record<string, string> = {};
    const keys: string[] = [];
    const add = (sessionId: string | undefined, avatarId: string | null): void => {
      const sheets = this.characterSheets(avatarId);
      if (sessionId === undefined || sheets === null) return;
      keys.push(`${sessionId}:${sheets.walk}`);
      let portrait = this.portraitCache.get(sheets.walk);
      if (portrait === undefined) {
        portrait = this.textures.getBase64(sheets.walk, walkFrame('S', 'idle'));
        this.portraitCache.set(sheets.walk, portrait);
      }
      bySession[sessionId] = portrait;
    };
    if (this.localAvatarKnown) add(this.connection?.sessionId, this.localAvatarId);
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      add(sessionId, this.remotes?.get(sessionId)?.avatarId ?? null);
    }
    const key = keys.sort().join('|');
    if (key === this.lastPortraitsKey) return;
    this.lastPortraitsKey = key;
    this.bridge.emit('characterportraits', { bySession });
  }

  /**
   * A seat by reference (step 6): a base map chair, or the chair of a desk in
   * the last `desks` list. `null` when this client cannot place it.
   */
  private resolveSeat(id: string): ResolvedSeat | null {
    const ref = parseSeatRef(id);
    if (ref === null) return null;
    if (ref.kind === 'map') {
      const seat = BASE_MAP_SEATS[ref.index];
      return { id, ground: { x: (seat.tx + 0.5) * TILE, y: (seat.ty + 0.5) * TILE }, facing: seat.facing, reach: mapSeatTiles(seat) };
    }
    const desk = this.desks.find((candidate) => candidate.id === ref.deskId);
    return desk === undefined ? null : this.deskSeat(desk);
  }

  private deskSeat(desk: OfficeDesk): ResolvedSeat {
    const anchor = deskAreaAnchor(desk);
    const materialId = desk.appearance?.materialId ?? this.art.manifest?.defaults.desk;
    const piece = materialId === undefined || this.art.manifest === null ? undefined : findPiece(this.art.manifest, materialId);
    // The desk art says where its chair goes; without the catalog the middle
    // of the area is as close as this client can tell.
    const offset = piece?.kind === 'desk' ? piece.facings[DEFAULT_DESK_FACING].chairGround : { x: 0, y: 0 };
    return {
      id: deskSeatId(desk.id),
      ground: { x: anchor.x + offset.x, y: anchor.y + offset.y },
      facing: DEFAULT_DESK_FACING,
      reach: deskSeatTiles({ x: desk.x / TILE, y: desk.y / TILE }),
    };
  }

  /**
   * The free seat in reach closest to the feet, if any. A seat is free when
   * no peer sits on it and, at a desk, when the desk is unclaimed or claimed
   * by this player: the same rules the room applies, so the scene does not
   * offer what the room would refuse.
   */
  private seatInReach(): ResolvedSeat | null {
    const taken = new Set<string>();
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const seat = this.remotes?.get(sessionId)?.seat;
      if (seat) taken.add(seat);
    }
    const candidates: ResolvedSeat[] = [];
    BASE_MAP_SEATS.forEach((_, index) => {
      const seat = this.resolveSeat(mapSeatId(index));
      if (seat) candidates.push(seat);
    });
    for (const desk of this.desks) {
      if (desk.occupant === null || desk.mine) candidates.push(this.deskSeat(desk));
    }
    const feet = feetOf(this.player);
    let best: ResolvedSeat | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const seat of candidates) {
      if (taken.has(seat.id) || !inSeatReach(this.player, seat.reach)) continue;
      const distance = Math.hypot(seat.ground.x - feet.x, seat.ground.y - feet.y);
      if (distance < bestDistance) {
        best = seat;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** E, or the `toggleSeat` command: stand when seated, else ask for the seat in reach. */
  private toggleSeat(): void {
    if (this.seat !== null || this.pendingSeat !== null) {
      this.standUp();
      return;
    }
    const seat = this.seatInReach();
    if (seat === null) return;
    this.pendingSeat = seat.id;
    // Offline nobody else can see or contest the seat, so it is taken here.
    if (!this.connection) {
      this.onLocalSeat(seat.id);
      return;
    }
    this.connection.sendSit(seat.id);
    // The room refuses without a word; after a while the request is
    // forgotten, so the next E asks again instead of standing up.
    this.time.delayedCall(SEAT_ANSWER_MS, () => {
      if (this.pendingSeat === seat.id) this.pendingSeat = null;
    });
  }

  /**
   * The room's answer about the own seat. A seat that was asked for puts the
   * player on it: feet on the chair ground, still, facing the seat, and out
   * of the collider so the table next to the chair cannot shove the sitter
   * off it. One nobody asked for (the request was abandoned by walking away)
   * is given back.
   */
  private onLocalSeat(seatId: string | null): void {
    if (seatId === null) {
      this.pendingSeat = null;
      this.leaveSeat();
      return;
    }
    if (this.seat?.id === seatId) return;
    const seat = this.pendingSeat === seatId ? this.resolveSeat(seatId) : null;
    this.pendingSeat = null;
    if (seat === null) {
      this.connection?.sendStand();
      return;
    }
    this.resetWalking();
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.checkCollision.none = true;
    const stand = positionForFeet(seat.ground);
    this.player.setPosition(stand.x, stand.y);
    this.facing = seat.facing;
    setCharacterFacing(this.player, seat.facing);
    this.player.seatFacing = seat.facing;
    this.seat = seat;
    this.connection?.sendMove(stand.x, stand.y, seat.facing);
  }

  /** Stands the local player up and tells the room (E again, walking, a teleport). */
  private standUp(): void {
    if (this.seat === null && this.pendingSeat === null) return;
    this.pendingSeat = null;
    this.leaveSeat();
    this.connection?.sendStand();
  }

  private leaveSeat(): void {
    if (this.seat === null) return;
    this.seat = null;
    this.player.seatFacing = null;
    (this.player.body as Phaser.Physics.Arcade.Body).checkCollision.none = false;
  }

  /** Keeps the E hint over the seat in reach, or over the own seat while seated. */
  private updateSeatHint(): void {
    const seat = this.seat ?? (this.pendingSeat === null ? this.seatInReach() : null);
    if (seat === null) {
      this.seatHint?.setVisible(false);
      return;
    }
    if (this.seatHint === undefined) {
      this.seatHint = this.add
        .text(0, 0, SIT_HINT, {
          fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
          fontSize: '11px',
          color: '#f9fafb',
          backgroundColor: '#111827cc',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setDepth(MINIMAP_MARKER_DEPTH - 1);
      this.minimapCamera?.ignore(this.seatHint);
    }
    this.seatHint
      .setText(this.seat === null ? SIT_HINT : STAND_HINT)
      .setPosition(seat.ground.x, seat.ground.y - 64)
      .setVisible(true);
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
    this.roster?.clear();
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
    this.initialSpaces = true;
    // Before the version check: floors are outside the hash, so a served config
    // equal to the built-in one still brings the floors to draw.
    this.drawSpaceFloors(spaces);

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
   * Un par reporto una version distinta de la mia (#74, PR3a): sea porque
   * acaba de llegar con ella (`onAdd`) o porque un par ya conectado la cambio
   * (`onChange`, tras una edicion en oficina o desde `/dashboard` -- las dos
   * publican por el mismo estado replicado). El predicado decide si vale la
   * pena avisar; `OfficeShell` es quien de verdad relee `/spaces` y `/desks`.
   */
  private checkSpacesVersionDrift(peerVersion: string): void {
    if (this.staleSpacesVersion(peerVersion, this.spacesVersion)) {
      this.bridge.emit('spacesstale', { version: peerVersion });
    }
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
    this.initialDesks = true;
    this.desks = desks;
    // Desks and their decor collide by their pieces' rectangles, wherever the list puts them.
    this.collisionInstances = officeCollisionInstances(desks);
    this.refreshCollisions();
    for (const object of this.deskObjects.splice(0)) object.destroy();
    for (const desk of desks) this.drawDesk(desk);
  }

  /**
   * Loaded sheet of an appearance, or `null`. When the piece is not loaded yet
   * it asks the loader for it and redraws once it settles; a piece of the
   * wrong kind (a desk id as a floor) never draws.
   */
  private artSheet(appearance: ArtAppearance, kind: 'desk' | 'floor' | 'chair', redraw: () => void): { key: string; piece: ArtPiece } | null {
    const known = (): ArtPiece | undefined =>
      this.art.manifest === null ? undefined : findPiece(this.art.manifest, appearance.materialId);
    const ready = (): { key: string; piece: ArtPiece } | null => {
      const piece = known();
      if (piece === undefined || piece.kind !== kind) return null;
      const key = this.art.sheet(piece.id, 'sheet', appearance.color);
      return key === null ? null : { key, piece };
    };
    const now = ready();
    if (now !== null) return now;
    const piece = known();
    if (piece !== undefined && piece.kind !== kind) return null;
    return this.requestArt(appearance.materialId, () => this.scheduleRedraw(redraw)) === 'ready' ? ready() : null;
  }

  /**
   * Every placement waiting on a piece asks for the same redraw when it lands;
   * one pass per batch is enough, and none after the scene is gone.
   */
  private scheduleRedraw(redraw: () => void): void {
    if (this.pendingRedraws.has(redraw)) return;
    this.pendingRedraws.add(redraw);
    queueMicrotask(() => {
      this.pendingRedraws.delete(redraw);
      if (this.alive) redraw();
    });
  }

  /**
   * Floors of the served spaces (art migration, step 4), a desk's cubicle
   * included, in their persisted material and color. Built-in rooms without a
   * served floor keep the terrain of the layout under them.
   * A floor that cannot load shows a neutral veil over the space, so a room
   * with a broken floor still reads as a room.
   */
  private drawSpaceFloors(spaces: readonly SpaceArea[]): void {
    this.floorSpaces = spaces;
    for (const object of this.floorObjects.splice(0)) object.destroy();
    for (const space of spaces) {
      if (space.floor === undefined) continue;
      const sheet = this.artSheet(space.floor, 'floor', this.redrawFloors);
      if (sheet === null) {
        this.floorObjects.push(
          this.add
            .rectangle(space.x + space.w / 2, space.y + space.h / 2, space.w, space.h, ART_FALLBACK_COLOR, DESK_FILL_ALPHA)
            .setDepth(SPACE_FLOOR_DEPTH),
        );
        continue;
      }
      for (const { tx, ty } of spaceFloorTiles(space, this.grid)) {
        this.floorObjects.push(putFloorTile(this, sheet.key, tx, ty, SPACE_FLOOR_DEPTH));
      }
    }
  }

  /**
   * The desk furniture in the middle of the area: its persisted material and
   * color, at native size and in the exported facing, never stretched to the
   * 3x3 area. Without an appearance (an older server) it is the pack default.
   *
   * Same depth as the zone and drawn after it, so the status tint stays a floor
   * marker under the desk instead of a veil over it; decor goes on top.
   */
  private drawDeskFurniture(desk: OfficeDesk, depth: number): void {
    const name = deskFurnitureName(desk.id);
    const anchor = deskAreaAnchor(desk);
    const materialId = desk.appearance?.materialId ?? this.art.manifest?.defaults.desk;
    const sheet =
      materialId === undefined
        ? null
        : this.artSheet({ materialId, color: desk.appearance?.color ?? null }, 'desk', this.redrawDesks);

    if (sheet === null || sheet.piece.kind !== 'desk') {
      // Same visible fallback as a decor piece without texture: the desk is
      // there even when its art is not, sized like the 2x1 footprint.
      this.deskObjects.push(
        this.add
          .rectangle(anchor.x, anchor.y, 2 * TILE, TILE, ART_FALLBACK_COLOR, ART_FALLBACK_ALPHA)
          .setDepth(depth)
          .setName(name),
      );
      return;
    }
    const placement = deskPlacement(sheet.piece, DEFAULT_DESK_FACING, anchor);
    this.deskObjects.push(putArtSprite(this, sheet.key, placement, depth).setName(name));

    // Its chair (step 6), where the room seats people at this desk. Sorted
    // by its own ground, under the desk, so the desk covers the sitter's legs.
    const chair = this.artSheet({ materialId: BASE_MAP_CHAIR, color: null }, 'chair', this.redrawDesks);
    if (chair !== null && chair.piece.kind === 'chair') {
      this.deskObjects.push(...putChair(this, chair.key, chairPlacement(chair.piece, DEFAULT_DESK_FACING, placement.chairGround)));
    }
  }

  /**
   * Dibuja la zona de 3x3 de un escritorio, su etiqueta y la decoracion de
   * quien lo ocupe.
   *
   * The depth is the BOTTOM edge of the area in the world band, same
   * convention as `placeLayout` (`(y + h) * TILE`), so the desk y-sorts
   * against the furniture around it. Avatars live in their own band above it
   * (#70, `depthLayers.ts`), so whoever walks over the desk is never hidden.
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
    const bottom = desk.y + desk.h;
    const depth = worldAssetDepth(bottom);

    // A floor marker (step 6): at the furniture's depth it would veil
    // whoever sits at the desk.
    const zone = this.add
      .rectangle(desk.x + desk.w / 2, desk.y + desk.h / 2, desk.w, desk.h, color, DESK_FILL_ALPHA)
      .setStrokeStyle(DESK_STROKE_WIDTH, color)
      .setDepth(DESK_ZONE_DEPTH)
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

    this.drawDeskFurniture(desk, depth);

    for (const item of desk.occupant?.items ?? []) {
      // `null` = ese slot no es una de las nueve cajas. Se salta la pieza y no
      // el escritorio: pintarla en una caja inventada la dejaria fuera del
      // area, y renunciar al escritorio entero quitaria un sitio que si existe.
      const box = deskSlotRect(desk, item.slot);
      if (box === null) continue;
      // A special piece (#71) keeps the same bottom edge but moves to the band
      // above avatars, so it covers whoever walks through the desk.
      const itemDepth = item.aboveAvatars ? specialAssetDepth(bottom) : depth;
      this.deskObjects.push(
        this.drawDeskItem(item.id, item.textureKey, item.rotation, box, itemDepth),
      );
    }

    // Un escritorio ajeno no se hace clicable siquiera: no tiene ninguna
    // accion que ofrecer, y `release` solo suelta el propio.
    if (desk.occupant !== null && !mine) return;

    zone.setInteractive();
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // #74, PR3b: en modo edicion, un clic sobre un escritorio es cosa del
      // editor de layout (`layoutEditLayer`, que ya escucha su propio
      // `pointerdown` global), no una oferta de coger/soltar. Se retorna sin
      // `stopPropagation` para no tragarse el clic que el editor necesita.
      if (this.layoutEditing) return;
      // #98: por el minimapa el clic es navegacion (`CameraPanLayer`), no
      // una oferta de coger/soltar un escritorio que ahi mide unos pixeles.
      if (pointer.camera && pointer.camera !== this.cameras.main) return;
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

    // A key of the art pack or an upload (#121) is loaded on demand, like a
    // desk material: the fallback below stays until it lands, then redraws.
    const art = parseArtSheetKey(textureKey);
    if (art !== null && !this.textures.exists(textureKey)) {
      this.requestArt(art.pieceId, () => this.scheduleRedraw(this.redrawDesks));
    }

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
  private emitPresence(state: OfficeConnectionState = this.connectionState, reason?: AccessDeniedReason): void {
    this.connectionState = state;
    if (state !== 'denied') this.deniedReason = undefined;
    else if (reason !== undefined) this.deniedReason = reason;
    const endpoint = this.options.endpoint;
    this.bridge.emit('presence', {
      // Se conserva con su significado exacto de siempre para que ensanchar el
      // evento no le cambie el sentido en silencio a nada rio abajo.
      online: state === 'connected',
      peers: this.remotes?.sessionIds().length ?? 0,
      state,
      // Only on `denied` (#129), so every other payload keeps its exact shape.
      ...(state === 'denied' && { reason: this.deniedReason ?? 'unauthorized' }),
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

  /**
   * Fusiona tiles solidos en rectangulos estaticos y los colisiona con el
   * jugador (app.js:392-408, D6). Tambien crea el grupo de peers (#59) y su
   * unico colisionador: vacio al arrancar, se llena segun `remoteAvatarSink`
   * les da cuerpo en `create()`.
   */
  private buildColliders(grid: TerrainGrid): void {
    this.buildTerrainColliders(grid);
    this.buildPieceColliders();

    this.peerGroup = this.add.group();
    this.physics.add.collider(this.player, this.peerGroup);
  }

  /** The static bodies of `grid`, replacing the previous ones (#123 phase 2: blocks change live). */
  private buildTerrainColliders(grid: TerrainGrid): void {
    if (this.terrainColliders) {
      this.physics.world.removeCollider(this.terrainColliders.collider);
      for (const rect of this.terrainColliders.rects) rect.destroy();
    }
    const rects = mergeColliderRects(grid.terrainSolid).map((r) => {
      const w = r.w * TILE;
      const h = r.h * TILE;
      const rect = this.add.rectangle(r.x * TILE + w / 2, r.y * TILE + h / 2, w, h);
      this.physics.add.existing(rect, true);
      return rect;
    });
    this.terrainColliders = { rects, collider: this.physics.add.collider(this.player, rects) };
  }

  /**
   * One static body per collision rectangle of the pieces, replacing the
   * previous ones. Not merged: there are a few hundred at most, and each one
   * is exactly the rectangle the room checks the body center against.
   */
  private buildPieceColliders(): void {
    if (this.pieceColliders) {
      this.physics.world.removeCollider(this.pieceColliders.collider);
      for (const rect of this.pieceColliders.rects) rect.destroy();
    }
    const rects = this.collisionRects.map((r) => {
      const rect = this.add.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
      this.physics.add.existing(rect, true);
      return rect;
    });
    this.pieceColliders = { rects, collider: this.physics.add.collider(this.player, rects) };
  }

  /**
   * The rectangles of every placed piece from the live table and desks: the
   * static bodies and the tile helpers' grid follow at once, so what the
   * player bumps into is what the room enforces.
   */
  private refreshCollisions(): void {
    if (!this.alive || this.player === undefined) return;
    this.collisionRects = collisionWorld(this.collisionInstances, this.collisionTable);
    this.grid = buildTerrainGrid(this.terrain, BASE_LAYOUT, this.collisionRects);
    this.buildPieceColliders();
    this.collisionEditLayer?.refresh();
  }

  /** A new collision table from the room: on the first sync and after every accepted edit. */
  private applyCollisions(table: CollisionTable): void {
    if (!this.alive) return;
    if (encodeCollisionTable(table) === encodeCollisionTable(this.collisionTable)) return;
    this.collisionTable = table;
    this.refreshCollisions();
  }

  /**
   * New blocks from the room (#123 phase 2): the walkability grid, the
   * colliders and the tilemap follow them at once, so what the player bumps
   * into is what the room enforces. The first sync usually repeats the
   * committed blocks, which changes nothing.
   */
  private applyTerrain(blocks: readonly LayoutMaterial[]): void {
    if (!this.alive) return;
    if (encodeTerrainBlocks(blocks) !== encodeTerrainBlocks(this.terrainBlocks)) {
      this.terrainBlocks = blocks;
      this.terrain = terrainSnapshot(BASE_LAYOUT, blocks);
      this.grid = buildTerrainGrid(this.terrain, BASE_LAYOUT, this.collisionRects);
      this.buildTerrainColliders(this.grid);
      this.paintTerrain();
    }
    this.bridge.emit('terrain', { blocks });
  }

  /** Redraws the tilemap from the live blocks, with the editor's preview over them. */
  private paintTerrain(): void {
    const preview = this.terrainPreview;
    const shown = preview === null ? this.terrainBlocks : withBlock(this.terrainBlocks, preview.index, preview.material);
    this.terrainTilemap?.refresh(terrainSnapshot(BASE_LAYOUT, shown));
  }

  /** Camara principal siguiendo al jugador + minimapa en la esquina superior derecha (app.js:410-431). */
  private setupCameras(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.startFollow(this.player, true, FOLLOW_LERP, FOLLOW_LERP);
    cam.setBackgroundColor('#0d1117');

    const minimap = this.cameras.add(
      this.scale.width - (MINIMAP_WIDTH + RAIL_RIGHT),
      MINIMAP_MARGIN,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    minimap.setZoom(Math.min(MINIMAP_WIDTH / WORLD_W, MINIMAP_HEIGHT / WORLD_H));
    minimap.centerOn(WORLD_W / 2, WORLD_H / 2);
    minimap.setBackgroundColor(0x0d1117);
    this.minimapCamera = minimap;

    this.mmMarker = this.add.circle(0, 0, 42, 0xffffff, 0.45).setDepth(MINIMAP_MARKER_DEPTH);
    cam.ignore(this.mmMarker);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      minimap.setPosition(gameSize.width - (MINIMAP_WIDTH + RAIL_RIGHT), MINIMAP_MARGIN);
    });
  }

  /**
   * Alterna `KeyboardPlugin.enable/disableGlobalCapture()` (#104 follow-up)
   * segun si un input/textarea/contenteditable tiene el foco. Se llama desde
   * `focusin`/`focusout` en `window`, que disparan de forma SINCRONA en cuanto
   * cambia `document.activeElement` -- a diferencia de comprobarlo en
   * `update()`, que solo corre una vez por frame y llegaria tarde si la
   * primera tecla se pulsa en el mismo instante en que se hace foco.
   */
  private syncWasdCapture(): void {
    const editableFocused = isEditableElementFocused();
    if (editableFocused === this.wasdCaptureSuspended) return;

    const keyboard = this.input.keyboard as Phaser.Input.Keyboard.KeyboardPlugin;
    if (editableFocused) keyboard.disableGlobalCapture();
    else keyboard.enableGlobalCapture();
    this.wasdCaptureSuspended = editableFocused;
  }

  /** WASD + flechas; el menu contextual se cierra al hacer clic fuera de el (app.js:433-441). */
  private setupInput(): void {
    const keyboard = this.input.keyboard as Phaser.Input.Keyboard.KeyboardPlugin;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as WasdKeys;
    keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
    this.sitKey = keyboard.addKey('E', false);

    // `focusin`/`focusout` (a diferencia de `focus`/`blur`) burbujean, asi que
    // un solo listener en `window` ve cualquier campo de la pagina, sin
    // importar donde lo monte React.
    window.addEventListener('focusin', this.handleFocusChange);
    window.addEventListener('focusout', this.handleFocusChange);

    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        this.walkClick = undefined;
        // #74, PR3b: un clic en el mapa en modo edicion es una confirmacion
        // de colocacion para `layoutEditLayer` (su propio listener global en
        // el mismo `this.input`), no una peticion de cerrar el menu
        // contextual -- que ademas no puede haber abierto mientras se edita.
        if (this.layoutEditing) return;
        if (!currentlyOver || currentlyOver.length === 0) {
          this.bridge.emit('closemenu', undefined);
          if (pointer.button === 0 && pointer.camera === this.cameras.main) this.walkClick = pointer;
        }
      },
    );
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Once it was a drag, returning to its origin must not turn it into a click.
      if (pointer === this.walkClick && pointer.getDistance() > PAN_THRESHOLD_PX) this.walkClick = undefined;
    });
    this.input.on('pointerupoutside', () => { this.walkClick = undefined; });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const eligible = pointer === this.walkClick;
      this.walkClick = undefined;
      if (!eligible || this.layoutEditing || over?.length || pointer.camera !== this.cameras.main ||
        pointer.getDistance() > PAN_THRESHOLD_PX || !Number.isFinite(pointer.worldX) || !Number.isFinite(pointer.worldY)) return;
      if (isBlocked(this.grid, Math.floor(pointer.worldX / TILE), Math.floor(pointer.worldY / TILE))) return;
      this.standUp();
      this.autoWalk = beginAutoWalk({ x: pointer.worldX, y: pointer.worldY }, this.player);
    });
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
   *
   * Issue #10, S2 3.2: si quien llama esta dentro de un espacio (sala o
   * cubiculo de escritorio, `detectSpace` no distingue), el destino se
   * restringe a ESE rectangulo en vez de la tile libre mas cercana sin mas --
   * aterrizar justo al otro lado de un muro o fuera del cubiculo dejaria al
   * jugador fuera del audio de quien llamo.
   *
   * Issue #59: el lado elegido dentro de ese rectangulo (o alrededor del
   * peer, sin espacio) ya no es un orden fijo -- `pickApproachTile` apunta al
   * lado por el que el jugador se acerca, y cae a la busqueda de siempre si
   * ese lado esta bloqueado o fuera del espacio.
   */
  private walkToPeer(sessionId: string): void {
    const peer = this.remotes?.get(sessionId);
    if (!peer) return; // se desconecto antes de que esto corriera: no-op silencioso.

    const walkerTile = { tx: Math.floor(this.player.x / TILE), ty: Math.floor(this.player.y / TILE) };
    const peerTile = { tx: Math.floor(peer.x / TILE), ty: Math.floor(peer.y / TILE) };
    const peerSpace = detectSpace({ x: peer.x, y: peer.y }, this.spaces);
    const peerSpaceTiles: TileRect | null = peerSpace
      ? {
          x0: peerSpace.x / TILE,
          y0: peerSpace.y / TILE,
          x1: peerSpace.x / TILE + peerSpace.w / TILE - 1,
          y1: peerSpace.y / TILE + peerSpace.h / TILE - 1,
        }
      : null;

    const destination = pickApproachTile(this.grid, walkerTile, peerTile, peerSpaceTiles);
    if (!destination) return;
    this.standUp();

    this.autoWalk = beginAutoWalk(
      { x: destination.tx * TILE + 16, y: destination.ty * TILE + 16 },
      this.player,
    );
  }

  update(time: number, delta: number): void {
    let vx = 0;
    let vy = 0;
    // #104: WASD binds on `window` (Phaser's default keyboard target), so it
    // fires even while a side-panel text field has focus. While that's the
    // case, WASD is left out of movement so the letters get typed instead;
    // the arrow keys are unaffected on purpose (out of scope for this bug).
    const wasdActive = !isEditableElementFocused();
    if (this.cursors.left.isDown || (wasdActive && this.wasd.A.isDown)) vx = -1;
    else if (this.cursors.right.isDown || (wasdActive && this.wasd.D.isDown)) vx = 1;
    if (this.cursors.up.isDown || (wasdActive && this.wasd.W.isDown)) vy = -1;
    else if (this.cursors.down.isDown || (wasdActive && this.wasd.S.isDown)) vy = 1;
    if (this.layoutEditing) { vx = 0; vy = 0; }

    // Step 6: E sits or stands, and walking stands up first.
    if (this.sitKey !== undefined && wasdActive && Phaser.Input.Keyboard.JustDown(this.sitKey)) this.toggleSeat();
    if (vx !== 0 || vy !== 0) this.standUp();

    const from = { x: this.player.x, y: this.player.y };
    const gap = this.lastWalkFrame === undefined ? delta : time - this.lastWalkFrame;
    const interrupted = this.layoutEditing || document.hidden || !Number.isFinite(delta) ||
      delta <= 0 || delta > MAX_WALK_FRAME_MS || !Number.isFinite(gap) || gap < 0 || gap > MAX_WALK_FRAME_MS;
    if (interrupted) this.resetWalking();
    this.lastWalkFrame = time;
    if (!interrupted) {
      // Bound using the highest speed this frame could reach, not just its first slice.
      const peakSpeed = PLAYER_SPEED * walkingMultiplier(this.walkingMs + delta);
      const steps = vx === 0 && vy === 0 && !this.autoWalk ? 1
        : Math.ceil((delta * peakSpeed) / (1000 * WALK_STEP_PX));
      const stepMs = delta / steps;
      for (let i = 0; i < steps; i++) this.stepWalking(time, stepMs, vx, vy);
    }

    setCharacterFacing(this.player, this.facing);
    animateCharacter(this.player, {
      dx: this.player.x - from.x,
      dy: this.player.y - from.y,
      dtMs: interrupted ? 0 : delta,
    });

    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (!avatar) continue;
      animateCharacter(avatar, { dx: avatar.x - avatar.lastX, dy: avatar.y - avatar.lastY, dtMs: delta });
      avatar.lastX = avatar.x;
      avatar.lastY = avatar.y;
    }
    this.updateSeatHint();
    this.connection?.sendMove(this.player.x, this.player.y, this.facing);
    this.mmMarker?.setPosition(this.player.x, this.player.y);
  }

  private stepWalking(time: number, delta: number, vx: number, vy: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = PLAYER_SPEED * walkingMultiplier(this.walkingMs);
    let steeredByAutoWalk = false;
    if (this.autoWalk) {
      const step = stepAutoWalk({
        state: this.autoWalk,
        position: this.player,
        keyboard: { vx, vy },
        deltaMs: delta,
        speed,
      });

      if (step.kind === 'walking') {
        this.autoWalk = step.state;
        // Keep the reducer's shortened arrival velocity: never renormalize it.
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
      const velocity = new Phaser.Math.Vector2(vx, vy).normalize().scale(speed);
      body.setVelocity(velocity.x, velocity.y);
      this.facing = facingFrom(vx, vy, this.facing);
    }

    const from = { x: this.player.x, y: this.player.y };
    const intended = body.velocity.lengthSq() > 0;
    if (intended && !body.checkCollision.none) {
      body.updateFromGameObject();
      const dx = body.velocity.x * delta / 1000;
      const dy = body.velocity.y * delta / 1000;
      // Reuse Arcade's spatial index: no second collision map or pathfinding.
      const candidates = this.physics.overlapRect(
        body.x + Math.min(0, dx), body.y + Math.min(0, dy),
        body.width + Math.abs(dx), body.height + Math.abs(dy), false, true,
      );
      let fraction = 1;
      for (const obstacle of candidates) {
        if (!obstacle.enable || obstacle.checkCollision.none) continue;
        fraction = Math.min(fraction, walkingSweepFraction(body, dx, dy, obstacle));
      }
      body.velocity.scale(fraction);
    }
    this.physics.world.update(time, delta);
    this.physics.world.postUpdate();
    const moved = Math.hypot(this.player.x - from.x, this.player.y - from.y) > 0.000001;
    this.walkingMs = advanceWalkingTime(this.walkingMs, intended && moved && this.seat === null, delta);
    if (this.autoWalk && Math.hypot(this.autoWalk.goal.x - this.player.x, this.autoWalk.goal.y - this.player.y) <= ARRIVE_EPSILON_PX) {
      this.autoWalk = undefined;
      this.walkingMs = 0;
      body.setVelocity(0, 0);
    }
  }
}

function encodePreview(preview: TerrainEditCommand['preview']): string {
  return preview === null ? '' : `${preview.index}:${preview.material}`;
}
