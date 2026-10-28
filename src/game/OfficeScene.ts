import Phaser from 'phaser';
import { WALL, doorDepthY, doorFrameIndex, doorHingeOf, doorPlacement, doorSlices, propPlacement, tableFrameIndex, type ArtFacing, type ArtPiece, type GridEdge, type Point } from './artContract';
import { artUploadsManifestUrl, findPiece, type ArtAppearance } from './artPack';
import { artCustomCharactersUrl } from './customCharacterArt';
import { ArtPackLoader } from './artPackLoader';
import { deskPlacement } from './artPlacement';
import { feetOf, positionForFeet } from './avatarGeometry';
import { beginAutoWalk, isAutoWalkArrived, stepAutoWalk, type AutoWalkState } from './autoWalk';
import { IDLE_AUTO_SIT, SIT_LOCK_MS, dropSitDwells, guardLeftSeat, sitLockActive, stepAutoSit, type AutoSitState } from './autoSit';
import { bodyTileOf, planWalk, positionForBodyTile, type WalkWorld } from './pathfinding';
import { registerClick, type ClickSample } from './doubleClick';
import { CameraPanLayer } from './CameraPanLayer';
import { CameraZoomLayer } from './CameraZoomLayer';
import { CAMERA_MARGIN_TILES, regionBounds, terrainRegion, type Rect } from './cameraBounds';
import { PAN_THRESHOLD_PX } from './cameraPan';
import { restoreZoom, type ZoomStore } from './mapZoom';
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
  SPACE_SHADE_DEPTH,
  worldAssetDepth,
} from './depthLayers';
import { deskAt, deskZoneName } from './deskLayout';
import { SPACE_SHADE_ALPHA, SPACE_SHADE_NAME, shadeAround, shadeKey } from './spaceFocus';
import { tableFacing, tableFloorRect } from './deskTable';
import { decorChairs, decorFootprint, encodeOfficeDecor, isDecorChairPiece, withDecor, type DecorEdit, type DecorItem, type DecorTileRect } from './officeDecor';
import { doorEdge, doorLeaves, doorOpenings, doorSpan, doorStepOf, doorSwingRotation, keptSwings, moveDoors, openDoorLeaves, type DoorLeaf, type DoorMotion } from './officeDoors';
import { deskEntryRefused, isOnDesk } from './deskDecorRules';
import { lockedSpaceEntered } from './spaceLocks';
import type { OfficeDesk } from './desksPort';
import { MINIMAP_HEIGHT, MINIMAP_MARGIN, MINIMAP_WIDTH, RAIL_RIGHT } from './hudLayout';
import { MinimapLayer } from './MinimapLayer';
import { collisionEditHoldsMap, decorEditHidesRail, decorEditHoldsMap, layoutEditHoldsMap, terrainEditHoldsMap } from './editorMapHold';
import { DecorEditLayer } from './DecorEditLayer';
import { isEditableElementFocused } from './inputFocusGuard';
import { LayoutEditLayer } from './LayoutEditLayer';
import { LAYOUT_OUTLINE_NAME } from './spaceOutline';
import {
  BASE_MAP_CHAIR,
  placeChairs,
  placeLayout,
  placeSeats,
  placeWalls,
  placeZoneLabels,
  putArtSprite,
  renderTerrain,
  type TerrainTilemap,
} from './mapBuilder';
import { VOID_COLOR } from './terrainRender';
import {
  BUILT_IN_SPACES,
  BUILT_IN_SPACES_VERSION,
  PROX_RADIUS,
  TILE,
  type SpaceArea,
} from './mapData';
import type { OfficeBridge } from './officeBridge';
import {
  BASE_LAYOUT,
  BASE_TERRAIN,
  BLOCK_TILES,
  WALL_PIECES,
  encodeTerrainBlocks,
  encodeTerrainColors,
  encodeTerrainWalls,
  terrainSnapshot,
  withWallOrder,
  withWalls,
  type LayoutMaterial,
  type TerrainColors,
  type TerrainSnapshot,
  type OfficeLayout,
  type WallEdit,
} from './officeLayout';
import { BASE_COLLISION_RECTS, STATIC_COLLISION_INSTANCES, decorInfoFromManifest, officeCollisionInstances } from './officeCollisions';
import {
  collisionWorld,
  encodeCollisionTable,
  type CollisionInstance,
  type CollisionRect,
  type CollisionTable,
} from './pieceCollisions';
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
import { createRemoteAvatarRegistry, type RemoteAvatarRegistry, type RemotePlayerSnapshot } from './remoteAvatars';
import { createPhaserAvatarSink, type RemoteAvatarContainer } from './remoteAvatarSink';
import { detectSpace, nearbyKey } from './proximity';
import { createRosterTracker, type RosterPeer, type RosterTracker } from './roster';
import { createStaleSpacesVersionTracker } from './spacesConfig';
import { audiblePeersWithVersionGrace, type AudioPeer } from './proximityAudio';
import {
  BASE_MAP_SEATS,
  CHAIR_PIECES,
  SEAT_REACH_TILES,
  chairGround,
  chairSeatId,
  chairSeatTiles,
  inSeatReach,
  isChairPieceId,
  mapSeatId,
  mapSeatTiles,
  parseSeatRef,
  type SeatTiles,
  type MapSeat,
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
// Below both the 14px body height and Arcade's 4px overlap bias, even at the top speed.
const WALK_STEP_PX = 3;
const PROXIMITY_TICK_MS = 250;
/** Suavizado de `startFollow` (#53): compartido entre `setupCameras` y el `resumeFollow` de `CameraPanLayer`. */
const FOLLOW_LERP = 0.12;
/** A piece that cannot be drawn yet (or ever) still shows where it goes. */
/** Name of what the decor layer draws for the non-chair item anchored on `index` (chairs are `CHAIR_OBJECT_NAME`). */
export function decorObjectName(index: number): string {
  return `decor:${index}`;
}
const ART_FALLBACK_COLOR = 0x6b7280;
const ART_FALLBACK_ALPHA = 0.6;
/** A door's placeholder plank across its edge (#223), until its sheet loads. */
const DOOR_PLACEHOLDER_THICKNESS = 6;

/**
 * Como se conecta la escena al servidor. `connect` se inyecta para poder
 * probar el cableado sin levantar un Colyseus real: el protocolo por cable ya
 * lo cubren los tests de la capa node contra un servidor de verdad.
 */
export interface OfficeSceneOptions {
  /** Injectable static layout and seats for isolated rendering/physics tests. */
  layout?: OfficeLayout;
  seats?: readonly MapSeat[];
  fallbackSpaces?: { spaces: readonly SpaceArea[]; version: string };
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
  /**
   * Folder of the characters built with the creator, drawn by the office
   * server. Defaults to `artCustomCharactersUrl(endpoint)`; `null` leaves
   * them on the procedural body.
   */
  artCustomCharactersUrl?: string | null;
  /**
   * Where the chosen map zoom is remembered (map-zoom). Absent means nothing
   * is restored or saved and the office starts at the default stop;
   * `createGame` supplies the browser's.
   */
  zoomStore?: ZoomStore;
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
  private readonly layout: OfficeLayout;
  private readonly mapSeats: readonly MapSeat[];
  private readonly bridge: OfficeBridge;
  private grid!: TerrainGrid;
  /** The terrain layers, redrawn in place when the terrain changes (#123 phase 2). */
  private terrainTilemap?: TerrainTilemap;
  /** The blocks the room replicated last (#123 phase 2); colliders and `grid` follow them. */
  private terrainBlocks: readonly LayoutMaterial[] = BASE_LAYOUT.blocks;
  /** The terrain editor's pending paints, drawn instead of `terrainBlocks` and never collided with. */
  private terrainPreviewBlocks: readonly LayoutMaterial[] | null = null;
  /** The color of each colored block the room sends (#222); none until it sends some. */
  private terrainColors: TerrainColors = new Map();
  /** The colors that go with the editor's pending blocks; `null` draws them with the live ones. */
  private terrainPreviewColors: TerrainColors | null = null;
  /** The walls the room replicated last, one per tile; colliders and `grid` follow them. */
  private terrainWalls: readonly (string | null)[] = BASE_LAYOUT.walls;
  /** The tiles of `terrainWalls` in placement order, oldest first (#223): which wall is drawn over which. */
  private terrainWallOrder: readonly number[] = [];
  /** The terrain editor's pending wall paints, drawn over `terrainWalls` and never collided with. */
  private wallPreview: readonly WallEdit[] | null = null;
  /** What the walls drew, destroyed and drawn again whenever the walls or their preview change. */
  private wallObjects: Phaser.GameObjects.GameObject[] = [];
  /** The office decor layer (#208) as the room replicated it last; its chairs are seats anyone may take. */
  private officeDecor: readonly DecorItem[] = [];
  /** The decor editor's pending edits, drawn over the layer and never sat on or collided with. */
  private decorPreview: readonly DecorEdit[] | null = null;
  /**
   * The catalog the decor collisions were placed with: a manifest read later
   * (an upload approved after the page loaded) can size a piece the first one
   * did not know, and then the instances are placed again.
   */
  private decorCollisionsManifest: ArtPackLoader['manifest'] = null;
  /** What the decor layer drew, destroyed and drawn again whenever it or its preview change. */
  private decorObjects: Phaser.GameObjects.GameObject[] = [];
  /**
   * The doors of the drawn decor layer (#223), by anchor: their leaf (edge,
   * span, hinge) and, once the sheet is in, the image `update()` switches
   * between its closed and open frame. A redraw of the layer rebuilds it.
   */
  private doorLeaves = new Map<number, DoorLeaf>();
  private doorImages = new Map<number, Phaser.GameObjects.Image>();
  /** How far open each door is and the side it swings to, by leaf anchor: the doors shut and still are not in it. */
  private doorMotion: ReadonlyMap<number, DoorMotion> = new Map();
  /** The static bodies of the terrain grid and their collider, replaced whole on each edit. */
  private terrainColliders?: { rects: Phaser.GameObjects.Rectangle[]; collider: Phaser.Physics.Arcade.Collider };
  /** The terrain of `terrainBlocks` and `terrainWalls`, kept to rebuild `grid` when the collisions change. */
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
  private decorEditLayer?: DecorEditLayer;
  private unsubscribeDecorEdit?: () => void;
  private player!: CharacterContainer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  /**
   * The seat the room confirmed for the local player, or `null` standing
   * (step 6). Only `onLocalSeat` sets it: a request alone never seats anyone.
   */
  private seat: ResolvedSeat | null = null;
  /** Seat asked for and not answered yet; moving forgets it. */
  private pendingSeat: string | null = null;
  /** The own desk chair a `walkToOwnDesk` walk asks for once it arrives; any other walk forgets it. */
  private seatAfterWalk: string | null = null;
  /** Push and idle sit dwells and re-sit guards (`autoSit.ts`), fed the keyboard and the auto-walk every frame. */
  private autoSit: AutoSitState = IDLE_AUTO_SIT;
  /**
   * Game time until which movement input is ignored after a push-to-sit
   * request (`SIT_LOCK_MS`), or `null`. Started on the request, so a refused
   * one never locks longer either. An idle sit sets none: no key is held.
   */
  private sitLockUntil: number | null = null;
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
  /**
   * When each peer was last strictly audible, for the spaces version grace
   * (#183). Per session: cleared whenever the connection or its peers reset.
   */
  private readonly lastAudibleAt = new Map<string, number>();
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
  private unsubscribeWalkToOwnDesk?: () => void;
  private unsubscribeLockRoom?: () => void;
  private unsubscribeUnlockRoom?: () => void;
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
   * `this.input`. `isSuspended` lee `this.mapHeld` en el momento del
   * `pointerdown` (mismo momento en que `closemenu` ya lo consulta): un
   * `layoutedit` que llega a mitad de un pan ya en curso no lo corta, igual
   * que hoy tampoco corta un auto-walk en curso.
   */
  private cameraPanLayer?: CameraPanLayer;
  /** Frames the minimap camera on the terrain region, like the pan layer does the main one. */
  private minimapLayer?: MinimapLayer;
  /** Map zoom (map-zoom); created before the pan layer, see `create()`. */
  private cameraZoomLayer?: CameraZoomLayer;
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
   * necesita saber de el para suspender el banner de `updateDeskHover`. Todo lo
   * demas -- que dibujar, que es pickable, donde va el ghost -- lo sigue
   * `layoutEditLayer` por su cuenta desde el mismo comando `layoutedit`.
   */
  private layoutEditing = false;
  /**
   * Which editor is open (#123 phase 2): either one suspends desk clicks and
   * menus through `layoutEditing`, which is their OR.
   */
  private layoutCommandActive = false;
  private terrainEditing = false;
  private collisionEditing = false;
  private decorEditing = false;
  /**
   * Whether an open editor holds the map (`editorMapHold.ts`): something is
   * picked that the next click acts on. Only then do walking, sitting, the
   * view drag and the minimap stop; an editor with nothing picked leaves the
   * admin free to move around.
   */
  private mapHeld = false;
  private layoutHolds = false;
  private terrainHolds = false;
  private collisionHolds = false;
  private decorHolds = false;
  /** A decor piece picked: the minimap steps aside like the rail; a mere selection keeps both. */
  private decorHidesRail = false;
  /**
   * Todo lo dibujado del ultimo comando `desks` (#7, slice 5): zonas y
   * etiquetas. Se guarda entero porque cada lista nueva sustituye
   * a la anterior y hay que poder retirar la vieja de una vez -- dibujar
   * encima dejaria pintado como ocupado un sitio que alguien acaba de soltar.
   */
  private deskObjects: Phaser.GameObjects.GameObject[] = [];
  /** The last `desks` list, for the hover banner's hit test (`updateDeskHover`). */
  private desks: readonly OfficeDesk[] = [];
  /** Whether the pointer moved over the canvas since it last left it (`updateDeskHover`). */
  private pointerOnMap = false;
  /** What the last `deskhover` said, so it is only sent again when it changes. */
  private deskHoverKey: string | null = null;
  /** The shade outside the player's space and what it was drawn for (`updateSpaceShade`). */
  private spaceShade: Phaser.GameObjects.Rectangle[] = [];
  private spaceShadeKey: string | null = null;
  /**
   * Every desk area in tiles, from the last `desks` command: a desk holding
   * `MAX_DESK_OCCUPANCY` other people takes the local player in no more
   * (`deskDecorRules.ts`), the same rule the room drops the move with.
   */
  private deskAreas: DecorTileRect[] = [];
  /** A walk into a full desk was already told (`deskfull`) for this push: once per attempt. */
  private deskFullTold = false;
  /** The locked space ids the room replicates, each with who locked it (`spaceLocks.ts`). */
  private lockedSpaces: ReadonlyMap<string, string> = new Map();
  /** Same as `deskFullTold`, for a walk into a locked space (`spacelocked`). */
  private spaceLockedTold = false;
  /** The last `roomlock` told: whether the own space is locked, and by the local player. */
  private roomLock = { locked: false, mine: false };
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
  private readonly redrawDecor = (): void => this.paintDecor();
  /**
   * Objetivo de auto-caminata en curso (issue #2, D9/D10). `undefined` cuando
   * nadie esta siendo perseguido: `update()` solo dirige al reductor mientras
   * este campo tiene valor.
   */
  private autoWalk?: AutoWalkState;
  private walkingMs = 0;
  private walkingIdleMs = 0;
  private lastWalkFrame?: number;
  private walkClick?: Phaser.Input.Pointer;
  /**
   * First click of a possible double click (screen coordinates, game clock).
   * A walk starts only when a second eligible click completes the pair; anything
   * that interrupts walking also drops it, so a stale click never pairs later.
   */
  private clickPair: ClickSample | null = null;

  /** Recomputes both editing flags; the map becoming held stops any walk at once. */
  private syncEditing(): void {
    this.layoutEditing = this.layoutCommandActive || this.terrainEditing || this.collisionEditing || this.decorEditing;
    this.mapHeld = this.layoutHolds || this.terrainHolds || this.collisionHolds || this.decorHolds;
    // A hidden camera takes no pointer, so the map under the minimap can be edited too.
    this.minimapCamera?.setVisible(!this.terrainHolds && !this.decorHidesRail);
    if (this.mapHeld) this.resetWalking();
  }

  /**
   * The editors draw their space outlines on the command (#216), before this
   * runs: a few pixels wide, they are noise at minimap scale.
   */
  private ignoreOutlinesInMinimap(): void {
    if (this.minimapCamera === undefined) return;
    for (const child of this.children.list) if (child.name === LAYOUT_OUTLINE_NAME) this.minimapCamera.ignore(child);
  }

  private readonly resetWalking = (): void => {
    this.autoSit = dropSitDwells(this.autoSit);
    this.walkingMs = 0;
    this.walkingIdleMs = 0;
    this.lastWalkFrame = undefined;
    this.autoWalk = undefined;
    this.walkClick = undefined;
    this.clickPair = null;
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
  /** JOIN_ROOM precedes ROOM_STATE: no input/publication until the own position arrives (#148). */
  private localPositionReady = true;
  private joinGeneration = 0;
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
    if (!this.localAvatarKnown || !this.localPositionReady) return;
    if (this.pendingRedraws.size > 0) return;
    // A character that cannot load is drawn as the pack default
    // (`characterSheets`), so it never blocks the office: only the player
    // left without any sheets does.
    const statuses = [...this.entrancePieces]
      .map((id) => ({ id, status: this.art.status(id) }))
      .filter(({ id, status }) => status !== 'failed' || !id.startsWith('character-'))
      .map(({ status }) => status);
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
    this.spaces = options.fallbackSpaces?.spaces ?? BUILT_IN_SPACES;
    this.spacesVersion = options.fallbackSpaces?.version ?? BUILT_IN_SPACES_VERSION;
    this.layout = options.layout ?? BASE_LAYOUT;
    this.mapSeats = options.seats ?? BASE_MAP_SEATS;
    this.terrainBlocks = this.layout.blocks;
    this.terrainWalls = this.layout.walls;
    this.terrainWallOrder = [];
    this.terrain = this.terrainOf(this.terrainBlocks, this.terrainWalls);
    this.collisionInstances = officeCollisionInstances(this.layout, this.mapSeats);
    this.collisionRects = collisionWorld(this.collisionInstances, this.collisionTable);
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
      customCharactersUrl:
        this.options.artCustomCharactersUrl !== undefined ? this.options.artCustomCharactersUrl : artCustomCharactersUrl(this.options.endpoint),
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
    const grid: TerrainGrid = buildTerrainGrid(this.terrain, this.layout, this.collisionRects);
    this.grid = grid;
    this.terrainTilemap = renderTerrain(this, this.terrain, this.layout, this.art, this.terrainColors);
    this.paintWalls();
    placeLayout(this, this.layout, this.art);
    placeSeats(this, this.mapSeats, this.art);
    this.paintDecor();
    placeZoneLabels(this);

    // El nombre de la sesion manda sobre la pildora del avatar local (#6).
    // Sin sesion (desarrollo local, e2e) cae en `DEFAULT_NAME`, que es como
    // llama el servidor a quien entra sin identidad verificada.
    this.player = spawnPlayer(this, this.options.playerName ?? DEFAULT_NAME, this.characterSheets(null));
    // Only art the initial office actually draws; an unused broken upload cannot block entry.
    // Every wall and chair piece, not only the layout's: a wall painted or a chair placed live draws at once.
    for (const id of ['tileset-terrain', ...(this.mapSeats.length > 0 ? [BASE_MAP_CHAIR] : []), ...WALL_PIECES, ...CHAIR_PIECES, ...this.layout.walls, ...this.layout.hedges,
      ...this.layout.props.map((prop) => prop.piece)]) {
      if (id !== null) this.entrancePieces.add(id);
    }
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.checkEntry);
    const stopEntry = (): void => {
      this.alive = false;
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.checkEntry);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stopEntry);
    this.events.once(Phaser.Scenes.Events.DESTROY, stopEntry);

    // Arcade's discrete collision checks cannot safely take a whole top-speed frame.
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
    this.setupCameras(restoreZoom(this.options.zoomStore));
    // Decals are a few pixels each: at minimap scale they are noise, and a
    // layer less to draw on every frame.
    if (this.terrainTilemap.decals !== null) this.minimapCamera?.ignore(this.terrainTilemap.decals);
    this.setupInput();
    // map-zoom: BEFORE the pan layer. Their UPDATE listeners run in creation
    // order, and the pan layer's bounds of a frame must see that frame's zoom.
    this.cameraZoomLayer = new CameraZoomLayer({
      scene: this,
      camera: this.cameras.main,
      minimap: this.minimapCamera,
      bridge: this.bridge,
      store: this.options.zoomStore,
      // #207: a picked chair, desk table or room table turns with the wheel instead (`DecorEditLayer`).
      wheelSuppressed: () => this.decorEditLayer?.holdsWheel() ?? false,
    });
    // #53: despues de `setupInput` (comparte `this.input`, mismo momento en
    // que `layoutEditLayer` se crea mas abajo).
    this.cameraPanLayer = new CameraPanLayer({
      scene: this,
      camera: this.cameras.main,
      target: this.player,
      lerp: FOLLOW_LERP,
      region: this.cameraRegion(),
      isSuspended: () => this.mapHeld || !this.localPositionReady,
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
    this.unsubscribeWalkToOwnDesk = this.bridge.onCommand('walkToOwnDesk', () => this.walkToOwnDesk());
    this.unsubscribeLockRoom = this.bridge.onCommand('lockRoom', () => this.connection?.sendLock());
    this.unsubscribeUnlockRoom = this.bridge.onCommand('unlockRoom', () => this.connection?.sendUnlock());

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
      this.layoutHolds = layoutEditHoldsMap(command);
      this.syncEditing();
      this.ignoreOutlinesInMinimap();
    });

    // #123 phase 2. The layer outlines and picks blocks; the scene paints the
    // preview, and hands the editor the live blocks when it opens.
    this.terrainEditLayer = new TerrainEditLayer(this, this.bridge, this.layout);
    this.unsubscribeTerrainEdit = this.bridge.onCommand('terrainedit', (command) => {
      const opening = command !== null && !this.terrainEditing;
      this.terrainEditing = command !== null;
      this.terrainHolds = terrainEditHoldsMap(command);
      // The DOM rail hides with it (`OfficeShell`), and `syncEditing` hides the minimap.
      this.syncEditing();
      this.ignoreOutlinesInMinimap();
      const previewBlocks = command?.previewBlocks ?? null;
      const previewColors = previewBlocks === null ? null : (command?.previewColors ?? null);
      const encodePreview = (blocks: readonly LayoutMaterial[] | null, colors: TerrainColors | null): string =>
        `${blocks === null ? '' : encodeTerrainBlocks(blocks)}|${colors === null ? '' : encodeTerrainColors(colors)}`;
      const repaint = encodePreview(previewBlocks, previewColors) !== encodePreview(this.terrainPreviewBlocks, this.terrainPreviewColors);
      this.terrainPreviewBlocks = previewBlocks;
      this.terrainPreviewColors = previewColors;
      if (repaint) this.paintTerrain();
      const wallPreview = command?.previewWalls ?? null;
      const rewall = JSON.stringify(wallPreview) !== JSON.stringify(this.wallPreview);
      this.wallPreview = wallPreview;
      if (rewall) this.paintWalls();
      if (opening) this.emitTerrain();
    });

    // #208. The layer draws the ghost and picks tiles; the scene paints the
    // pending edits, and hands the editor the live layer when it opens.
    this.decorEditLayer = new DecorEditLayer(this, this.bridge, {
      width: this.layout.width,
      height: this.layout.height,
      items: () => (this.decorPreview === null ? this.officeDecor : withDecor(this.officeDecor, this.decorPreview)),
      infoOf: (piece) => decorInfoFromManifest(this.art.manifest)(piece),
      ground: () => this.terrain,
      drawPiece: (item) => this.drawDecorPiece(item),
    });
    this.unsubscribeDecorEdit = this.bridge.onCommand('decoredit', (command) => {
      const opening = command !== null && !this.decorEditing;
      this.decorEditing = command !== null;
      this.decorHolds = decorEditHoldsMap(command);
      this.decorHidesRail = decorEditHidesRail(command);
      this.syncEditing();
      this.ignoreOutlinesInMinimap();
      const preview = command?.preview ?? null;
      const repaint = JSON.stringify(preview) !== JSON.stringify(this.decorPreview);
      this.decorPreview = preview;
      if (repaint) this.paintDecor();
      if (opening) this.emitDecor();
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
      this.collisionHolds = collisionEditHoldsMap(command);
      this.syncEditing();
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
        if (!this.localPositionReady || isBlocked(this.grid, tx, ty)) return;
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
      // `game.destroy()` never emits SHUTDOWN; the bridge outlives the game.
      this.cameraZoomLayer?.destroy();
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
      this.unsubscribeWalkToOwnDesk?.();
      this.unsubscribeLockRoom?.();
      this.unsubscribeUnlockRoom?.();
      this.unsubscribeSpacesConfig?.();
      this.unsubscribeDesks?.();
      this.unsubscribeReconnect?.();
      this.unsubscribeLayoutEdit?.();
      this.layoutEditLayer?.destroy();
      this.unsubscribeTerrainEdit?.();
      this.terrainEditLayer?.destroy();
      this.unsubscribeCollisionEdit?.();
      this.collisionEditLayer?.destroy();
      this.unsubscribeDecorEdit?.();
      this.decorEditLayer?.destroy();
      this.cameraPanLayer?.destroy();
      this.minimapLayer?.destroy();
      this.cameraZoomLayer?.destroy();
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

    // A microtask, not now (#185): the bridge replays a stored `spacesconfig`
    // in a microtask queued by the subscription above, and microtasks run in
    // order, so the join reads the served version instead of the fallback one
    // peers would drop this newcomer for until the correction arrived.
    queueMicrotask(() => {
      if (!this.alive) return;
      void this.connectToOffice().finally(() => { this.connectionSettled = true; });
    });
  }

  /**
   * Conecta con el servidor de avatares reales (PRD 6.2). Un fallo NO es
   * fatal: la oficina se queda en solitario, sin nadie mas, y se avisa
   * por el puente. Cualquier otra cosa dejaria la pantalla en negro cada vez
   * que el servidor no este levantado, que en desarrollo es la mitad del rato.
   */
  private async connectToOffice(): Promise<void> {
    const generation = ++this.joinGeneration;
    const current = () => this.alive && generation === this.joinGeneration;
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
    const joinedSpacesVersion = this.spacesVersion;
    this.lastAudibleAt.clear();
    this.localPositionReady = false;
    this.resetWalking();

    try {
      const connection = await connect({
        endpoint,
        name: playerName,
        status: joinedStatus,
        // Viaja en el join (#7, D4), no en un mensaje posterior: sin esto este
        // par quedaria "brevemente sin version" para todo el mundo hasta el
        // primer tic de proximidad.
        spacesVersion: joinedSpacesVersion,
        getIdToken,
        handlers: {
          onAdd: (snapshot) => {
            if (!current()) return;
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
            if (!current()) return;
            const previous = this.remotes?.get(snapshot.sessionId)?.avatarId;
            if (previous !== undefined && previous !== snapshot.avatarId) this.requestCharacter(snapshot.avatarId);
            this.remotes?.upsert(snapshot);
            this.roster?.upsert(rosterPeerOf(snapshot));
            this.checkSpacesVersionDrift(snapshot.spacesVersion);
          },
          onRemove: (sessionId) => {
            if (!current()) return;
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
          onSpacesChanged: () => this.bridge.emit('spaceschanged', undefined),
          onTerrain: (blocks) => this.applyTerrain(blocks),
          onTerrainColors: (colors) => this.applyTerrainColors(colors),
          onWalls: (walls, order) => this.applyWalls(walls, order),
          onDecor: (items) => this.applyDecor(items),
          onLockedSpaces: (locks) => {
            this.lockedSpaces = locks;
            this.syncRoomLock();
          },
          onCollisions: (table) => this.applyCollisions(table),
          onConnectionState: (state) => {
            if (!current()) return;
            if (state !== 'connected') {
              this.localPositionReady = state === 'offline';
              this.resetWalking();
            }
            this.emitPresence(state);
          },
          onLocalPosition: (snapshot) => {
            if (!current()) return;
            this.adoptLocalPosition(snapshot);
            // Voice from the restored position at once, not on the next tick (#185).
            this.proximityTick();
          },
          onPositionReset: (snapshot) => {
            if (!current()) return;
            this.localPositionReady = false;
            for (const key of [...Object.values(this.cursors), ...Object.values(this.wasd)]) key.reset();
            this.adoptLocalPosition(snapshot);
            this.proximityTick();
          },
          onLocalAvatar: (avatarId) => { if (current()) this.adoptLocalAvatar(avatarId); },
          onLocalSeat: (seat) => { if (current()) this.onLocalSeat(seat); },
          onResync: () => { if (current()) this.resyncAfterReconnect(); },
        },
      });

      // La escena pudo apagarse mientras el `await` estaba en vuelo. Sin esta
      // guarda quedaria una conexion viva publicando la posicion de un jugador
      // ya destruido.
      if (!current()) {
        void connection.leave();
        return;
      }

      this.connection = connection;
      // Persisted rooms may differ from the empty fallback and arrive during
      // the handshake. Reconcile before peers compare versions for audibility.
      if (this.spacesVersion !== joinedSpacesVersion) connection.sendSpacesVersion(this.spacesVersion);
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
      // Recomputed, never `currentSpaceId` (#185): that one comes from the
      // last tick, at the spawn, and the restored position may be elsewhere.
      this.proximityTick();
    } catch (error) {
      if (!current()) return;
      this.localPositionReady = !(error instanceof OfficeAccessDeniedError);
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

  private adoptLocalPosition(snapshot: RemotePlayerSnapshot): void {
    if (this.localPositionReady) return;
    this.resetWalking();
    this.pendingSeat = null;
    this.autoSit = IDLE_AUTO_SIT;
    this.sitLockUntil = null;
    this.leaveSeat();
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.reset(snapshot.x, snapshot.y);
    // Body.reset() on a Container does not apply the Arcade offset.
    body.updateFromGameObject();
    body.prev.copy(body.position);
    body.prevFrame.copy(body.position);
    this.facing = facingFromSnapshot(snapshot.facing);
    setCharacterFacing(this.player, this.facing);
    this.seat = snapshot.seat === null ? null : this.resolveSeat(snapshot.seat);
    this.player.seatFacing = this.seat?.facing ?? null;
    body.checkCollision.none = this.seat !== null;
    animateCharacter(this.player, { dx: 0, dy: 0, dtMs: 0 });
    this.cameraPanLayer?.resetFollow();
    this.mmMarker?.setPosition(snapshot.x, snapshot.y);
    this.minimapLayer?.show(snapshot);
    this.localPositionReady = true;
  }

  /**
   * The own character, as the room replicates it or the pack default alone.
   * Redrawn at once: a character whose sheets are still loading shows the
   * pack default until they land, never the previous character.
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
   * The pack default loads with it: it stands in until they land, and for
   * good if they fail. `null` (no character replicated) is the pack default.
   */
  private requestCharacter(avatarId: string | null): void {
    const fallback = this.art.manifest?.defaults.character;
    if (!this.alive) return;
    for (const id of new Set([avatarId ?? fallback, fallback])) {
      if (id === undefined) continue;
      if (this.requestArt(id, () => this.scheduleRedraw(this.redrawCharacters)) === 'ready') this.redrawCharacters();
    }
  }

  /**
   * Sheets to draw a character with (`null` is the pack default): its own,
   * else the pack default's while they load or after they fail, so an avatar
   * keeps the current art and never shows the procedural body or a previous
   * character. `null` (procedural) only while not even the default is loaded.
   */
  private characterSheets(avatarId: string | null): CharacterSheets | null {
    const fallback = this.art.manifest?.defaults.character;
    return this.loadedSheets(avatarId ?? fallback) ?? this.loadedSheets(fallback);
  }

  private loadedSheets(id: string | undefined): CharacterSheets | null {
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
   * A seat by reference (step 6): a base map chair, a chair placed from the
   * terrain editor the room replicated, or a decor chair of a desk's
   * occupant in the last `desks` list. `null` when this client cannot place
   * it.
   */
  private resolveSeat(id: string): ResolvedSeat | null {
    const ref = parseSeatRef(id, this.mapSeats.length);
    if (ref === null) return null;
    if (ref.kind === 'map') {
      const seat = this.mapSeats[ref.index];
      return { id, ground: { x: (seat.tx + 0.5) * TILE, y: (seat.ty + 0.5) * TILE }, facing: seat.facing, reach: mapSeatTiles(seat) };
    }
    // A chair of the decor layer (#208); a desk has no seat of its own.
    const chair = decorChairs(this.officeDecor).find((candidate) => candidate.index === ref.index);
    if (chair === undefined) return null;
    const width = this.layout.width;
    return { id, ground: chairGround(width, chair.index), facing: chair.facing, reach: chairSeatTiles(width, chair.index) };
  }

  /**
   * The free seat in reach closest to the feet, if any. A seat is free when
   * no peer sits on it: the same rule the room applies, so the scene does not
   * offer what the room would refuse.
   */
  private seatInReach(): ResolvedSeat | null {
    const feet = feetOf(this.player);
    let best: ResolvedSeat | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const seat of this.freeSeats()) {
      if (!inSeatReach(this.player, seat.reach)) continue;
      const distance = Math.hypot(seat.ground.x - feet.x, seat.ground.y - feet.y);
      if (distance < bestDistance) {
        best = seat;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Every seat no peer sits on: map chairs and every decor chair. */
  private freeSeats(): ResolvedSeat[] {
    const taken = new Set<string>();
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const seat = this.remotes?.get(sessionId)?.seat;
      if (seat) taken.add(seat);
    }
    const candidates: ResolvedSeat[] = [];
    this.mapSeats.forEach((_, index) => {
      const seat = this.resolveSeat(mapSeatId(index));
      if (seat) candidates.push(seat);
    });
    for (const chair of decorChairs(this.officeDecor)) {
      const seat = this.resolveSeat(chairSeatId(chair.index));
      if (seat) candidates.push(seat);
    }
    // A seat whose sitter would stand inside a full desk is refused by the room too.
    const here = { x: this.player.x, y: this.player.y };
    // So is one in a locked space the player is not in.
    return candidates.filter((seat) => {
      const sitter = positionForFeet(seat.ground);
      return !taken.has(seat.id) && this.fullDeskOnTheWay(here, sitter) === null
        && lockedSpaceEntered(here, sitter, this.spaces, this.lockedSpaces) === null;
    });
  }

  /** Tells `roomlock` when the own space became locked or stopped being so, or changed hands. */
  private syncRoomLock(): void {
    const locker = this.currentSpaceId === null ? undefined : this.lockedSpaces.get(this.currentSpaceId);
    const locked = locker !== undefined;
    const mine = locked && locker === this.connection?.sessionId;
    if (locked === this.roomLock.locked && mine === this.roomLock.mine) return;
    this.roomLock = { locked, mine };
    this.bridge.emit('roomlock', { locked, mine });
  }

  /** The `toggleSeat` command: stand when seated, else ask for the seat in reach. */
  private toggleSeat(): void {
    if (!this.localPositionReady) return;
    if (this.seat !== null || this.pendingSeat !== null) {
      this.standUp();
      return;
    }
    const seat = this.seatInReach();
    if (seat !== null) this.requestSeat(seat);
  }

  /**
   * One frame of sitting while standing (`autoSit.ts`): walking into a free
   * chair from next to it, or standing still next to one (a double-click
   * walk that ended there included), stops the walk and asks for the chair.
   * Only a push locks movement for `SIT_LOCK_MS`: its key is still held. An
   * idle sit has no key held, so the first movement afterwards stands up.
   * Returns whether it asked, so the frame's movement is dropped.
   */
  private pushToSit(time: number, vx: number, vy: number): boolean {
    if (this.seat !== null || this.pendingSeat !== null || !this.localPositionReady || this.mapHeld) {
      this.autoSit = dropSitDwells(this.autoSit);
      return false;
    }
    const step = stepAutoSit(this.autoSit, {
      nowMs: time,
      feet: feetOf(this.player),
      input: { vx, vy },
      // `update()` runs this before `stepWalking`, so a walk that arrived
      // last frame is already `undefined` here: the player is still.
      walking: this.autoWalk !== undefined,
      candidates: this.freeSeats().map((seat) => ({ ...seat, inReach: inSeatReach(this.player, seat.reach) })),
    });
    this.autoSit = step.state;
    if (step.sit === null) return false;
    this.resetWalking();
    if (step.via === 'push') this.sitLockUntil = time + SIT_LOCK_MS;
    this.requestSeat(step.sit);
    return true;
  }

  private requestSeat(seat: ResolvedSeat): void {
    this.pendingSeat = seat.id;
    // Offline nobody else can see or contest the seat, so it is taken here.
    if (!this.connection) {
      this.onLocalSeat(seat.id);
      return;
    }
    this.connection.sendSit(seat.id);
    // The room refuses without a word; after a while the request is
    // forgotten, so the next request asks again instead of standing up. The
    // seat is guarded like one just left: standing still beside it, the idle
    // rule would otherwise ask every frame for a seat the room refuses.
    this.time.delayedCall(SEAT_ANSWER_MS, () => {
      if (this.pendingSeat !== seat.id) return;
      this.pendingSeat = null;
      this.autoSit = guardLeftSeat(seat.id, this.time.now);
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
      // The room stood a seated player up (desk changed hands, chair gone,
      // out of reach): never sit straight back down by standing still there.
      this.autoSit = this.seat === null ? dropSitDwells(this.autoSit) : guardLeftSeat(this.seat.id, this.time.now);
      this.sitLockUntil = null;
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

  /**
   * Stands the local player up and tells the room (`toggleSeat` again,
   * walking, a teleport). The seat left is guarded, so the key that stood the
   * player up does not sit them on it again at once.
   */
  private standUp(): void {
    if (this.seat === null && this.pendingSeat === null) return;
    const left = this.seat?.id ?? this.pendingSeat;
    if (left !== null) this.autoSit = guardLeftSeat(left, this.time.now);
    this.sitLockUntil = null;
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
    this.localPositionReady = false;
    this.resetWalking();
    this.remotes?.clear();
    this.roster?.clear();
    this.lastAudibleAt.clear();
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
   * Aplica el conjunto de habla real reportado por React (D7) al anillo de
   * cada avatar remoto y al del jugador local (#181: LiveKit reporta tambien
   * la identidad local, que es el sessionId de Colyseus). El comando trae el
   * conjunto AUTORITATIVO completo (no un delta), asi que cada sessionId
   * conocido se apaga salvo que este en el arreglo.
   */
  private applySpeakers(sessionIds: readonly string[]): void {
    const speaking = new Set(sessionIds);
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      this.remotes?.get(sessionId)?.ring.setVisible(speaking.has(sessionId));
    }
    const selfId = this.connection?.sessionId;
    this.player.ring.setVisible(selfId !== undefined && speaking.has(selfId));
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
    // Spaces draw no floor of their own: the painted terrain shows (#182).

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
    // A desk places no collision of its own (#208): what stands on it is decor.
    for (const object of this.deskObjects.splice(0)) object.destroy();
    for (const desk of desks) this.drawDesk(desk);
    this.desks = desks;
    this.deskAreas = desks.map((desk) => ({ x: Math.round(desk.x / TILE), y: Math.round(desk.y / TILE), w: Math.round(desk.w / TILE), h: Math.round(desk.h / TILE) }));
  }

  /**
   * The desk a local move from `from` to `to` would walk into while it holds
   * `MAX_DESK_OCCUPANCY` peers, or `null`. Peers count where they are drawn,
   * every replicated one: the room counts the same players.
   */
  private fullDeskOnTheWay(from: { x: number; y: number }, to: { x: number; y: number }): DecorTileRect | null {
    if (this.deskAreas.length === 0) return null;
    const peers: { x: number; y: number }[] = [];
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (avatar) peers.push({ x: avatar.x, y: avatar.y });
    }
    return deskEntryRefused(from, to, this.deskAreas, peers, TILE);
  }

  /**
   * Loaded sheet of an appearance, or `null`. When the piece is not loaded yet
   * it asks the loader for it and redraws once it settles; a piece of the
   * wrong kind (a chair id as a desk) never draws.
   */
  private artSheet(appearance: ArtAppearance, kind: ArtPiece['kind'], redraw: () => void): { key: string; piece: ArtPiece } | null {
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
   * Dibuja la zona de 3x3 de un escritorio y su etiqueta (si tiene). What
   * stands on it is the decor layer's (#208, `paintDecor`).
   *
   * The depth is the BOTTOM edge of the area in the world band, same
   * convention as `placeLayout` (`(y + h) * TILE`), so the desk y-sorts
   * against the furniture around it, and so does whoever walks over it
   * (#213, `depthLayers.ts`).
   */
  private drawDesk(desk: OfficeDesk): void {
    const bottom = desk.y + desk.h;
    const depth = worldAssetDepth(bottom);

    // A floor marker (step 6) with no tint: the shade outside the player's
    // space (`spaceFocus.ts`) shows where one is, and the hover banner whose
    // desk it is. Never interactive: the hover is `updateDeskHover`'s.
    const zone = this.add
      .rectangle(desk.x + desk.w / 2, desk.y + desk.h / 2, desk.w, desk.h)
      .setDepth(DESK_ZONE_DEPTH)
      .setName(deskZoneName(desk.id));
    this.deskObjects.push(zone);

    // A desk created empty has no label (Editar espacios); an older one keeps its own.
    if (desk.label !== '') {
      const label = this.add
        .text(desk.x + 3, desk.y + 2, desk.label, {
          fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
          fontSize: '11px',
          color: '#e5e7eb',
        })
        .setDepth(depth);
      this.deskObjects.push(label);
    }

  }

  /**
   * One non-chair item of the decor layer (#208). A desk table is drawn 1:1
   * with its anchor on the middle of its middle tile, in the column of its
   * facing, y-sorted by its own depth point like a Tiled desk; a plant or a
   * room table 1:1 on the bottom middle of its footprint, like a Tiled prop
   * (a vertical room table on its swapped footprint, in its second frame).
   * While its sheet is not loaded a placeholder covers its footprint (the
   * floor under its top for a desk table), and the sheet's arrival redraws
   * the decor.
   */
  private drawDecorItem(item: DecorItem): Phaser.GameObjects.GameObject[] {
    const width = this.layout.width;
    const kind = item.piece.slice(0, item.piece.indexOf('-'));
    const infoOf = decorInfoFromManifest(this.art.manifest);
    const rect = decorFootprint(item, infoOf(item.piece), width);
    if (kind === 'desk') {
      const anchor = { x: ((item.index % width) + 0.5) * TILE, y: (Math.floor(item.index / width) + 0.5) * TILE };
      // A painted desk table in its own color; without one, its manifest default (the exported sheet).
      const sheet = this.artSheet({ materialId: item.piece, color: item.color ?? null }, 'desk', this.redrawDecor);
      if (sheet === null || sheet.piece.kind !== 'desk') {
        const floor = tableFloorRect(item.rotation);
        return [
          this.add
            .rectangle(anchor.x, anchor.y, floor.w, floor.h, ART_FALLBACK_COLOR, ART_FALLBACK_ALPHA)
            .setDepth(worldAssetDepth(anchor.y + floor.y + floor.h))
            .setName(decorObjectName(item.index)),
        ];
      }
      const placement = deskPlacement(sheet.piece, tableFacing(item.rotation), anchor);
      return [putArtSprite(this, sheet.key, placement, worldAssetDepth(placement.depthY)).setName(decorObjectName(item.index))];
    }
    if (kind === 'door') return this.drawDoor(item);
    const propKind = kind === 'table' ? 'table' : 'plant';
    const sheet = this.artSheet({ materialId: item.piece, color: null }, propKind, this.redrawDecor);
    if (sheet === null || (sheet.piece.kind !== 'plant' && sheet.piece.kind !== 'table')) {
      return [
        this.add
          .rectangle((rect.x + rect.w / 2) * TILE, (rect.y + rect.h / 2) * TILE, rect.w * TILE, rect.h * TILE, ART_FALLBACK_COLOR, ART_FALLBACK_ALPHA)
          .setDepth(worldAssetDepth((rect.y + rect.h) * TILE))
          .setName(decorObjectName(item.index)),
      ];
    }
    // A room table standing vertical is its sheet's second frame, anchored on its swapped footprint.
    const placement = propPlacement({ anchor: sheet.piece.anchor, footprint: { w: rect.w, h: rect.h } }, rect.x, rect.y);
    const frame = sheet.piece.kind === 'table' ? tableFrameIndex(item.rotation) : 0;
    return [putArtSprite(this, sheet.key, { ...placement, frame }, worldAssetDepth(placement.depthY)).setName(decorObjectName(item.index))];
  }

  /**
   * A door of the decor layer (#223, #233): its leaf and jambs on the grid
   * line it opens (`doorEdge`). The leaf sorts by its lowest pixel; each jamb
   * is its own crop of the same frame, sorted under the post joint it merges
   * with (`doorSlices`), so the walls are always drawn over the door.
   */
  private drawDoor(item: DecorItem): Phaser.GameObjects.GameObject[] {
    const edge = doorEdge(item, this.layout.width);
    const span = doorSpan(item);
    const leaf = this.doorLeaves.get(item.index);
    const sheet = this.artSheet({ materialId: item.piece, color: null }, 'door', this.redrawDecor);
    if (sheet !== null) {
      const placement = doorPlacement(edge, span);
      const { frame, depthY } = this.doorLook(item, leaf?.rotation ?? item.rotation, edge);
      const slices = doorSlices(edge, item.piece);
      const name = decorObjectName(item.index);
      const crop = (image: Phaser.GameObjects.Image, { x, y, width, height }: { x: number; y: number; width: number; height: number }) => image.setCrop(x, y, width, height);
      // The jambs are the same in every frame of the swing, so they keep the one they were drawn with.
      return [
        crop(putArtSprite(this, sheet.key, { ...placement, frame }, worldAssetDepth(depthY)).setName(name), slices.leaf),
        ...slices.jambs.map(({ crop: rect, depthY: jambDepthY }) => crop(putArtSprite(this, sheet.key, { ...placement, frame }, worldAssetDepth(jambDepthY)).setName(`${name}:jamb`), rect)),
      ];
    }
    const horizontal = edge.axis === 'horizontal';
    const x = horizontal ? (edge.col + span / 2) * TILE : edge.col * TILE;
    const y = horizontal ? edge.row * TILE : (edge.row + span / 2) * TILE;
    return [
      this.add
        .rectangle(x, y, horizontal ? span * TILE : DOOR_PLACEHOLDER_THICKNESS, horizontal ? DOOR_PLACEHOLDER_THICKNESS : span * TILE, ART_FALLBACK_COLOR, ART_FALLBACK_ALPHA)
        // The bottom of the wall body it replaces: half a wall below the edge's middle either way.
        .setDepth(worldAssetDepth(y + WALL.thickness / 2))
        .setName(decorObjectName(item.index)),
    ];
  }

  /**
   * The frame a door shows and the depth it sorts by: its swing so far,
   * turned away from the avatar that opened it (S14), and the lowest pixel of
   * the leaf in that frame (`doorDepthY`), so an avatar below a swung leaf
   * walks in front of it.
   */
  private doorLook(item: Pick<DecorItem, 'index' | 'piece'>, rotation: DecorItem['rotation'], edge: GridEdge): { frame: number; depthY: number } {
    const motion = this.doorMotion.get(item.index);
    const step = motion === undefined ? 0 : doorStepOf(motion.progress);
    const turned = doorSwingRotation(rotation, motion?.swing ?? 'inside');
    // The hinge stays where the door was turned to, whichever side it swings to.
    const hinge = doorHingeOf(item.piece, rotation);
    return { frame: doorFrameIndex(turned, hinge, step), depthY: doorDepthY(edge, item.piece, turned, hinge, step) };
  }

  /**
   * Swings every door leaf an avatar (this player or a peer) is about to
   * cross, away from the avatar, and closes the rest (#223, `openDoorLeaves`,
   * `moveDoors`): drawing only, once per frame, switching the frame and the
   * depth of the images `paintDecor` kept. Doors never block.
   */
  private animateDoors(dtMs: number): void {
    if (this.doorImages.size === 0) return;
    const positions: Point[] = [{ x: this.player.x, y: this.player.y }];
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (avatar !== undefined) positions.push({ x: avatar.x, y: avatar.y });
    }
    // A door keeps the side it swings to until it is shut again (S14), also when it is closing.
    const targets = openDoorLeaves([...this.doorLeaves.values()], positions, keptSwings(this.doorMotion));
    this.doorMotion = moveDoors(targets, this.doorMotion, dtMs);
    for (const [index, image] of this.doorImages) {
      const leaf = this.doorLeaves.get(index);
      if (leaf === undefined) continue;
      const { frame, depthY } = this.doorLook(leaf, leaf.rotation, leaf.edge);
      if (image.frame.name !== String(frame)) image.setFrame(frame);
      const depth = worldAssetDepth(depthY);
      if (image.depth !== depth) image.setDepth(depth);
    }
  }

  /**
   * What the double-click path plans against (#227): what Arcade collides
   * the body with, the terrain tiles and the wall and piece rectangles (an
   * open door's edge is already out of the wall rectangles).
   */
  private walkWorld(): WalkWorld {
    return { terrainSolid: this.grid.terrainSolid, rects: [...this.grid.wallRects, ...this.collisionRects] };
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

  /**
   * The static bodies of `grid`, replacing the previous ones (#123 phase 2:
   * blocks change live): the merged terrain tiles, then the walls' own
   * rectangles, which stand on grid lines and never fill a tile.
   */
  private buildTerrainColliders(grid: TerrainGrid): void {
    if (this.terrainColliders) {
      this.physics.world.removeCollider(this.terrainColliders.collider);
      for (const rect of this.terrainColliders.rects) rect.destroy();
    }
    const tiles = mergeColliderRects(grid.terrainSolid).map((r) => ({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }));
    const rects = [...tiles, ...grid.wallRects].map((r) => {
      const rect = this.add.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
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
    this.grid = buildTerrainGrid(this.terrain, this.layout, this.collisionRects);
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
      this.terrain = this.terrainOf(blocks, this.terrainWalls);
      this.grid = buildTerrainGrid(this.terrain, this.layout, this.collisionRects);
      this.buildTerrainColliders(this.grid);
      this.paintTerrain();
      this.cameraPanLayer?.setRegion(this.cameraRegion());
      this.minimapLayer?.setRegion(this.cameraRegion());
    }
    this.emitTerrain();
  }

  /**
   * New block colors from the room (#222): a drawing change only, so the
   * tilemap repaints and nothing else follows. The room sends none while no
   * block has a color, which the empty map we start from already draws.
   */
  private applyTerrainColors(colors: TerrainColors): void {
    if (!this.alive) return;
    if (encodeTerrainColors(colors) !== encodeTerrainColors(this.terrainColors)) {
      this.terrainColors = colors;
      this.paintTerrain();
    }
    this.emitTerrain();
  }

  /**
   * Where the main camera may look (#179): the live blocks only, never the
   * editor's preview, so a draft paint does not open the void to the camera.
   * Columns come from the layout because injected layouts have other sizes.
   */
  private cameraRegion(): Rect {
    return terrainRegion(this.terrainBlocks, this.layout.width / BLOCK_TILES, BLOCK_TILES * TILE, CAMERA_MARGIN_TILES * TILE);
  }

  /**
   * New walls from the room: like new blocks, the grid, the tile colliders
   * and the drawing follow at once. Walls of another map size (a server on
   * another layout) are not this map's and are ignored.
   */
  private applyWalls(walls: readonly (string | null)[], order: readonly number[] = []): void {
    if (!this.alive || walls.length !== this.layout.width * this.layout.height) return;
    // The order is part of the walls: a repaint with the same posts still redraws which wall lies over which.
    if (encodeTerrainWalls(walls, order) !== encodeTerrainWalls(this.terrainWalls, this.terrainWallOrder)) {
      this.terrainWalls = walls;
      this.terrainWallOrder = order;
      this.terrain = this.terrainOf(this.terrainBlocks, walls);
      this.grid = buildTerrainGrid(this.terrain, this.layout, this.collisionRects);
      this.buildTerrainColliders(this.grid);
      this.paintWalls();
    }
    this.emitTerrain();
  }

  /**
   * New placed chairs from the room: drawn, offered as seats and collided
   * with (by their pieces' rectangles) at once. A chair the local player sits
   * on that is gone stands them up here too, without waiting for the room's
   * own answer; a turned one turns them.
   */
  private applyDecor(items: readonly DecorItem[]): void {
    if (!this.alive) return;
    if (encodeOfficeDecor(items) !== encodeOfficeDecor(this.officeDecor)) {
      const opened = JSON.stringify(doorOpenings(this.officeDecor, this.layout.width));
      this.officeDecor = items;
      // A door that came or went opens or closes its wall (#223): the room's snapshot changed with it.
      if (JSON.stringify(doorOpenings(items, this.layout.width)) !== opened) {
        this.terrain = this.terrainOf(this.terrainBlocks, this.terrainWalls);
        this.grid = buildTerrainGrid(this.terrain, this.layout, this.collisionRects);
        this.buildTerrainColliders(this.grid);
        this.paintWalls();
      }
      this.placeDecorCollisions();
      this.paintDecor();
      const ref = this.seat === null ? null : parseSeatRef(this.seat.id, this.mapSeats.length);
      if (this.seat !== null && ref?.kind === 'chair') {
        const seat = this.resolveSeat(this.seat.id);
        if (seat === null) {
          this.leaveSeat();
        } else if (seat.facing !== this.seat.facing) {
          this.seat = seat;
          this.facing = seat.facing;
          setCharacterFacing(this.player, seat.facing);
          this.player.seatFacing = seat.facing;
        }
      }
      if (this.pendingSeat !== null && parseSeatRef(this.pendingSeat, this.mapSeats.length)?.kind === 'chair' && this.resolveSeat(this.pendingSeat) === null) {
        this.pendingSeat = null;
      }
    }
    this.emitDecor();
  }

  /**
   * Places the collision instances of the static office and the decor layer
   * with the catalog as it is now, and rebuilds the colliders from them.
   */
  private placeDecorCollisions(): void {
    this.decorCollisionsManifest = this.art.manifest;
    this.collisionInstances = officeCollisionInstances(this.layout, this.mapSeats, this.officeDecor, decorInfoFromManifest(this.art.manifest));
    this.refreshCollisions();
  }

  /** Hands the terrain editor what the room shows: the live blocks, walls and block colors. */
  private emitTerrain(): void {
    this.bridge.emit('terrain', { blocks: this.terrainBlocks, walls: this.terrainWalls, colors: this.terrainColors });
    this.decorEditLayer?.refresh();
  }

  /** Hands the decor editors what the room shows: the live decor layer. */
  private emitDecor(): void {
    this.bridge.emit('decor', { items: this.officeDecor });
    this.decorEditLayer?.refresh();
  }

  /**
   * Redraws the decor layer (#208) from the live items, with the decor
   * editor's pending edits over them. Also the redraw a piece's sheet asks
   * for when it lands: a catalog read since the collisions were placed may
   * size an uploaded piece the first one did not know, so they are placed
   * again then.
   */
  private paintDecor(): void {
    if (this.art.manifest !== this.decorCollisionsManifest && this.officeDecor.length > 0) this.placeDecorCollisions();
    for (const object of this.decorObjects) object.destroy();
    const items = this.decorPreview === null ? this.officeDecor : withDecor(this.officeDecor, this.decorPreview);
    this.doorLeaves = new Map(doorLeaves(items, this.layout.width).map((leaf) => [leaf.index, leaf]));
    this.decorObjects = items.flatMap((item) => this.drawDecorPiece(item));
    const doorNamed = new Map([...this.doorLeaves.keys()].map((index) => [decorObjectName(index), index]));
    this.doorImages = new Map();
    for (const object of this.decorObjects) {
      const index = doorNamed.get(object.name);
      if (index !== undefined && object instanceof Phaser.GameObjects.Image) this.doorImages.set(index, object);
    }
  }

  /** One item of the decor layer: a chair in both layers like a base chair (`placeChairs`), anything else by `drawDecorItem`. */
  private drawDecorPiece(item: DecorItem): Phaser.GameObjects.GameObject[] {
    if (!isChairPieceId(item.piece)) return this.drawDecorItem(item);
    const [chair] = decorChairs([item]);
    return chair === undefined ? [] : placeChairs(this, [{ index: chair.index, piece: item.piece, facing: chair.facing }], this.layout.width, this.art);
  }

  /** Redraws the tilemap from the live blocks, or from the editor's pending paints while it has some. */
  private paintTerrain(): void {
    this.terrainTilemap?.refresh(
      terrainSnapshot(this.layout, this.terrainPreviewBlocks ?? this.terrainBlocks, this.terrainWalls),
      this.terrainPreviewColors ?? this.terrainColors,
    );
  }

  /**
   * The terrain the room enforces for these blocks and walls: the live
   * doors open their wall edges (#223), exactly like the room's snapshot.
   * The decor editor's pending edits never collide, so they open nothing.
   */
  private terrainOf(blocks: readonly LayoutMaterial[], walls: readonly (string | null)[]): TerrainSnapshot {
    return terrainSnapshot(this.layout, blocks, walls, doorOpenings(this.officeDecor, this.layout.width), this.terrainWallOrder);
  }

  /**
   * Redraws every wall from the live walls, with the editor's pending wall
   * paints over them; the body under a live door is left out (#223).
   */
  private paintWalls(): void {
    for (const object of this.wallObjects) object.destroy();
    const walls = this.wallPreview === null ? this.terrainWalls : withWalls(this.terrainWalls, this.wallPreview);
    // The pending paints are the latest posts, as they will be once saved.
    const wallOrder = this.wallPreview === null ? this.terrainWallOrder : withWallOrder(this.terrainWallOrder, this.terrainWalls, this.wallPreview);
    const openings = doorOpenings(this.officeDecor, this.layout.width);
    this.wallObjects = placeWalls(this, { width: this.layout.width, height: this.layout.height, walls, openings, wallOrder }, this.art);
  }

  /** Camara principal siguiendo al jugador + minimapa en la esquina superior derecha (app.js:410-431). */
  private setupCameras(initialZoom: number): void {
    const cam = this.cameras.main;
    // Zoom and zoom-aware bounds BEFORE `startFollow`, whose snap clamps with
    // them: no glide on load. `CameraPanLayer` owns the bounds from then on.
    cam.setZoom(initialZoom);
    const bounds = regionBounds(this.cameraRegion(), cam, initialZoom);
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    cam.startFollow(this.player, true, FOLLOW_LERP, FOLLOW_LERP);
    // The void (unbuilt map) draws nothing: the whole screen is black around and under the terrain.
    cam.setBackgroundColor(VOID_COLOR);

    const minimap = this.cameras.add(
      this.scale.width - (MINIMAP_WIDTH + RAIL_RIGHT),
      MINIMAP_MARGIN,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    minimap.setBackgroundColor(VOID_COLOR);
    this.minimapCamera = minimap;

    this.mmMarker = this.add.circle(0, 0, 42, 0xffffff, 0.45).setDepth(MINIMAP_MARKER_DEPTH);
    cam.ignore(this.mmMarker);
    this.minimapLayer = new MinimapLayer({
      scene: this,
      camera: minimap,
      region: this.cameraRegion(),
      center: { x: this.player.x, y: this.player.y },
      marker: this.mmMarker,
      // The pan layer is created later in `create()`; it exists by the first click.
      onFocus: (point) => this.cameraPanLayer?.focus(point),
      // Same guards as a double click on the map: no walking while editing or before the room placed us.
      onWalk: (point) => {
        if (!this.mapHeld && this.localPositionReady) this.startWalk(point);
      },
    });

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
        if (!this.localPositionReady) return;
        if (!currentlyOver || currentlyOver.length === 0) {
          if (!this.layoutEditing) this.bridge.emit('closemenu', undefined);
          // An open editor with nothing picked still walks: only a held map does not.
          if (!this.mapHeld && pointer.button === 0 && pointer.camera === this.cameras.main) this.walkClick = pointer;
        }
      },
    );
    // The hover banner reads the pointer only once it really is on the map:
    // until the first move Phaser places it at (0, 0) and calls it "over".
    this.input.on('gameout', () => { this.pointerOnMap = false; });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.pointerOnMap = true;
      // Once it was a drag, returning to its origin must not turn it into a click.
      if (pointer === this.walkClick && pointer.getDistance() > PAN_THRESHOLD_PX) this.walkClick = undefined;
    });
    this.input.on('pointerupoutside', () => {
      this.walkClick = undefined;
      this.clickPair = null;
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const eligible = pointer === this.walkClick && !this.mapHeld && this.localPositionReady && !over?.length &&
        pointer.camera === this.cameras.main && pointer.getDistance() <= PAN_THRESHOLD_PX &&
        Number.isFinite(pointer.worldX) && Number.isFinite(pointer.worldY) &&
        Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
      this.walkClick = undefined;
      // Any click that cannot walk also breaks a pending pair.
      if (!eligible) {
        this.clickPair = null;
        return;
      }
      // Screen coordinates and the game clock: world points glide with the camera between the clicks.
      const { fired, pending } = registerClick(this.clickPair, { time: this.time.now, x: pointer.x, y: pointer.y });
      this.clickPair = pending;
      if (fired) this.startWalk({ x: pointer.worldX, y: pointer.worldY });
    });
  }

  /** The same office data `checkEntry` waits for: the own position and, when asked, the served spaces. */
  private voiceReady(): boolean {
    return this.localPositionReady && (!this.options.waitForOfficeData || this.initialSpaces);
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
    // No voice for a live session until the room placed us (#185): the spawn
    // is not where the session restores, and a first LiveKit room picked from
    // it cost peers seconds of a wrong room. Teardown (no session) still goes.
    if (selfSessionId !== null && !this.voiceReady()) return;

    // An admin desk or space edit reaches each client a moment apart, and the
    // strict version predicate cut everyone's audio and video in between
    // (#183): peers who stay put keep hearing each other for a short grace.
    const audibleIds = audiblePeersWithVersionGrace({
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
      lastAudibleAt: this.lastAudibleAt,
      now: Date.now(),
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
      // A desk created empty has no label, nor does its cubicle (Editar espacios).
      this.bridge.emit('room', { spaceId, name: space === undefined || space === null ? null : space.name || 'Escritorio' });
      this.syncRoomLock();
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
    if (!this.localPositionReady) return;
    const peer = this.remotes?.get(sessionId);
    if (!peer) return; // se desconecto antes de que esto corriera: no-op silencioso.

    // Body tiles, like the planner: aiming at `tile * TILE + 16` put the body
    // center 27 px down its tile and the body 2 px into the next one, so a
    // desk below the approach tile stopped the walk short against it (#219).
    const walkerTile = bodyTileOf(this.player);
    const peerTile = bodyTileOf(peer);
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
    this.startWalk(positionForBodyTile(destination));
  }

  /**
   * Walks to `goal` around whatever `grid.solid` blocks (pathfinding, #2). The
   * route is planned BEFORE standing up: a goal nobody can reach leaves a
   * seated player seated and moves nothing. The planner tests the body
   * against what Arcade collides it with, so a goal is judged by where the
   * body would stand, not by the tile under the click.
   */
  private startWalk(goal: { x: number; y: number }): boolean {
    this.seatAfterWalk = null;
    const route = planWalk(this.walkWorld(), this.player, goal);
    if (route === null) return false;
    this.standUp();
    // The last stop is the goal itself: it stays the walk's destination.
    this.autoWalk = beginAutoWalk(goal, this.player, route.slice(0, -1));
    return true;
  }

  /**
   * The desk button: the closest free chair of the own desk by route length,
   * walked to with the same planner as a double click, and asked for on
   * arrival. The goal is a tile of the chair's reach ring, since the planner
   * refuses a goal the body does not fit on and a chair collides. Without a
   * free chair it walks into the desk area, like `walkToPeer` into a space.
   */
  private walkToOwnDesk(): void {
    if (!this.localPositionReady) return;
    const deskIndex = this.desks.findIndex((desk) => desk.mine);
    const area = this.deskAreas[deskIndex];
    if (area === undefined) return;
    const infoOf = decorInfoFromManifest(this.art.manifest);
    const width = this.layout.width;
    const onDesk = new Set(
      this.officeDecor
        .filter((item) => isDecorChairPiece(item.piece) && isOnDesk(item, infoOf(item.piece), area, width))
        .map((item) => chairSeatId(item.index)),
    );
    if (this.seat !== null && onDesk.has(this.seat.id)) return;
    const chairs = this.freeSeats().filter((seat) => onDesk.has(seat.id));

    const inReach = chairs.find((seat) => inSeatReach(this.player, seat.reach));
    if (inReach !== undefined) {
      this.resetWalking();
      this.requestSeat(inReach);
      return;
    }

    let best: { seat: ResolvedSeat; goal: { x: number; y: number }; length: number } | null = null;
    const world = this.walkWorld();
    for (const seat of chairs) {
      for (let ty = seat.reach.y0 - SEAT_REACH_TILES; ty <= seat.reach.y1 + SEAT_REACH_TILES; ty++) {
        for (let tx = seat.reach.x0 - SEAT_REACH_TILES; tx <= seat.reach.x1 + SEAT_REACH_TILES; tx++) {
          const goal = positionForBodyTile({ tx, ty });
          if (!inSeatReach(goal, seat.reach)) continue;
          const route = planWalk(world, this.player, goal);
          if (route === null) continue;
          const length = routeLength(this.player, route);
          if (best === null || length < best.length) best = { seat, goal, length };
        }
      }
    }
    if (best !== null) {
      if (this.startWalk(best.goal)) this.seatAfterWalk = best.seat.id;
      return;
    }

    const deskTiles: TileRect = { x0: area.x, y0: area.y, x1: area.x + area.w - 1, y1: area.y + area.h - 1 };
    const center = { tx: area.x + Math.floor(area.w / 2), ty: area.y + Math.floor(area.h / 2) };
    const destination = pickApproachTile(this.grid, bodyTileOf(this.player), center, deskTiles);
    if (destination) this.startWalk(positionForBodyTile(destination));
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
    if (this.mapHeld || !this.localPositionReady) { vx = 0; vy = 0; }

    // Push-to-sit: right after asking for a seat the keys move nothing, then
    // walking stands up first; walking into a free chair sits.
    if (sitLockActive(this.sitLockUntil, time)) { vx = 0; vy = 0; }
    else this.sitLockUntil = null;
    if (vx !== 0 || vy !== 0) this.standUp();
    if (this.pushToSit(time, vx, vy)) { vx = 0; vy = 0; }

    const from = { x: this.player.x, y: this.player.y };
    const gap = this.lastWalkFrame === undefined ? delta : time - this.lastWalkFrame;
    const interrupted = this.mapHeld || !this.localPositionReady || document.hidden || !Number.isFinite(delta) ||
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
    this.animateDoors(delta);
    if (this.localPositionReady && this.connectionState === 'connected') {
      this.connection?.sendMove(this.player.x, this.player.y, this.facing);
    }
    this.mmMarker?.setPosition(this.player.x, this.player.y);
    this.updateSpaceShade();
    this.updateDeskHover();
  }

  /**
   * Tells React which desk is under the pointer and where its top edge is on
   * screen (`deskhover`), every frame since the camera moves under a still
   * pointer. A hit test on the served areas, not interactive zones
   * (`deskAt`). Nothing while an editor is open, the pointer is off the canvas
   * or over the minimap.
   */
  private updateDeskHover(): void {
    const camera = this.cameras.main;
    const pointer = this.input.activePointer;
    const overMap = !this.layoutEditing && this.pointerOnMap && this.cameras.getCamerasBelowPointer(pointer)[0] === camera;
    const desk = overMap ? deskAt(camera.getWorldPoint(pointer.x, pointer.y), this.desks) : null;
    if (desk === null) {
      if (this.deskHoverKey !== null) this.bridge.emit('deskhover', null);
      this.deskHoverKey = null;
      return;
    }

    // Game pixels to CSS pixels of the page: the canvas may be offset or scaled.
    const canvas = this.game.canvas.getBoundingClientRect();
    const scaleX = canvas.width / this.scale.width;
    const scaleY = canvas.height / this.scale.height;
    const x = Math.round(canvas.left + (camera.x + (desk.x + desk.w / 2 - camera.worldView.x) * camera.zoom) * scaleX);
    const y = Math.round(canvas.top + (camera.y + (desk.y - camera.worldView.y) * camera.zoom) * scaleY);
    const key = `${desk.id}:${x},${y}`;
    if (key === this.deskHoverKey) return;
    this.deskHoverKey = key;
    this.bridge.emit('deskhover', { deskId: desk.id, x, y });
  }

  /**
   * Shades everything outside the room or desk the player stands in
   * (`spaceFocus.ts`). Redrawn only when that space changes; an open editor
   * works on the whole map, so nothing steps back while one is.
   */
  private updateSpaceShade(): void {
    const space = this.layoutEditing ? null : detectSpace({ x: this.player.x, y: this.player.y }, this.spaces);
    const key = shadeKey(space);
    if (key === this.spaceShadeKey) return;
    this.spaceShadeKey = key;
    for (const rect of this.spaceShade.splice(0)) rect.destroy();
    if (space === null) return;

    // A whole map past each edge: the camera can show the void around it.
    const w = this.layout.width * TILE;
    const h = this.layout.height * TILE;
    for (const rect of shadeAround(space, { x: -w, y: -h, w: 3 * w, h: 3 * h })) {
      const shade = this.add
        .rectangle(rect.x, rect.y, rect.w, rect.h, 0x000000, SPACE_SHADE_ALPHA)
        .setOrigin(0, 0)
        .setDepth(SPACE_SHADE_DEPTH)
        .setName(SPACE_SHADE_NAME);
      // The minimap shows the whole office, not the player's focus.
      this.minimapCamera?.ignore(shade);
      this.spaceShade.push(shade);
    }
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
      // Reuse Arcade's spatial index: no second collision map; the route itself comes from `startWalk`.
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
    // A full desk takes nobody else in (`deskDecorRules.ts`): the step that
    // would enter it is undone, and an auto-walk into it ends there.
    // So does a locked space, to whoever is not in it (`spaceLocks.ts`).
    const fullDesk = intended && this.fullDeskOnTheWay(from, this.player) !== null;
    const lockedSpace = intended && !fullDesk ? lockedSpaceEntered(from, this.player, this.spaces, this.lockedSpaces) : null;
    if (fullDesk || lockedSpace !== null) {
      body.reset(from.x, from.y);
      body.updateFromGameObject();
      body.setVelocity(0, 0);
      this.autoWalk = undefined;
      if (fullDesk && !this.deskFullTold) this.bridge.emit('deskfull', undefined);
      if (lockedSpace !== null && !this.spaceLockedTold) this.bridge.emit('spacelocked', { spaceId: lockedSpace.id });
      if (fullDesk) this.deskFullTold = true;
      else this.spaceLockedTold = true;
    } else if (!intended || Math.hypot(this.player.x - from.x, this.player.y - from.y) > 0.000001) {
      this.deskFullTold = false;
      this.spaceLockedTold = false;
    }
    const moved = Math.hypot(this.player.x - from.x, this.player.y - from.y) > 0.000001;
    const walking = advanceWalkingTime(this.walkingMs, this.walkingIdleMs, intended && moved && this.seat === null, delta);
    this.walkingMs = walking.continuousMs;
    this.walkingIdleMs = walking.idleMs;
    // Only the final goal ends a walk; the stops on the way are passed by the reducer.
    if (this.autoWalk && isAutoWalkArrived(this.autoWalk, this.player)) {
      this.autoWalk = undefined;
      this.walkingMs = 0;
      this.walkingIdleMs = 0;
      body.setVelocity(0, 0);
      // The chair may have been taken on the way: only a still free one is asked for.
      const seat = this.freeSeats().find((candidate) => candidate.id === this.seatAfterWalk);
      this.seatAfterWalk = null;
      if (seat !== undefined && inSeatReach(this.player, seat.reach)) this.requestSeat(seat);
    }
  }
}

function facingFromSnapshot(facing: string): Facing {
  return facing === 'up' || facing === 'down' || facing === 'left' || facing === 'right' ? facing : DEFAULT_FACING;
}

/** Path length from `from` through every stop of a planned route. */
function routeLength(from: { x: number; y: number }, route: readonly { x: number; y: number }[]): number {
  let length = 0;
  let at = from;
  for (const stop of route) {
    length += Math.hypot(stop.x - at.x, stop.y - at.y);
    at = stop;
  }
  return length;
}
