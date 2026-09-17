import Phaser from 'phaser';
import type { AnchorWriter } from './anchorChannel';
import { preloadOfficeAssets } from './assets';
import {
  setCharacterFacing,
  setCharacterStatus,
  spawnNpcs,
  spawnPlayer,
  walkNpcTo,
  type CharacterContainer,
  type NpcContainer,
} from './characters';
import { mergeColliderRects } from './colliderMerge';
import { placeFurniture, placeNature, placeZoneLabels, renderGround } from './mapBuilder';
import { PROX_RADIUS, ROOMS, TILE, WORLD_H, WORLD_W } from './mapData';
import type { OfficeBridge } from './officeBridge';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  facingFrom,
  type Facing,
  type PresenceStatus,
} from './officeProtocol';
import {
  connectOfficeRoom,
  type ConnectOfficeRoomOptions,
  type OfficeConnection,
} from './officeRoomClient';
import { createRemoteAvatarRegistry, type RemoteAvatarRegistry } from './remoteAvatars';
import { createPhaserAvatarSink, type RemoteAvatarContainer } from './remoteAvatarSink';
import { detectRoom, isSpeaking, nearbyIndices, nearbyKey, type Point } from './proximity';
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
 * Como se conecta la escena al servidor. `connect` se inyecta para poder
 * probar el cableado sin levantar un Colyseus real: el protocolo por cable ya
 * lo cubren los tests de la capa node contra un servidor de verdad.
 */
export interface OfficeSceneOptions {
  /** `null` desactiva el multijugador: la oficina corre en solitario. */
  endpoint?: string | null;
  playerName?: string;
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
 * (`prototype/js/app.js:67-96,325-501`). Orquesta texturas, mapa, NPCs,
 * jugador, input, camaras, colisiones y el ciclo de proximidad/salas.
 *
 * El puente se inyecta por constructor (D2), no por `registry`: es
 * deterministico y evita depender de que una escritura llegue antes de que
 * `create()` arranque de forma asincrona.
 */
export class OfficeScene extends Phaser.Scene {
  private readonly bridge: OfficeBridge;
  private grid!: TerrainGrid;
  private npcs: NpcContainer[] = [];
  private player!: CharacterContainer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  private mmMarker?: Phaser.GameObjects.Arc;
  private lastNearbyKey = '';
  /** Clave de dedupe de "voice" (D3): incluye sala y `selfSessionId`, no solo los pares. */
  private lastVoiceKey = '';
  private currentRoom: string | null = null;
  private unsubscribeTeleport?: () => void;
  private unsubscribeCallNpc?: () => void;
  private unsubscribeSetStatus?: () => void;
  private unsubscribeSpeakers?: () => void;
  /** Solo se asigna bajo `__OFFICE_E2E__` (D4): produccion nunca la toca. */
  private unsubscribeTeleportToTile?: () => void;
  /** Escritor del canal de anclas (issue #17, D4); abierto en `create()`, cerrado en SHUTDOWN. */
  private anchorWriter?: AnchorWriter;

  private readonly options: OfficeSceneOptions;
  private remotes?: RemoteAvatarRegistry<RemoteAvatarContainer>;
  private connection?: OfficeConnection;
  private facing: Facing = DEFAULT_FACING;
  /** Estado de presencia del jugador local; React es quien lo cambia (ver `setStatus`). */
  private status: PresenceStatus = DEFAULT_STATUS;
  /** Vivo mientras la escena lo este: corta las respuestas tardias de la red. */
  private alive = true;

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

    this.npcs = spawnNpcs(this, this.bridge);
    this.player = spawnPlayer(this);

    this.buildColliders(grid);
    this.setupCameras();
    this.setupInput();

    this.unsubscribeTeleport = this.bridge.onCommand('teleportTo', ({ npcId }) => {
      this.teleportTo(npcId);
    });
    this.unsubscribeCallNpc = this.bridge.onCommand('callNpc', ({ npcId }) => {
      this.callNpc(npcId);
    });
    this.unsubscribeSetStatus = this.bridge.onCommand('setStatus', ({ status }) => {
      this.setStatus(status);
    });
    this.unsubscribeSpeakers = this.bridge.onCommand('speakers', ({ sessionIds }) => {
      this.applySpeakers(sessionIds);
    });

