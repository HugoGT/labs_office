import Phaser from 'phaser';
import {
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
import { detectRoom, isSpeaking, nearbyIndices, nearbyKey, type Point } from './proximity';
import { buildTerrainGrid, findFreeAdjacentTile, type TerrainGrid } from './terrainGrid';
import { createOfficeTextures } from './textures';

/** Clave de la escena (D5): reemplaza `BootScene`, que se retira en este mismo cambio. */
export const OFFICE_SCENE_KEY = 'office';

const PLAYER_SPEED = 230;
const PROXIMITY_TICK_MS = 250;
const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;
const MINIMAP_MARGIN = 14;

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
  private currentRoom: string | null = null;
  private unsubscribeTeleport?: () => void;
  private unsubscribeCallNpc?: () => void;

  constructor(bridge: OfficeBridge) {
    super(OFFICE_SCENE_KEY);
    this.bridge = bridge;
  }

  create(): void {
    createOfficeTextures(this);

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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeTeleport?.();
      this.unsubscribeCallNpc?.();
    });

    this.time.addEvent({
      delay: PROXIMITY_TICK_MS,
      loop: true,
      callback: () => this.proximityTick(),
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

  /** Cercania + deteccion de sala cada 250 ms (app.js:444-471), emitidas por el puente (D1). */
  private proximityTick(): void {
    const player = this.player;
    const now = this.time.now;
    const points: Point[] = this.npcs.map((c) => ({ x: c.x, y: c.y }));
    const nearSet = new Set(nearbyIndices({ x: player.x, y: player.y }, points, PROX_RADIUS));

    const names: string[] = [];
    this.npcs.forEach((c, i) => {
      const near = nearSet.has(i);
      c.ring.setVisible(near && isSpeaking(now, c.phase));
      if (near) names.push(c.nameText);
    });

    const key = nearbyKey(names);
    if (key !== this.lastNearbyKey) {
      this.lastNearbyKey = key;
      this.bridge.emit('nearby', { names });
    }

    const room = detectRoom({ x: player.x, y: player.y }, ROOMS);
    if (room !== this.currentRoom) {
      this.currentRoom = room;
      this.bridge.emit('room', { room });
    }
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
   * pathfinding sobre la rejilla, que no toca todavia.
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

    for (const npc of this.npcs) npc.setDepth(npc.y);

    this.mmMarker?.setPosition(this.player.x, this.player.y);
  }
}