    // D4: unico bloque muerto en produccion de este archivo -- deja tanto el
    // literal 'teleportToTile' como su handler fuera de `dist/`. Espeja
    // `teleportTo`, pero mueve al jugador a una tile exacta, sin buscar una
    // libre adyacente: el hook de test necesita entrar a una sala concreta,
    // no aterrizar junto a un NPC.
    if (__OFFICE_E2E__) {
      this.unsubscribeTeleportToTile = this.bridge.onCommand('teleportToTile', ({ tx, ty }) => {
        if (isBlocked(this.grid, tx, ty)) return;
        this.player.setPosition(tx * TILE + 16, ty * TILE + 16);
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      this.unsubscribeTeleport?.();
      this.unsubscribeCallNpc?.();
      this.unsubscribeSetStatus?.();
      this.unsubscribeSpeakers?.();
      this.unsubscribeTeleportToTile?.();
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
   * fatal: la oficina se queda en solitario con los NPCs simulados y se avisa
   * por el puente. Cualquier otra cosa dejaria la pantalla en negro cada vez
   * que el servidor no este levantado, que en desarrollo es la mitad del rato.
   */
  private async connectToOffice(): Promise<void> {
    const { endpoint, connect = connectOfficeRoom, playerName = this.player.nameText } =
      this.options;

    if (endpoint === null || endpoint === undefined) {
      this.bridge.emit('presence', { online: false, peers: 0 });
      // Sin sesion Colyseus nunca se intenta LiveKit (matriz de degradacion, PRD 6.3).
      this.emitVoice(null, [], this.currentRoom);
      return;
    }

    const joinedStatus = this.status;

    try {
      const connection = await connect({
        endpoint,
        name: playerName,
        status: joinedStatus,
        handlers: {
          onAdd: (snapshot) => {
            this.remotes?.upsert(snapshot);
            this.emitPresence(true);
          },
          onChange: (snapshot) => this.remotes?.upsert(snapshot),
          onRemove: (sessionId) => {
            this.remotes?.remove(sessionId);
            this.emitPresence(true);
          },
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
      this.remotes = createRemoteAvatarRegistry(createPhaserAvatarSink(this), {
        ignoreSessionId: connection.sessionId,
      });
      this.emitPresence(true);
      // Sesion viva, todavia sin pares conocidos (el primer tic los completa).
      this.emitVoice(connection.sessionId, [], this.currentRoom);
    } catch {
      if (!this.alive) return;
      this.bridge.emit('presence', { online: false, peers: 0 });
      this.emitVoice(null, [], this.currentRoom);
    }
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
   * Proyecta la posicion de cada avatar remoto a coordenadas de pantalla y
   * las publica por el canal de anclas (issue #17, D4). Se ejecuta cada
   * cuadro, no cada tic de proximidad: la posicion es continua, la
   * existencia/contenido del tile no lo es.
   */
  private publishAnchors(): void {
    if (!this.anchorWriter) return;
    const cam = this.cameras.main;
    for (const sessionId of this.remotes?.sessionIds() ?? []) {
      const avatar = this.remotes?.get(sessionId);
      if (!avatar) continue;
      const screenX = (avatar.x - cam.scrollX) * cam.zoom;
      const screenY = (avatar.y - cam.scrollY) * cam.zoom;
      this.anchorWriter.set(sessionId, screenX, screenY, cam.worldView.contains(avatar.x, avatar.y));
    }
    this.anchorWriter.commit();
  }

  private emitPresence(online: boolean): void {
    this.bridge.emit('presence', { online, peers: this.remotes?.sessionIds().length ?? 0 });
  }

  /**
   * Unico punto de emision de "voice" (D3): tic, conexion exitosa y fallo de
   * conexion comparten el mismo `lastVoiceKey`, asi que un evento disparado
   * por conexion que no cambia nada frente al ultimo tic no duplica el aviso.
   */
  private emitVoice(
    selfSessionId: string | null,
    sessionIds: string[],
    room: string | null,
  ): void {
    const key = `${nearbyKey(sessionIds)}|${room ?? ''}|${selfSessionId ?? ''}`;
    if (key === this.lastVoiceKey) return;
    this.lastVoiceKey = key;
    this.bridge.emit('voice', { selfSessionId, sessionIds, room });
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
    const now = this.time.now;
    const room = detectRoom({ x: player.x, y: player.y }, ROOMS);
    const selfSessionId = this.connection?.sessionId ?? null;

    // Sala detectada POR PAR, no la del jugador: cada avatar remoto puede
    // estar en una sala distinta a la propia.
    const audioPeers: AudioPeer[] = (this.remotes?.sessionIds() ?? []).flatMap((sessionId) => {
      const avatar = this.remotes?.get(sessionId);
      if (!avatar) return [];
      // El estado sale del contenedor, que el sink ya mantiene al dia con lo
      // que llega del servidor: es la misma fuente que pinta el punto, asi que
      // el color y el audio no pueden contarse historias distintas.
      return [
        {
          sessionId,
          x: avatar.x,
          y: avatar.y,
          room: detectRoom(avatar, ROOMS),
          status: avatar.status,
        },
      ];
    });
    const audibleIds = audiblePeers({
      self: { sessionId: selfSessionId, x: player.x, y: player.y, room, status: this.status },
      peers: audioPeers,
      radius: PROX_RADIUS,
    });
    const peerNames = audibleIds
      .map((id) => this.remotes?.get(id)?.nameText)
      .filter((name): name is string => name !== undefined);

    const points: Point[] = this.npcs.map((c) => ({ x: c.x, y: c.y }));
    const nearSet = new Set(nearbyIndices({ x: player.x, y: player.y }, points, PROX_RADIUS));

    const npcNames: string[] = [];
    this.npcs.forEach((c, i) => {
      const near = nearSet.has(i);
      c.ring.setVisible(near && isSpeaking(now, c.phase));
      if (near) npcNames.push(c.nameText);
    });

    // D7: los pares reales lideran el arreglo. `BottomBar` recorta a
    // `NEARBY_CHIP_LIMIT`; con los NPCs primero un companero audible podria
    // quedar en el "+N" y eso deshace la decision que este cambio implementa.
    // La asimetria es deliberada: los NPCs no tienen audio, son simulacion
    // local y su seleccion sigue siendo pura por radio -- aplicarles la regla
    // de sala cambiaria su comportamiento visible sin ningun beneficio.
    const names = [...peerNames, ...npcNames];
    const key = nearbyKey(names);
    if (key !== this.lastNearbyKey) {
      this.lastNearbyKey = key;
      this.bridge.emit('nearby', { names });
    }

    if (room !== this.currentRoom) {
      this.currentRoom = room;
      this.bridge.emit('room', { room });
    }

    this.emitVoice(selfSessionId, audibleIds, room);
  }

  /** Mueve al jugador a una tile libre adyacente al NPC objetivo (app.js:474-486). */
  private teleportTo(npcId: number): void {
    const target = this.npcs[npcId];
    if (!target) return;

    const destination = findFreeAdjacentTile(
      this.grid,
      Math.floor(target.x / TILE),
      Math.floor(target.y / TILE),
    );
    if (!destination) return;

    this.player.setPosition(destination.tx * TILE + 16, destination.ty * TILE + 16);
    this.cameras.main.flash(200, 255, 255, 255, false);
  }

  /**
   * Hace que el NPC llamado camine hasta una tile libre junto al jugador. Es
   * el reflejo de `teleportTo`: alli se mueve el jugador hacia el NPC, aqui el
   * NPC hacia el jugador, y por eso ambos comparten `findFreeAdjacentTile`.
   *
   * El destino se calcula al recibir la llamada, no se persigue: si el jugador
   * se mueve despues, el NPC termina donde el jugador estaba. Perseguir exige
   * pathfinding sobre la rejilla, que no toca hasta que los avatares remotos
   * de Colyseus definan como se navega.
   */
  private callNpc(npcId: number): void {
    const npc = this.npcs[npcId];
    if (!npc) return;

    const destination = findFreeAdjacentTile(
      this.grid,
      Math.floor(this.player.x / TILE),
      Math.floor(this.player.y / TILE),
    );
    if (!destination) return;

    walkNpcTo(this, npc, destination.tx, destination.ty);
  }

  update(): void {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;

    const velocity = new Phaser.Math.Vector2(vx, vy).normalize().scale(PLAYER_SPEED);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(velocity.x, velocity.y);
    this.player.setDepth(this.player.y);
    this.facing = facingFrom(vx, vy, this.facing);
    setCharacterFacing(this.player, this.facing);

    for (const npc of this.npcs) npc.setDepth(npc.y);
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
