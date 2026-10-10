import Phaser from 'phaser';
import * as vitestBrowser from 'vitest/browser';
import type { BrowserCommands } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import type { CharacterContainer } from './characters';
import {
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  SPAWN_BLOCK_INDEX,
  TILE,
  ZONE_LABELS,
} from './mapData';
import { TERRAIN_LAYER_COUNT } from './artContract';
import { terrainSnapshot, withBlock, withWalls, type OfficeLayout } from './officeLayout';
import { CHAIR_OBJECT_NAME, WALL_OBJECT_NAME } from './mapBuilder';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS, LEGACY_SPACES as BUILT_IN_SPACES } from '../test/legacyOffice';
const BUILT_IN_SPACES_VERSION = 'a489c5da5efd7c68';
import {
  DESK_ZONE_DEPTH,
  MINIMAP_MARKER_DEPTH,
  avatarDepth,
  chairLayerDepth,
  worldAssetDepth,
} from './depthLayers';
import { feetOf, physicalBodyRect } from './avatarGeometry';
import { BODY_CENTER_OFFSET, positionForBodyTile } from './pathfinding';
import { chairSeatId, decorSeatId, deskSeatId, mapSeatId } from './seating';
import { deskFurnitureName, deskItemName, deskZoneName } from './deskLayout';
import { artSheetKey, recoloredSheetKey } from './artPack';
import { ArtPackLoader } from './artPackLoader';
import { deskAreaAnchor, deskPlacement, spaceFloorTiles } from './artPlacement';
import type { ArtDeskPiece } from './artContract';
import { buildTerrainGrid } from './terrainGrid';
import { VOID_COLOR } from './terrainRender';
import type { DeskDecorItem, DeskOccupant, OfficeDesk } from './desksPort';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { DEFAULT_NAME, DEFAULT_STATUS, type PresenceStatus } from './officeProtocol';
import { STATUS_COLOR } from './presence';
import { AVATAR_KEYS, PLAYER_TEXTURE } from './textures';
import {
  OfficeAccessDeniedError,
  connectOfficeRoom,
  type ConnectOfficeRoomOptions,
  type OfficeConnection,
  type OfficeRoomHandlers,
} from './officeRoomClient';
import { OFFICE_SCENE_KEY, OfficeScene, type OfficeSceneOptions } from './OfficeScene';
import { ARRIVE_EPSILON_PX, beginAutoWalk, type AutoWalkState } from './autoWalk';
import { SIT_LOCK_MS } from './autoSit';
import { regionBounds } from './cameraBounds';
import { zoomView, type ZoomStore, type ZoomView } from './mapZoom';

/**
 * `OfficeScene` orquesta fisica, camaras, tweens y timers desde el slice 7 en
 * adelante: no se prueba con una superficie falsa (ver D5) sino siempre
 * dentro de un `Phaser.Game` real, igual que `createGame`/`mapBuilder`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

// Deterministic render frames through the real SceneManager and Arcade world,
// not a reducer simulation or a mocked body. An empty arena isolates movement.
async function movementArena(connector?: ReturnType<typeof fakeConnector>) {
  const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), connector
    ? { endpoint: 'ws://fake', connect: connector.connect, artManifestUrl: null, artUploadsUrl: null }
    : { endpoint: null, artManifestUrl: null, artUploadsUrl: null });
  if (connector) await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
  const player = findPlayer(scene);
  const body = player.body as Phaser.Physics.Arcade.Body;
  scene.game.loop.stop();
  for (const collider of scene.physics.world.colliders.update()) collider.active = false;
  for (const staticBody of scene.physics.world.staticBodies.getArray()) staticBody.gameObject.destroy();
  scene.physics.world.postUpdate();
  scene.physics.world.setBounds(0, 0, 100000, 100000);
  body.reset(300, 300);
  const movement = scene as unknown as {
    walkingMs: number;
    autoWalk?: AutoWalkState;
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    buildTerrainColliders(grid: ReturnType<typeof buildTerrainGrid>): void;
    buildPieceColliders(): void;
    collisionRects: { x: number; y: number; w: number; h: number }[];
    grid: ReturnType<typeof buildTerrainGrid>;
  };
  movement.grid.solid = Array.from({ length: 100 }, (_, y) => Array.from({ length: 3200 }, () => y === 0));
  let time = scene.time.now;
  const frame = (delta = 20, gap = delta) => { time += gap; scene.game.step(time, delta); };
  const walk = (milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) frame();
  };
  /** Runs the game clock forward in frames the walk stall guard accepts (each gap <= 100 ms). */
  const wait = (milliseconds: number) => {
    for (let left = milliseconds; left > 0; left -= 100) frame(20, Math.min(left, 100));
  };
  /** One press and release. `screenDx` moves it on screen only: the double-click distance is in screen px. */
  const click = (x: number, y: number, distance = 0, over: Phaser.GameObjects.GameObject[] = [], screenDx = 0) => {
    const pointer = { button: 0, camera: scene.cameras.main, x: 10 + screenDx, y: 10,
      worldX: x, worldY: y, getDistance: () => distance };
    scene.input.emit('pointerdown', pointer, over);
    scene.input.emit('pointerup', pointer, over);
  };
  /**
   * Two clicks, the walk gesture. Both land on the same time and screen point unless `gapMs` (game clock,
   * advanced in real frames) or `screenDx` say otherwise. `distance`, `over` and `worldDx` shape the SECOND
   * press only, so a test proves that press is the ineligible one. No frame runs in between by default:
   * a frame with no input would reset the walking-speed clock, which some tests keep on purpose.
   */
  const doubleClick = (x: number, y: number, options: {
    gapMs?: number; screenDx?: number; worldDx?: number; distance?: number; over?: Phaser.GameObjects.GameObject[];
  } = {}) => {
    click(x, y);
    wait(options.gapMs ?? 0);
    click(x + (options.worldDx ?? 0), y, options.distance, options.over, options.screenDx);
  };
  return { scene, bridge, player, body, movement, frame, walk, wait, click, doubleClick };
}

describe('walking speed ramp in real Phaser frames (#145)', () => {
  it('reproduces unbounded Arcade tunneling and prevents it through the production frame path', async () => {
    const { scene, body, movement, frame } = await movementArena();
    movement.collisionRects = [{ x: 0, y: 350, w: 10000, h: 1 }];
    movement.buildPieceColliders();
    body.setVelocity(0, 690);
    scene.physics.world.update(0, 100);
    scene.physics.world.postUpdate();
    expect(body.y).toBeGreaterThan(351);
    body.reset(300, 300);
    movement.walkingMs = 3000;
    movement.cursors.down.isDown = true;
    frame(100);
    expect(body.bottom).toBeLessThanOrEqual(350.001);
  });

  it.each([[1, 1], [-1, -1], [1, -1], [-1, 1]])('resolves a one-pixel diagonal corner between samples (%i, %i)', async (sx, sy) => {
    const { player, body, movement, frame } = await movementArena();
    // The continuous path overlaps this corner for only 1px of travel, less
    // than a bounded Arcade step. Discrete sampling alone is not sufficient.
    const rect = { x: sx > 0 ? 350 : 649, y: sy > 0 ? 375 : 624, w: 1, h: 1 };
    movement.collisionRects = [rect];
    movement.buildPieceColliders();
    const footprint = physicalBodyRect({ x: 0, y: 0 });
    const gapX = 25;
    // Keep the continuous corner overlap below one pixel of travel for either footprint width.
    const gapY = gapX + footprint.width + 0.2;
    const start = {
      x: (sx > 0 ? rect.x - gapX - footprint.width : rect.x + rect.w + gapX) - footprint.x,
      y: (sy > 0 ? rect.y - gapY - footprint.height : rect.y + rect.h + gapY) - footprint.y,
    };
    body.reset(start.x, start.y);
    movement.walkingMs = 3000;
    movement.cursors.right.isDown = sx > 0;
    movement.cursors.left.isDown = sx < 0;
    movement.cursors.down.isDown = sy > 0;
    movement.cursors.up.isDown = sy < 0;
    frame(100);
    const uninterrupted = 690 * 0.1 / Math.SQRT2;
    expect(Math.min((player.x - start.x) * sx, (player.y - start.y) * sy)).toBeLessThan(uninterrupted - 0.01);
    expect(body.right > rect.x && body.x < rect.x + 1 && body.bottom > rect.y && body.y < rect.y + 1).toBe(false);
  });
  it.each(['keyboard', 'map click'] as const)('ramps %s through every threshold and caps at 3x', async (input) => {
    const { body, movement, frame, walk, doubleClick } = await movementArena();
    if (input === 'keyboard') movement.cursors.right.isDown = true;
    else doubleClick(99000, 300);
    for (let multiplier = 1; multiplier <= 3; multiplier++) {
      frame();
      expect(body.velocity.length(), JSON.stringify(movement.autoWalk)).toBeCloseTo(230 * multiplier, 5);
      walk(1500);
    }
    expect(body.velocity.length()).toBeCloseTo(690, 5);
  });

  it('preserves the clock on direction changes and keyboard takeover, and resets 1 s after release and on arrival', async () => {
    const { player, body, movement, frame, walk, doubleClick } = await movementArena();
    movement.cursors.right.isDown = true;
    walk(2100);
    movement.cursors.right.isDown = false;
    movement.cursors.down.isDown = true;
    frame();
    expect(body.velocity.y).toBeCloseTo(460);
    movement.cursors.down.isDown = false;
    doubleClick(player.x + 5000, player.y);
    frame();
    expect(body.velocity.x).toBeCloseTo(460);
    movement.cursors.left.isDown = true;
    frame();
    expect(body.velocity.x).toBeCloseTo(-460);
    movement.cursors.left.isDown = false;
    walk(980);
    expect(movement.walkingMs).toBeGreaterThan(1500);
    frame();
    expect(movement.walkingMs).toBe(0);
    movement.walkingMs = 3000;
    const goalX = player.x + 3;
    doubleClick(goalX, player.y);
    frame(100);
    expect(Math.abs(player.x - goalX)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
    expect(movement.autoWalk).toBeUndefined();
    expect(body.velocity.length()).toBe(0);
    expect(movement.walkingMs).toBe(0);
  });

  it('keeps the speed for 1 s after a bump or a gap between keys, then drops back to 1x', async () => {
    const { body, movement, frame, walk } = await movementArena();
    movement.cursors.right.isDown = true;
    walk(3000);
    frame();
    expect(body.velocity.x).toBeCloseTo(690, 5);
    // Release one key and press another a few frames later: the turn keeps 3x.
    movement.cursors.right.isDown = false;
    walk(200);
    movement.cursors.down.isDown = true;
    frame();
    expect(body.velocity.y).toBeCloseTo(690, 5);
    // A head-on bump holds the speed for under 1 s; sliding away resumes at 3x.
    movement.collisionRects = [{ x: 0, y: body.bottom + 10, w: 10000, h: 1 }];
    movement.buildPieceColliders();
    walk(900);
    expect(movement.walkingMs).toBe(3000);
    movement.cursors.down.isDown = false;
    movement.cursors.right.isDown = true;
    frame();
    expect(body.velocity.x).toBeCloseTo(690, 5);
    // Blocked for a full second: back to normal speed.
    movement.cursors.right.isDown = false;
    movement.cursors.down.isDown = true;
    walk(1000);
    expect(movement.walkingMs).toBe(0);
    movement.cursors.down.isDown = false;
    movement.cursors.right.isDown = true;
    frame();
    expect(body.velocity.x).toBeCloseTo(230, 5);
  });

  it('does not credit blocked intent or sprint after a long or hidden frame', async () => {
    const { scene, player, body, movement, frame, walk } = await movementArena();
    movement.collisionRects = [{ x: 310, y: 0, w: 1, h: 10000 }];
    movement.buildPieceColliders();
    movement.cursors.right.isDown = true;
    walk(9000);
    expect(body.right).toBeLessThanOrEqual(310.001);
    expect(movement.walkingMs).toBe(0);
    movement.cursors.right.isDown = false;
    movement.cursors.down.isDown = true;
    movement.walkingMs = 3000;
    const y = player.y;
    frame(10000);
    expect(player.y).toBe(y);
    expect(movement.walkingMs).toBe(0);
    frame();
    expect(body.velocity.y).toBe(230);
    movement.walkingMs = 3000;
    const resumedY = player.y;
    frame(20, 10000);
    expect(player.y).toBe(resumedY);
    expect(movement.walkingMs).toBe(0);
    movement.walkingMs = 3000;
    scene.game.events.emit(Phaser.Core.Events.HIDDEN);
    scene.game.events.emit(Phaser.Core.Events.VISIBLE);
    frame();
    expect(body.velocity.y).toBe(230);
  });

  it('resets on sitting and on every layout editor mode', async () => {
    const { scene, bridge, body, movement, frame } = await movementArena();
    const seat = BASE_MAP_SEATS[0]!;
    body.reset((seat.tx + 0.5) * TILE, (seat.ty + 0.5) * TILE - 18);
    movement.walkingMs = 3000;
    bridge.emitCommand('toggleSeat', undefined);
    frame();
    expect(movement.walkingMs).toBe(0);
    expect(body.velocity.length()).toBe(0);
    bridge.emitCommand('toggleSeat', undefined);
    const openers = [
      () => bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null }),
      () => bridge.emitCommand('terrainedit', { brush: null }),
      () => bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 }),
    ];
    for (const open of openers) {
      movement.walkingMs = 3000;
      movement.cursors.right.isDown = true;
      movement.autoWalk = beginAutoWalk({ x: 5000, y: 5000 }, body);
      open();
      expect(movement.walkingMs).toBe(0);
      frame();
      expect(movement.walkingMs).toBe(0);
      expect(body.velocity.length()).toBe(0);
      expect(movement.autoWalk).toBeUndefined();
      bridge.emitCommand('layoutedit', null);
      bridge.emitCommand('terrainedit', null);
      bridge.emitCommand('collisionedit', null);
    }
    expect(scene.sys.isActive()).toBe(true);
  });

  it('does not turn drags, item clicks, blocked goals or minimap clicks into walking', async () => {
    const { scene, movement, click, doubleClick } = await movementArena();
    doubleClick(1000, 300, { distance: 20 });
    expect(movement.autoWalk).toBeUndefined();
    doubleClick(1000, 300, { over: [scene.add.rectangle(0, 0, 1, 1)] });
    expect(movement.autoWalk).toBeUndefined();
    doubleClick(16, 16);
    expect(movement.autoWalk).toBeUndefined();
    click(1000, 300);
    const pointer = { button: 0, camera: scene.cameras.cameras[1], x: 10, y: 10, getDistance: () => 0 };
    scene.input.emit('pointerdown', pointer, []);
    scene.input.emit('pointerup', pointer, []);
    expect(movement.autoWalk).toBeUndefined();
  });

  it.each([20, 100, 250])('cannot tunnel at 3x with %i ms frames, cardinal or diagonal', async (delta) => {
    const { body, movement, frame } = await movementArena();
    for (const input of ['keyboard', 'auto-walk'] as const) {
      for (const obstacle of ['wall', 'water', 'piece'] as const) {
        for (const horizontal of [true, false]) {
          for (const diagonal of [false, true]) {
            body.reset(300, 300);
            body.setVelocity(0, 0);
            movement.cursors.right.isDown = input === 'keyboard' && (horizontal || diagonal);
            movement.cursors.down.isDown = input === 'keyboard' && (!horizontal || diagonal);
            movement.autoWalk = input === 'auto-walk' ? beginAutoWalk({
              x: horizontal || diagonal ? 5000 : 300, y: !horizontal || diagonal ? 5000 : 300,
            }, { x: 300, y: 300 }) : undefined;
            movement.collisionRects = [];
            movement.buildPieceColliders();
            const emptyGrid = buildTerrainGrid();
            emptyGrid.terrainSolid = [[false]];
            movement.buildTerrainColliders(emptyGrid);
            if (obstacle === 'piece') {
              movement.collisionRects = [horizontal
                ? { x: 350, y: 0, w: 1, h: 10000 }
                : { x: 0, y: 350, w: 10000, h: 1 }];
              movement.buildPieceColliders();
            } else {
              const blocked = (index: number) => horizontal
                ? index % BASE_LAYOUT.width === 11 : Math.floor(index / BASE_LAYOUT.width) === 11;
              const tiles = BASE_LAYOUT.width * BASE_LAYOUT.height;
              const layout: OfficeLayout = {
                ...BASE_LAYOUT, props: [], hedges: Array(tiles).fill(null),
                ground: Array.from({ length: tiles }, (_, index) => obstacle === 'water' && blocked(index) ? 'water' : 'grass'),
                walls: Array.from({ length: tiles }, (_, index) => obstacle === 'wall' && blocked(index)
                  ? BASE_LAYOUT.walls.find((piece) => piece !== null)! : null),
              };
              const grid = buildTerrainGrid(terrainSnapshot(layout), layout, []);
              movement.buildTerrainColliders(grid);
            }
            movement.walkingMs = 3000;
            frame(20);
            expect(body.velocity.length()).toBeCloseTo(690, 5);
            for (let i = 0; i < 6; i++) frame(delta);
            expect(horizontal ? body.right : body.bottom).toBeLessThanOrEqual(obstacle === 'piece' ? 350.001 : 352.001);
          }
        }
      }
    }
  });
});

describe('waypoint walking around obstacles (double-click-pathfinding)', () => {
  it('authoritative reset cancels prediction, seat, keys and click pair without adopting ordinary echoes', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const { body, movement, player } = arena;
    arena.doubleClick(1000, 300);
    movement.cursors.right.isDown = true;
    arena.frame();
    arena.click(1100, 300);
    const target = remoteSnapshot({ x: 500, y: 600, seat: null });
    const handlers = connector.handlers()!;
    handlers.onPositionReset?.(target);
    expect({ x: player.x, y: player.y }).toEqual({ x: target.x, y: target.y });
    expect({ x: body.x, y: body.y, width: body.width, height: body.height }).toEqual(physicalBodyRect(target));
    expect(body.velocity.length()).toBe(0);
    expect(movement.autoWalk).toBeUndefined();
    expect(movement.cursors.right.isDown).toBe(false);
    arena.click(1100, 300);
    expect(movement.autoWalk).toBeUndefined();
    handlers.onChange(remoteSnapshot({ x: 800, y: 800 }));
    expect({ x: player.x, y: player.y }).toEqual({ x: target.x, y: target.y });
    const voices: OfficeEventMap['voice'][] = [];
    arena.bridge.on('voice', (voice) => voices.push(voice));
    handlers.onResync?.();
    handlers.onLocalPosition?.(remoteSnapshot({ x: 52 * TILE, y: 4 * TILE, seat: mapSeatId(0) }));
    arena.walk(300);
    expect(voices.at(-1)?.spaceId).toBe(BUILT_IN_SPACES[0]!.id);
    expect(player.seatFacing).not.toBeNull();
    expect(body.checkCollision.none).toBe(true);
    handlers.onPositionReset?.(target);
    expect(voices.at(-1)?.spaceId).toBeNull();
    expect(player.seatFacing).toBeNull();
    expect(body.checkCollision.none).toBe(false);
    expect({ x: body.x, y: body.y, width: body.width, height: body.height }).toEqual(physicalBodyRect(target));
  });

  type Arena = Awaited<ReturnType<typeof movementArena>>;
  const SEAT = BASE_MAP_SEATS[0]!;

  /** A wall of whole tiles, in the search grid and as the collision rectangle the body bumps into. */
  function wallColumn(movement: Arena['movement'], tx: number, ty0: number, ty1: number) {
    const solid = movement.grid.solid as boolean[][];
    for (let ty = ty0; ty <= ty1; ty++) solid[ty]![tx] = true;
    // The arena keeps the real office's piece rectangles; only this test's walls may stay.
    movement.collisionRects = [
      ...movement.collisionRects.filter((rect) => !('piece' in rect)),
      { x: tx * TILE, y: ty0 * TILE, w: TILE, h: (ty1 - ty0 + 1) * TILE },
    ];
    movement.buildPieceColliders();
  }

  /** Steps real frames until the walk ends (arrival, stall cancel) or the budget runs out. */
  function walkUntilDone(arena: Arena, maxFrames = 1500) {
    const ys: number[] = [];
    for (let i = 0; i < maxFrames && arena.movement.autoWalk !== undefined; i++) {
      arena.frame();
      ys.push(arena.player.y);
    }
    return { minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  function sitOnFirstChair(arena: Arena) {
    arena.body.reset((SEAT.tx + 0.5) * TILE, (SEAT.ty + 0.5) * TILE - 18);
    arena.bridge.emitCommand('toggleSeat', undefined);
    arena.frame();
    expect(arena.player.seatFacing).not.toBeNull();
  }

  it('a click behind a wall walks around it and arrives without a stall cancel (R3)', async () => {
    const arena = await movementArena();
    const { player, movement } = arena;
    // Tiles 5..14 of column 12 stand between the player (tile 9,9) and the goal.
    wallColumn(movement, 12, 5, 14);
    const goal = { x: 600, y: 300 };

    arena.doubleClick(goal.x, goal.y);
    expect(movement.autoWalk?.waypoints?.length, 'a wall in the way needs waypoints').toBeGreaterThan(0);
    const path = walkUntilDone(arena);

    expect(movement.autoWalk).toBeUndefined();
    expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
    // The wall spans y 160..480: arriving means the route left that band.
    expect(path.minY < 160 || path.maxY > 480).toBe(true);
  });

  it('a goal past the top end of the wall is reached by an angled detour', async () => {
    const arena = await movementArena();
    const { player, movement } = arena;
    wallColumn(movement, 12, 5, 14);
    const goal = { x: 640, y: 120 };

    arena.doubleClick(goal.x, goal.y);
    walkUntilDone(arena);

    expect(movement.autoWalk).toBeUndefined();
    expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
  });

  it('a click on ground with no path does nothing and keeps a seated player seated (R4)', async () => {
    const arena = await movementArena();
    const { player, movement } = arena;
    sitOnFirstChair(arena);
    const start = { x: player.x, y: player.y };
    // Tile (60,40) is free but fully ringed by blocked tiles.
    const solid = movement.grid.solid as boolean[][];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) solid[40 + dy]![60 + dx] = true;

    const goal = positionForBodyTile({ tx: 60, ty: 40 });
    arena.doubleClick(goal.x, goal.y);
    arena.walk(200);

    expect(movement.autoWalk).toBeUndefined();
    expect(player.seatFacing).not.toBeNull();
    expect({ x: player.x, y: player.y }).toEqual(start);
  });

  it('a click on a reachable tile stands a seated player up and walks (R4)', async () => {
    const arena = await movementArena();
    const { player, movement } = arena;
    sitOnFirstChair(arena);
    const goal = { x: player.x + 320, y: player.y };

    arena.doubleClick(goal.x, goal.y);

    expect(player.seatFacing).toBeNull();
    expect(movement.autoWalk?.goal).toEqual(goal);
    walkUntilDone(arena);
    expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
  });

  it('the goal is validated on its body tile: a click whose position tile is free but whose body tile is blocked does nothing', async () => {
    const arena = await movementArena();
    const { movement } = arena;
    // The body center crosses the blocked row boundary before the position.
    const edge = TILE - BODY_CENTER_OFFSET.y;
    arena.doubleClick(1000, edge - 0.01);
    expect(movement.autoWalk).toBeUndefined();
    arena.doubleClick(1000, edge);
    expect(movement.autoWalk?.goal).toEqual({ x: 1000, y: edge });
  });

  it('walkToPeer detours a wall and lands on the same approach tile as before (R6)', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const { player, movement, bridge } = arena;
    wallColumn(movement, 20, 3, 16);
    const peerTx = 30;
    const peerTy = 9;
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerTx * TILE + 16, y: peerTy * TILE + 16 }));

    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    expect(movement.autoWalk?.goal).toEqual({ x: (peerTx - 1) * TILE + 16, y: peerTy * TILE + 16 });
    const path = walkUntilDone(arena);

    expect(movement.autoWalk).toBeUndefined();
    expect(Math.floor(player.x / TILE)).toBe(peerTx - 1);
    expect(Math.floor(player.y / TILE)).toBe(peerTy);
    expect(path.minY < 96 || path.maxY > 544).toBe(true);
  });

  it('walkToPeer with no path to the approach tile keeps a seated player seated (R6)', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const { player, movement, bridge } = arena;
    // A wall over the whole height cuts the map: the peer is on the other side.
    wallColumn(movement, SEAT.tx + 3, 0, 99);
    bridge.emitCommand('toggleSeat', undefined);
    arena.body.reset((SEAT.tx + 0.5) * TILE, (SEAT.ty + 0.5) * TILE - 18);
    bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(0));
    expect(player.seatFacing).not.toBeNull();
    const start = { x: player.x, y: player.y };
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: (SEAT.tx + 12) * TILE + 16, y: SEAT.ty * TILE + 16 }));

    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    arena.walk(200);

    expect(movement.autoWalk).toBeUndefined();
    expect(connector.stands()).toBe(0);
    expect(player.seatFacing).not.toBeNull();
    expect({ x: player.x, y: player.y }).toEqual(start);
  });
});

describe('double click to walk (double-click-pathfinding, R1 and R2)', () => {
  type Arena = Awaited<ReturnType<typeof movementArena>>;
  const goal = { x: 1000, y: 300 };

  /** A first click lands, then something happens that must clear it, then a second one: nothing may walk. */
  function expectNoPair(arena: Arena, between: () => void) {
    arena.click(goal.x, goal.y);
    between();
    arena.click(goal.x, goal.y);
    expect(arena.movement.autoWalk).toBeUndefined();
  }

  it('a single click does not walk but still closes the context menu (R1)', async () => {
    const arena = await movementArena();
    const closed = vi.fn();
    arena.bridge.on('closemenu', closed);

    arena.click(goal.x, goal.y);
    arena.walk(200);

    expect(arena.movement.autoWalk).toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('two clicks within the window walk toward the second click\'s world point (R1)', async () => {
    const arena = await movementArena();

    arena.doubleClick(goal.x, goal.y, { gapMs: 120, screenDx: 3, worldDx: 40 });

    expect(arena.movement.autoWalk?.goal).toEqual({ x: goal.x + 40, y: goal.y });
  });

  it.each([
    { gapMs: 300, walks: true },
    { gapMs: 301, walks: false },
    { gapMs: 1000, walks: false },
  ])('a second click $gapMs ms later walks: $walks', async ({ gapMs, walks }) => {
    const arena = await movementArena();

    arena.doubleClick(goal.x, goal.y, { gapMs });

    expect(arena.movement.autoWalk?.goal).toEqual(walks ? goal : undefined);
  });

  it.each([
    { screenDx: 8, walks: true },
    { screenDx: 9, walks: false },
    { screenDx: -9, walks: false },
  ])('a second click $screenDx screen px away walks: $walks', async ({ screenDx, walks }) => {
    const arena = await movementArena();

    arena.doubleClick(goal.x, goal.y, { screenDx });

    expect(arena.movement.autoWalk?.goal).toEqual(walks ? goal : undefined);
  });

  it('a slow second click counts as a first click: a quick third one then walks (R1)', async () => {
    const arena = await movementArena();

    arena.doubleClick(goal.x, goal.y, { gapMs: 400 });
    expect(arena.movement.autoWalk).toBeUndefined();
    arena.wait(100);
    arena.click(goal.x + 20, goal.y);

    expect(arena.movement.autoWalk?.goal).toEqual({ x: goal.x + 20, y: goal.y });
  });

  it('a third click after a double click does not chain, and starts a new pair (R1)', async () => {
    const arena = await movementArena();
    const { movement } = arena;
    arena.doubleClick(goal.x, goal.y);
    const walking = movement.autoWalk;
    expect(walking?.goal).toEqual(goal);

    arena.wait(60);
    arena.click(goal.x, goal.y + 80);
    expect(movement.autoWalk?.goal, 'the third click must not redirect the walk').toEqual(goal);

    arena.wait(60);
    arena.click(goal.x, goal.y + 80);
    expect(movement.autoWalk?.goal, 'the third and fourth clicks are a new pair').toEqual({ x: goal.x, y: goal.y + 80 });
  });

  it('a drag between the clicks clears the pair (R2)', async () => {
    const arena = await movementArena();

    arena.doubleClick(goal.x, goal.y, { distance: 20 });
    expect(arena.movement.autoWalk).toBeUndefined();
    // The drag counted as no first click: this one starts over and needs a partner.
    arena.click(goal.x, goal.y);

    expect(arena.movement.autoWalk).toBeUndefined();
  });

  it('a click on a game object clears the pair (R2)', async () => {
    const arena = await movementArena();
    const object = arena.scene.add.rectangle(0, 0, 1, 1);

    expectNoPair(arena, () => arena.click(goal.x, goal.y, 0, [object]));
  });

  it('a click on the minimap clears the pair (R2)', async () => {
    const arena = await movementArena();
    const minimap = arena.scene.cameras.cameras[1];

    expectNoPair(arena, () => {
      const pointer = { button: 0, camera: minimap, x: 10, y: 10, getDistance: () => 0 };
      arena.scene.input.emit('pointerdown', pointer, []);
      arena.scene.input.emit('pointerup', pointer, []);
    });
  });

  it('a non-primary button click clears the pair (R2)', async () => {
    const arena = await movementArena();

    expectNoPair(arena, () => {
      const pointer = { button: 2, camera: arena.scene.cameras.main, x: 10, y: 10,
        worldX: goal.x, worldY: goal.y, getDistance: () => 0 };
      arena.scene.input.emit('pointerdown', pointer, []);
      arena.scene.input.emit('pointerup', pointer, []);
    });
  });

  it('a release outside the canvas clears the pair (R2)', async () => {
    const arena = await movementArena();

    expectNoPair(arena, () => {
      const pointer = { button: 0, camera: arena.scene.cameras.main, x: 10, y: 10,
        worldX: goal.x, worldY: goal.y, getDistance: () => 0 };
      arena.scene.input.emit('pointerdown', pointer, []);
      arena.scene.input.emit('pointerupoutside', pointer);
    });
  });

  it('a press that turns into a pan on the move clears the pair even if it returns to its origin (R2)', async () => {
    const arena = await movementArena();
    let distance = 0;

    expectNoPair(arena, () => {
      const pointer = { button: 0, camera: arena.scene.cameras.main, x: 10, y: 10,
        worldX: goal.x, worldY: goal.y, getDistance: () => distance };
      arena.scene.input.emit('pointerdown', pointer, []);
      distance = 20;
      arena.scene.input.emit('pointermove', pointer);
      distance = 0;
      arena.scene.input.emit('pointerup', pointer, []);
    });
  });

  it('layout editing never walks and clears the pair (R2)', async () => {
    const arena = await movementArena();

    arena.click(goal.x, goal.y);
    arena.bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    arena.doubleClick(goal.x, goal.y);
    expect(arena.movement.autoWalk).toBeUndefined();

    arena.bridge.emitCommand('layoutedit', null);
    arena.click(goal.x, goal.y);
    expect(arena.movement.autoWalk, 'the click made while editing was not a first click').toBeUndefined();
  });

  it('a local position that is not ready never walks and clears the pair (R2)', async () => {
    const arena = await movementArena();
    const state = arena.scene as unknown as { localPositionReady: boolean };

    arena.click(goal.x, goal.y);
    state.localPositionReady = false;
    arena.doubleClick(goal.x, goal.y);
    expect(arena.movement.autoWalk).toBeUndefined();

    state.localPositionReady = true;
    arena.click(goal.x, goal.y);
    expect(arena.movement.autoWalk).toBeUndefined();
  });

  it('a walk reset between the clicks (tab hidden) clears the pair', async () => {
    const arena = await movementArena();

    expectNoPair(arena, () => arena.scene.game.events.emit(Phaser.Core.Events.HIDDEN));
  });

  it('non-finite world coordinates never walk and clear the pair (R2)', async () => {
    const arena = await movementArena();

    expectNoPair(arena, () => arena.click(Number.NaN, goal.y));
  });
});

afterEach(() => {
  for (const game of games.splice(0)) {
    game.destroy(true);
    // destroy() is deferred to the next frame; deterministic arenas stop RAF.
    if (!game.loop.running) game.step(0, 0);
  }
  for (const host of hosts.splice(0)) host.remove();
});

/**
 * Margen unico para toda espera que dependa del bucle de Phaser. En el runner
 * de CI el hilo principal se atasca segundos enteros: una prueba con 2000ms de
 * margen tardo 8263ms de reloj de pared alli y fallo sin que la escena hubiese
 * hecho nada mal. El margen se fija holgado a proposito -- lo que decide la
 * prueba es la condicion, no el cronometro.
 */
const LOOP_WAIT = { timeout: 20000, interval: 50 } as const;

/**
 * Espera avanzando el RELOJ DEL JUEGO, que solo corre cuando corren los frames.
 * Un `setTimeout` real puede vencer sin que la escena haya dado un solo tick de
 * proximidad (250ms de reloj de juego), y entonces la prueba mide la velocidad
 * del runner en vez de la regla que dice medir.
 */
async function advanceGameClock(scene: Phaser.Scene, ms: number): Promise<void> {
  const target = scene.time.now + ms;
  await vi.waitFor(() => {
    expect(scene.time.now).toBeGreaterThanOrEqual(target);
  }, LOOP_WAIT);
}

async function bootOfficeScene(
  bridge = createOfficeBridge(),
  options: OfficeSceneOptions = {},
): Promise<{
  scene: Phaser.Scene;
  bridge: ReturnType<typeof createOfficeBridge>;
}> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    // The scene has no game sounds; visibility regressions must not enqueue
    // suspend/resume promises on AudioContexts that teardown then closes.
    audio: { noAudio: true },
    physics: { default: 'arcade' },
    scene: [new OfficeScene(bridge, { layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, fallbackSpaces: { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION }, ...options })],
  });
  games.push(game);

  await waitForSceneRunning(game, OFFICE_SCENE_KEY);

  return { scene: game.scene.getScene(OFFICE_SCENE_KEY) as Phaser.Scene, bridge };
}

/**
 * Desde #59 tanto el jugador como los peers remotos tienen cuerpo fisico:
 * `body !== null` dejo de distinguirlos. Lo que sigue distinguiendolos es
 * `moves` -- el cuerpo del jugador se mueve por velocidad (D-diseno,
 * `spawnPlayer`); el de un peer es `enablePeerBody` (`moves=false`, el tween
 * es la unica fuente de verdad de su posicion). Se busca asi y no por el
 * nombre porque el nombre es justo lo que varias pruebas miden (#6): atarlo
 * aqui haria que el helper dejase de encontrarlo en cuanto la sesion traiga
 * otro.
 */
function findPlayer(scene: Phaser.Scene): CharacterContainer {
  const player = scene.children.list.find(
    (c): c is CharacterContainer =>
      c.type === 'Container' &&
      c.body !== null &&
      (c.body as Phaser.Physics.Arcade.Body).moves !== false,
  );
  if (!player) throw new Error('player container not found in scene');
  return player;
}

/** Codigos de tecla legacy (`keyCode`), que es lo que Phaser's Key matching usa internamente. */
const KEY = { RIGHT: 39, LEFT: 37, DOWN: 40, D: 68, E: 69 } as const;

function dispatchKey(type: 'keydown' | 'keyup', keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true } as KeyboardEventInit);
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  window.dispatchEvent(event);
  return event;
}

describe('OfficeScene: identidad y construccion (D2/D5)', () => {
  it('se registra con la clave "office", no "boot"', () => {
    expect(OFFICE_SCENE_KEY).toBe('office');
    expect(new OfficeScene(createOfficeBridge()).sys.settings.key).toBe(OFFICE_SCENE_KEY);
  });

  it('el constructor acepta una instancia de OfficeBridge sin lanzar', () => {
    const bridge = createOfficeBridge();

    expect(() => new OfficeScene(bridge)).not.toThrow();
  });
});

describe('office entry art readiness', () => {
  it('waits for the replicated local character, not just a successful join', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await advanceGameClock(scene, 50);
    expect(entry).not.toHaveBeenCalled();
    connector.handlers()!.onLocalAvatar?.('character-p02-beige-blazer');
    expect(entry).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'ready' }), LOOP_WAIT);
    expect(findPlayer(scene).sprite.texture.key).toBe(artSheetKey('character-p02-beige-blazer', 'walk'));
  });

  it.each([false, true])('settles dynamic floor, desk and decor art before revealing (broken: %s)', async (broken) => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const { scene } = await bootOfficeScene(bridge, { endpoint: null, waitForOfficeData: true });
    const art = (scene as unknown as { art: ArtPackLoader }).art;
    const manifest = art.manifest!;
    const aliases = ['floor-plain', 'desk-wood', 'plant-ficus'].map((id) => {
      const piece = manifest.pieces.find((piece) => piece.id === id)!;
      return { ...piece, id: `${id}-entry`, files: piece.files.map((file) => ({ ...file,
        path: broken ? 'entry-missing.png' : file.path })) };
    });
    art.adoptManifest({ ...manifest, pieces: [...manifest.pieces, ...aliases] });
    bridge.emitCommand('spacesconfig', { spaces: [{ ...BUILT_IN_SPACES[0]!, floor: { materialId: 'floor-plain-entry', color: null } }], version: 'entry' });
    bridge.emitCommand('desks', { desks: [{ id: 'entry', label: 'Entry', x: 320, y: 320, w: 96, h: 96, mine: false,
      appearance: { materialId: 'desk-wood-entry', color: null },
      occupant: { id: 'occupant', displayName: 'Occupant', items: [{ id: 'entry-plant', slot: 4, rotation: 0,
        aboveAvatars: false, textureKey: artSheetKey('plant-ficus-entry', 'sheet') }] } }] });
    expect(entry).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: broken ? 'failed' : 'ready' }), LOOP_WAIT);
    if (!broken) {
      for (const alias of aliases) expect(art.status(alias.id)).toBe('ready');
      const item = scene.children.getByName('desk-item:entry-plant') as Phaser.GameObjects.Image;
      expect(item.texture.key).toBe(artSheetKey('plant-ficus-entry', 'sheet'));
    }
  });

  it('never reveals after a denied join and removes its render listener when stopped', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake',
      connect: async () => { throw new OfficeAccessDeniedError('not-provisioned'); } });
    await advanceGameClock(scene, 100);
    expect(entry).not.toHaveBeenCalled();
    scene.scene.stop();
    await vi.waitFor(() => expect(scene.game.events.listenerCount(Phaser.Core.Events.POST_RENDER)).toBe(0), LOOP_WAIT);
    bridge.emitCommand('desks', { desks: [] });
    expect(entry).not.toHaveBeenCalled();
  });

  it('constructs the local body from current sheets rather than a procedural startup sprite', async () => {
    const sprite = vi.spyOn(Phaser.GameObjects.GameObjectFactory.prototype, 'sprite');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: null });
    expect(sprite.mock.calls.some((call) => String(call[2]).startsWith('avP-'))).toBe(false);
    expect(findPlayer(scene).sheets).not.toBeNull();
    sprite.mockRestore();
  });
  it('waits for initial served data and current character, then reports after rendering only once', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    const { scene } = await bootOfficeScene(bridge, { endpoint: null, waitForOfficeData: true });
    expect(entry).not.toHaveBeenCalled();
    bridge.emitCommand('spacesconfig', { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION });
    expect(entry).not.toHaveBeenCalled();
    bridge.emitCommand('desks', { desks: [] });
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'ready' }), LOOP_WAIT);
    expect(findPlayer(scene).sprite.texture.key).toMatch(/^art:character-/);
    expect(scene.textures.exists(artSheetKey('tileset-terrain', 'sheet'))).toBe(true);
    await advanceGameClock(scene, 100);
    expect(entry).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable art as a failure, never a ready legacy office', async () => {
    const bridge = createOfficeBridge();
    const entry = vi.fn();
    bridge.on('entry', entry);
    await bootOfficeScene(bridge, { endpoint: null, artManifestUrl: null });
    await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'failed' }), LOOP_WAIT);
    expect(entry).not.toHaveBeenCalledWith({ state: 'ready' });
  });

  it('fails entry if a required static sheet downloads HTML instead of PNG', async () => {
    const originalPreload = ArtPackLoader.prototype.preload;
    const restore: (() => void)[] = [];
    const preload = vi.spyOn(ArtPackLoader.prototype, 'preload').mockImplementation(function (this: ArtPackLoader) {
      // Phaser installs file-type methods on each loader instance, not its prototype.
      const load = (this as unknown as { scene: Phaser.Scene }).scene.load;
      const original = load.spritesheet;
      const sheet = vi.spyOn(load, 'spritesheet').mockImplementation(function (this: Phaser.Loader.LoaderPlugin, key, url, config, xhr) {
        return original.call(this, key, key === artSheetKey('tileset-terrain', 'sheet') ? 'assets/pack/entry-missing.png' : url, config, xhr);
      });
      restore.push(() => sheet.mockRestore());
      originalPreload.call(this);
    });
    try {
      const bridge = createOfficeBridge();
      const entry = vi.fn();
      bridge.on('entry', entry);
      await bootOfficeScene(bridge, { endpoint: null });
      await vi.waitFor(() => expect(entry).toHaveBeenCalledWith({ state: 'failed' }), LOOP_WAIT);
      expect(entry).not.toHaveBeenCalledWith({ state: 'ready' });
    } finally {
      for (const restoreSheet of restore) restoreSheet();
      preload.mockRestore();
    }
  });
});

describe('OfficeScene dentro de un Phaser.Game real: mapa y jugador', () => {
  it('draws the Tiled layout in create(): terrain tilemap, walls, props and zone labels from the pack', async () => {
    const { scene } = await bootOfficeScene();

    const images = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image => c.type === 'Image',
    );
    const texts = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Text => c.type === 'Text',
    );
    const ofPiece = (kind: string) => BASE_LAYOUT.props.filter((prop) => prop.kind === kind).length;

    // Art step 8: the floor is tilemap layers, not one image per tile.
    expect(scene.children.list.filter((c) => c.type === 'TilemapLayer')).toHaveLength(TERRAIN_LAYER_COUNT + 1);
    expect(images.filter((img) => img.texture.key === artSheetKey('desk-wood', 'sheet'))).toHaveLength(ofPiece('desk'));
    expect(images.filter((img) => img.texture.key.startsWith('art:tree-'))).toHaveLength(ofPiece('tree'));
    expect(images.filter((img) => img.texture.key.startsWith('art:table-'))).toHaveLength(ofPiece('table'));
    expect(images.filter((img) => img.texture.key.startsWith('art:wall-')).length).toBeGreaterThan(0);
    // The Kenney placeholder art is gone from the map.
    expect(scene.children.list.filter((c) => c.type === 'TileSprite')).toHaveLength(0);
    expect(texts).toHaveLength(ZONE_LABELS.length);
  });

  it('without the art pack it still draws the whole map, from its fallbacks', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { artManifestUrl: 'assets/pack/missing.json' });

    expect(scene.children.list.filter((c) => c.type === 'TilemapLayer')).toHaveLength(1);
    const placeholders = scene.children.list.filter((c) => c.type === 'Rectangle').length;
    expect(placeholders).toBeGreaterThanOrEqual(BASE_LAYOUT.props.length);
  });

  it('crea al jugador local y a nadie mas: la oficina arranca vacia de companeros', async () => {
    const { scene } = await bootOfficeScene();

    const containers = scene.children.list.filter((c) => c.type === 'Container');
    expect(containers).toHaveLength(1);
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });
});

describe('OfficeScene: input y movimiento del jugador (app.js:488-497)', () => {
  it('la flecha derecha mueve al jugador inactivo hacia la derecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      });
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('la tecla D (WASD) mueve al jugador hacia la derecha, igual que la flecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.D);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      });
    } finally {
      dispatchKey('keyup', KEY.D);
    }
  });

  it('#104: con el foco en un input de texto, WASD no mueve al jugador (queda para escribir)', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    try {
      dispatchKey('keydown', KEY.D);
      try {
        // No hay una condicion positiva que esperar (el punto es que NADA
        // pase): se le da tiempo real al loop de Phaser para correr varios
        // frames y luego se comprueba que el jugador no se movio ni una vez.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(player.x).toBe(startX);
      } finally {
        dispatchKey('keyup', KEY.D);
      }
    } finally {
      input.remove();
    }
  });

  it('#104: con el foco en un input de texto, WASD no le hace preventDefault al evento (la letra SI llega al campo)', async () => {
    // Reproduccion del bug real reportado tras cerrar #104: el bloqueo del
    // AVATAR (arriba) no prueba que la letra se pueda escribir. Phaser's
    // `KeyboardManager` llama a `event.preventDefault()` para cualquier
    // keyCode en captura (`addKeys('W,A,S,D')` captura por defecto) SIN mirar
    // `document.activeElement`, asi que el navegador nunca inserta el
    // caracter en el campo aunque el juego ya ignore el movimiento.
    await bootOfficeScene();

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    try {
      const event = dispatchKey('keydown', KEY.D);
      try {
        expect(event.defaultPrevented).toBe(false);
      } finally {
        dispatchKey('keyup', KEY.D);
      }
    } finally {
      input.remove();
    }
  });

  it('sin foco en un input, WASD sigue haciendo preventDefault (el juego conserva la captura global)', async () => {
    await bootOfficeScene();

    const event = dispatchKey('keydown', KEY.D);
    try {
      expect(event.defaultPrevented).toBe(true);
    } finally {
      dispatchKey('keyup', KEY.D);
    }
  });
});

describe('OfficeScene: colisiones (app.js: colisionador fusionado, D6)', () => {
  it('el jugador no atraviesa el seto solido del borde del mapa', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // A una tile del seto izquierdo (x=0, solido): intenta seguir hacia la izquierda.
    player.setPosition(1 * TILE + 16, 5 * TILE + 16);
    const startX = player.x;

    dispatchKey('keydown', KEY.LEFT);
    await new Promise((resolve) => setTimeout(resolve, 250));
    dispatchKey('keyup', KEY.LEFT);

    // El colisionador detiene al jugador antes de entrar a la tile solida (x=0).
    expect(player.x).toBeGreaterThanOrEqual(0 * TILE + TILE / 2);
    expect(player.x).toBeLessThanOrEqual(startX);
  });

  it('el jugador cruza un tile de puente sobre el rio', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // Al norte de uno de los dos puentes (x=13..15, y=19..21): cruza hacia el sur.
    player.setPosition(14 * TILE + 16, 18 * TILE + 16);
    const startY = player.y;

    dispatchKey('keydown', KEY.DOWN);
    try {
      await vi.waitFor(
        () => {
          expect(player.y).toBeGreaterThan(startY);
        },
        { timeout: 2000 },
      );
    } finally {
      dispatchKey('keyup', KEY.DOWN);
    }
  });
});

/**
 * Avatars still y-sort AMONG THEMSELVES inside the avatar band (#70): two
 * overlapping avatars must read right. That they cover every normal asset is
 * pinned by the render layers describe below.
 */
describe('OfficeScene: depth-sorting por y (app.js:497-499)', () => {
  it('el contenedor con mayor y queda por delante del de menor y tras update()', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    const remote = findRemoteAvatars(scene)[0];

    // Se mueve al jugador SIN tocar su `depth`: quien reordena es `update()`,
    // y no la profundidad que cada contenedor recibio al crearse.
    player.setPosition(player.x, remote.y - 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeLessThan(remote.depth);
    }, LOOP_WAIT);

    player.setPosition(player.x, remote.y + 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(remote.depth);
    }, LOOP_WAIT);
  });
});

describe('OfficeScene: proximidad y salas (app.js:444-471, cada 250ms)', () => {
  it('emite "room" al entrar a una sala', async () => {
    const bridge = createOfficeBridge();
    const rooms: (string | null)[] = [];
    bridge.on('room', (payload) => rooms.push(payload.name));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms).toContain('Sala de Juntas');
    }, LOOP_WAIT);
  });

  it('el "room" emitido trae el id estable del espacio, no solo el nombre (#7, D2)', async () => {
    const bridge = createOfficeBridge();
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms.some((r) => r.name === 'Sala de Juntas')).toBe(true);
    }, LOOP_WAIT);
    const match = rooms.find((r) => r.name === 'Sala de Juntas');
    expect(match?.spaceId).toBe(BUILT_IN_SPACES[0].id);
  });
});

describe('OfficeScene: audio/video por proximidad (D3, issue #17)', () => {
  it('emite "voice" con los peers reales audibles (sessionId + nombre), sin repetir en tics identicos', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    const countAfterFirstNotification = voices.length;
    // Sin mover a nadie, los proximos tics (250ms cada uno) no deben repetir la
    // notificacion; la ventana se cuenta en reloj de juego, no de pared.
    await advanceGameClock(scene, 600);
    expect(voices.length).toBe(countAfterFirstNotification);
  });

  it('un cruce de sala reemite "voice" aunque el conjunto de pares audibles no cambie', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    // Un par lejano que nunca entra por radio ni por sala en ningun lado del cruce.
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'lejano', x: 5000, y: 5000 }));

    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    const countBeforeCrossing = voices.length;

    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(voices.at(-1)?.spaceId).toBe(BUILT_IN_SPACES[0].id);
    }, LOOP_WAIT);
    expect(voices.length).toBeGreaterThan(countBeforeCrossing);
    // El conjunto audible sigue vacio: la clave de dedupe cambio solo por la sala.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it(
    'D7 asimetria: un par fuera de la sala del jugador queda fuera de "voice" mientras un par ' +
      'DENTRO de la sala si aparece, con su nombre',
    async () => {
      const bridge = createOfficeBridge();
      const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
      bridge.on('voice', (payload) => voices.push(payload));
      const connector = fakeConnector('mi-sesion');

      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Jugador dentro de "Sala de Juntas" (tile (50,2) tamano 13x14 -> dentro en (52,4)).
      player.setPosition(52 * TILE, 4 * TILE);
      // Par legitimo: comparte la misma sala que el jugador -> audible.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'companera-en-sala',
          name: 'Compañera De Sala',
          x: 52 * TILE,
          y: 4 * TILE,
        }),
      );
      // Par excluido: un pixel al oeste del limite de la sala, dentro del radio pero fuera de ella.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'vecina-de-puerta',
          name: 'Vecina De Puerta',
          x: 50 * TILE - 1,
          y: 4 * TILE,
        }),
      );

      await vi.waitFor(() => {
        expect(
          voices.some((v) =>
            v.peers.some((peer) => peer.sessionId === 'companera-en-sala' && peer.name === 'Compañera De Sala'),
          ),
        ).toBe(true);
      }, LOOP_WAIT);

      expect(
        voices.some((v) => v.peers.some((peer) => peer.sessionId === 'vecina-de-puerta')),
      ).toBe(false);
    },
  );
});

/**
 * Doble de conexion: captura los handlers que la escena registra para poder
 * simular altas, cambios y bajas remotas sin levantar un Colyseus. El
 * protocolo real ya se prueba contra un servidor de verdad en la capa node
 * (`officeRoomClient.node.test.ts`); lo que se prueba aqui es el cableado.
 */
function fakeConnector(sessionId = 'yo', initialState = true) {
  const sent: { x: number; y: number; facing: string }[] = [];
  const statuses: PresenceStatus[] = [];
  // Issue #2, unit 12: ahora si se registran -- antes eran no-ops porque
  // ninguna unit emitia comandos de llamada todavia.
  const calls: string[] = [];
  const respondedCalls: { from: string; accept: boolean }[] = [];
  const sentSpacesVersions: string[] = [];
  const sits: string[] = [];
  let stands = 0;
  let captured: OfficeRoomHandlers | undefined;
  let joinedWith: PresenceStatus | undefined;
  let joinedName: string | undefined;
  let joinedSpacesVersion: string | undefined;
  let left = false;
  // Issue #52: el comando `reconnect` se prueba contando entradas, no
  // inspeccionando la conexion -- lo que tiene que pasar es que la escena
  // vuelva a entrar, no como quede por dentro el doble.
  let connectCount = 0;

  const connection: OfficeConnection = {
    sessionId,
    sendMove: (x, y, facing) => sent.push({ x, y, facing }),
    sendStatus: (status) => statuses.push(status),
    sendSpacesVersion: (version) => sentSpacesVersions.push(version),
    sendCall: (to) => calls.push(to),
    sendCallRespond: (from, accept) => respondedCalls.push({ from, accept }),
    sendSit: (seat) => sits.push(seat),
    sendStand: () => {
      stands++;
    },
    leave: async () => {
      left = true;
    },
  };

  return {
    sent,
    statuses,
    calls,
    respondedCalls,
    sentSpacesVersions,
    sits,
    stands: () => stands,
    handlers: () => captured,
    joinedWith: () => joinedWith,
    joinedName: () => joinedName,
    joinedSpacesVersion: () => joinedSpacesVersion,
    hasLeft: () => left,
    connectCount: () => connectCount,
    connect: async (options: ConnectOfficeRoomOptions) => {
      connectCount++;
      captured = options.handlers;
      joinedWith = options.status;
      joinedName = options.name;
      joinedSpacesVersion = options.spacesVersion;
      if (initialState) options.handlers.onLocalPosition?.(remoteSnapshot({
        sessionId, x: PLAYER_SPAWN_TX * TILE + 16, y: PLAYER_SPAWN_TY * TILE + 16,
      }));
      return connection;
    },
  };
}

function remoteSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'remota-1',
    name: 'Ana Remota',
    x: 500,
    y: 600,
    status: 'g',
    facing: 'down',
    spacesVersion: BUILT_IN_SPACES_VERSION,
    avatarId: null,
    seat: null,
    ...overrides,
  } as Parameters<OfficeRoomHandlers['onAdd']>[0];
}

function findRemoteAvatars(scene: Phaser.Scene): CharacterContainer[] {
  // Complemento exacto de `findPlayer` (ver su comentario, #59): un peer
  // remoto o no tiene cuerpo (sin `peerGroup`, no deberia pasar en
  // produccion) o lo tiene con `moves=false`.
  return scene.children.list.filter(
    (c): c is CharacterContainer =>
      c.type === 'Container' &&
      (c.body === null || (c.body as Phaser.Physics.Arcade.Body).moves === false),
  );
}

describe('OfficeScene: authoritative initial position (#148)', () => {
  it('keeps the latest authoritative reset while initial connection completion is delayed', async () => {
    const connector = fakeConnector('yo', false);
    let finish!: () => void;
    const bridge = createOfficeBridge();
    const voices = vi.fn();
    bridge.on('voice', voices);
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => connector.connect(options).then((connection) => new Promise((resolve) => { finish = () => resolve(connection); })),
    });
    await vi.waitFor(() => expect(finish).toBeDefined(), LOOP_WAIT);
    const handlers = connector.handlers()!;
    const latest = remoteSnapshot({ sessionId: 'yo', x: 67 * TILE + 16, y: 49 * TILE + 16, positionRevision: 2 });
    handlers.onPositionReset?.(remoteSnapshot({ ...latest, x: latest.x - TILE, positionRevision: 1 }));
    handlers.onPositionReset?.(latest);
    handlers.onLocalPosition?.(remoteSnapshot({ sessionId: 'yo', x: 300, y: 400 }));
    finish();
    await vi.waitFor(() => expect(findPlayer(scene).x).toBe(latest.x), LOOP_WAIT);
    expect(findPlayer(scene).y).toBe(latest.y);
    expect(voices).toHaveBeenCalled();
  });

  it('publishes a served spaces version that arrives while the initial join is in flight', async () => {
    const connector = fakeConnector();
    let finish!: () => void;
    const { bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => connector.connect(options).then((connection) => new Promise((resolve) => { finish = () => resolve(connection); })),
    });
    await vi.waitFor(() => expect(finish).toBeDefined(), LOOP_WAIT);
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'served-while-joining' });
    expect(connector.sentSpacesVersions).toEqual([]);
    finish();
    await vi.waitFor(() => expect(connector.sentSpacesVersions).toEqual(['served-while-joining']), LOOP_WAIT);
  });
  const restored = () => remoteSnapshot({ sessionId: 'yo', x: 300.5, y: 400.25, facing: 'left' });
  async function boot() {
    const connector = fakeConnector('yo', false);
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', connect: connector.connect, artManifestUrl: null, artUploadsUrl: null,
    });
    scene.game.loop.stop();
    const player = findPlayer(scene);
    const body = player.body as Phaser.Physics.Arcade.Body;
    const movement = scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys; autoWalk?: AutoWalkState };
    let time = scene.time.now;
    const frame = () => scene.game.step(time += 20, 20);
    return { scene, bridge, connector, player, body, movement, frame };
  }

  it('reveals current art only after the authoritative position is rendered (#157)', async () => {
    const connector = fakeConnector('yo', false);
    const bridge = createOfficeBridge();
    const revealed: { x: number; y: number }[] = [];
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake', connect: connector.connect, waitForOfficeData: true, artUploadsUrl: null,
    });
    const player = findPlayer(scene);
    bridge.on('entry', ({ state }) => { if (state === 'ready') revealed.push({ x: player.x, y: player.y }); });
    bridge.emitCommand('spacesconfig', { spaces: BUILT_IN_SPACES, version: BUILT_IN_SPACES_VERSION });
    bridge.emitCommand('desks', { desks: [] });
    connector.handlers()!.onLocalAvatar?.('character-p02-beige-blazer');
    await vi.waitFor(() => expect(player.sprite.texture.key).toBe(artSheetKey('character-p02-beige-blazer', 'walk')), LOOP_WAIT);
    await advanceGameClock(scene, 50);
    expect(revealed).toEqual([]);
    expect(connector.sent).toEqual([]);
    connector.handlers()!.onLocalPosition?.(restored());
    await vi.waitFor(() => expect(revealed).toEqual([{ x: 300.5, y: 400.25 }]), LOOP_WAIT);
    expect(connector.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
  });

  it('waits for delayed own state, resets the real body and camera, then publishes from the restored point', async () => {
    const { scene, bridge, connector, player, body, movement, frame } = await boot();
    const spawn = { x: player.x, y: player.y };
    movement.cursors.right.isDown = true;
    bridge.emitCommand('toggleSeat', undefined);
    frame();
    expect({ x: player.x, y: player.y }).toEqual(spawn);
    expect(connector.sent).toEqual([]);
    movement.cursors.right.isDown = false;
    connector.handlers()!.onAdd(remoteSnapshot()); // A peer is not initialization.
    bridge.emitCommand('walkToPeer', { sessionId: 'remota-1' });
    const pointer = { button: 0, camera: scene.cameras.main, x: 10, y: 10,
      worldX: 300, worldY: 400, getDistance: () => 0 };
    scene.input.emit('pointerdown', pointer, []);
    scene.input.emit('pointerup', pointer, []);
    expect(movement.autoWalk).toBeUndefined();
    frame();
    expect(connector.sent).toEqual([]);
    connector.handlers()!.onLocalPosition?.(restored());
    expect({ x: player.x, y: player.y }).toEqual({ x: 300.5, y: 400.25 });
    expect({ x: body.x, y: body.y }).toEqual({ x: physicalBodyRect(player).x, y: physicalBodyRect(player).y });
    expect(body.velocity.length()).toBe(0);
    expect(player.facing).toBe('left');
    expect(scene.cameras.main.scrollX).toBeCloseTo(player.x - scene.cameras.main.width / 2);
    frame();
    expect(connector.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
    movement.cursors.right.isDown = true;
    frame();
    expect(player.x).toBeGreaterThan(300.5);
    expect(player.x).toBeLessThan(310);
    const moved = player.x;
    connector.handlers()!.onLocalPosition?.(restored());
    connector.handlers()!.onChange(restored());
    expect(player.x).toBe(moved);
  });

  it('reinitializes a manual join and ignores delayed callbacks from the previous join', async () => {
    const { scene, bridge, connector, player, movement, frame } = await boot();
    const old = connector.handlers()!;
    old.onLocalPosition?.(restored());
    movement.cursors.right.isDown = true;
    frame();
    scene.input.emit('pointerdown', { button: 0, camera: scene.cameras.cameras[1], x: 5, y: 5 }, []);
    bridge.emitCommand('reconnect', undefined);
    await vi.waitFor(() => expect(connector.connectCount()).toBe(2));
    const before = connector.sent.length;
    frame();
    expect(connector.sent).toHaveLength(before);
    old.onLocalPosition?.(remoteSnapshot({ x: 900, y: 900 }));
    old.onConnectionState?.('offline');
    connector.handlers()!.onLocalPosition?.(restored());
    expect(player.x).toBe(300.5);
    frame();
    expect(player.x).toBeGreaterThan(300.5);
    expect(scene.cameras.main.scrollX).toBeCloseTo(player.x - scene.cameras.main.width / 2, -1);
  });

  it('leaves an older in-flight join when a newer manual join wins', async () => {
    const first = fakeConnector('old', false);
    const next = fakeConnector('new', false);
    let finishFirst!: () => void;
    let joiningFirst = true;
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: (options) => {
        if (!joiningFirst) return next.connect(options);
        joiningFirst = false;
        return first.connect(options).then((connection) => new Promise((resolve) => {
          finishFirst = () => resolve(connection);
        }));
      },
    });
    scene.game.loop.stop();
    bridge.emitCommand('reconnect', undefined);
    await vi.waitFor(() => expect(next.handlers()).toBeDefined());
    next.handlers()!.onLocalPosition?.(restored());
    first.handlers()!.onLocalPosition?.(remoteSnapshot({ x: 900, y: 900 }));
    finishFirst();
    await vi.waitFor(() => expect(first.hasLeft()).toBe(true));
    scene.game.step(scene.time.now + 20, 20);
    expect(findPlayer(scene).x).toBe(300.5);
    expect(first.sent).toEqual([]);
    expect(next.sent[0]).toEqual({ x: 300.5, y: 400.25, facing: 'left' });
  });

  it('waits through automatic reconnect and restores a confirmed seat without an unsolicited stand', async () => {
    const { connector, player, body, movement, frame } = await boot();
    const handlers = connector.handlers()!;
    handlers.onLocalPosition?.(restored());
    handlers.onConnectionState?.('reconnecting');
    movement.cursors.right.isDown = true;
    const before = connector.sent.length;
    frame();
    expect(player.x).toBe(300.5);
    expect(connector.sent).toHaveLength(before);
    movement.cursors.right.isDown = false;
    handlers.onResync?.();
    handlers.onConnectionState?.('connected'); // JOIN_ROOM precedes ROOM_STATE.
    frame();
    expect(connector.sent).toHaveLength(before);
    const seat = BASE_MAP_SEATS[0]!;
    const position = { x: (seat.tx + 0.5) * TILE, y: (seat.ty + 0.5) * TILE - 18 };
    handlers.onLocalPosition?.(remoteSnapshot({ ...position, seat: mapSeatId(0), facing: seat.facing }));
    handlers.onLocalSeat?.(mapSeatId(0));
    frame();
    expect({ x: player.x, y: player.y }).toEqual(position);
    expect(body.checkCollision.none).toBe(true);
    expect(player.seatFacing).toBe(seat.facing);
    expect(connector.stands()).toBe(0);
    expect(connector.sent.at(-1)).toEqual({ ...position, facing: seat.facing });
  });

  it('keeps offline play available after an initial transport failure', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake', artManifestUrl: null, artUploadsUrl: null,
      connect: async () => { throw new Error('unavailable'); },
    });
    scene.game.loop.stop();
    const player = findPlayer(scene);
    const x = player.x;
    (scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys }).cursors.right.isDown = true;
    scene.game.step(scene.time.now + 20, 20);
    expect(player.x).toBeGreaterThan(x);
  });

  it('adopts a restored position from a real Colyseus client before any scene move reaches the server', async () => {
    const commands = (vitestBrowser as unknown as { commands: BrowserCommands }).commands;
    let connection: OfficeConnection | undefined;
    let adopt: (() => void) | undefined;
    try {
      const { endpoint } = await commands.authoritativePositionServer('start');
      const { scene } = await bootOfficeScene(createOfficeBridge(), {
        endpoint, getIdToken: async () => 'verified', artManifestUrl: null, artUploadsUrl: null,
        connect: async (options) => {
          connection = await connectOfficeRoom({ ...options, handlers: {
            ...options.handlers,
            onLocalPosition: (snapshot) => { adopt = () => options.handlers.onLocalPosition?.(snapshot); },
          } });
          return connection;
        },
      });
      await vi.waitFor(() => expect(adopt).toBeDefined(), LOOP_WAIT);
      scene.game.loop.stop();
      const player = findPlayer(scene);
      let time = scene.time.now;
      scene.game.step(time += 20, 20);
      expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position)
        .toEqual({ x: 300.5, y: 400.25 });
      adopt!();
      scene.game.step(time += 20, 20);
      expect({ x: player.x, y: player.y }).toEqual({ x: 300.5, y: 400.25 });
      expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position)
        .toEqual({ x: 300.5, y: 400.25 });
      (scene as unknown as { cursors: Phaser.Types.Input.Keyboard.CursorKeys }).cursors.right.isDown = true;
      scene.game.step(time += 20, 20);
      await vi.waitFor(async () => expect((await commands.authoritativePositionServer('state', connection!.sessionId)).position?.x)
        .toBeCloseTo(player.x), LOOP_WAIT);
      expect(player.x).toBeGreaterThan(300.5);
      expect(player.x).toBeLessThan(310);
    } finally {
      try { await connection?.leave(); }
      finally { await commands.authoritativePositionServer('stop'); }
    }
  });
});

describe('OfficeScene: avatares reales por Colyseus (PRD 6.2)', () => {
  it('sin endpoint corre en solitario y lo anuncia por el puente', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null });

    // Sin endpoint no hay nada que reintentar, y por eso `canRetry` es falso:
    // ofrecer un boton de reintento en modo solitario seria ofrecer un boton que
    // no puede hacer nada.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: false,
      }),
    );
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('un alta remota dibuja un avatar nuevo en las coordenadas del servidor', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ x: 500, y: 600 }));

    const avatars = findRemoteAvatars(scene);
    expect(avatars).toHaveLength(1);
    expect({ x: avatars[0].x, y: avatars[0].y }).toEqual({ x: 500, y: 600 });
    expect(avatars[0].nameText).toBe('Ana Remota');
  });

  it('no dibuja un clon del jugador local aunque el servidor lo incluya', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: DEFAULT_NAME }));

    // El jugador local ya responde al teclado al instante; su copia remota
    // llegaria con el retardo de la red y se veria como un doble pisandole.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('una baja remota retira el avatar de la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-va' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onRemove('se-va');

    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('emite presence con el numero de companeros conectados', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'a' }));
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'b' }));

    expect(presence.at(-1)).toEqual({
      online: true,
      peers: 2,
      state: 'connected',
      canRetry: true,
    });
  });

  it('si el servidor no responde, la oficina sigue jugable en solitario', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    // Lo que se prueba es que un servidor caido no deja la pantalla en negro:
    // en desarrollo eso seria la mitad del tiempo.
    // Con endpoint configurado SI hay algo que reintentar, aunque el primer
    // intento fallase: el servidor puede estar solo arrancando.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: true,
      }),
    );
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('a refused join is "denied" with its reason, never "offline" (#129)', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new OfficeAccessDeniedError('expired');
      },
    });

    await vi.waitFor(() =>
      expect(presence.at(-1)).toEqual({
        online: false,
        peers: 0,
        state: 'denied',
        reason: 'expired',
        canRetry: true,
      }),
    );
    // "Sin servidor" would send the person to retry against a server that is
    // up and has already said no.
    expect(presence.some((p) => p.state === 'offline' && p.canRetry)).toBe(false);
  });

  it('publica la posicion del jugador local en cada frame', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // El agrupado decide que sale por el cable; la escena publica siempre.
    await vi.waitFor(() => expect(connector.sent.length).toBeGreaterThan(0));
    expect(connector.sent[0]).toMatchObject({ facing: 'down' });
  });

  it('cierra la conexion al apagar la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);

    // Sin esto, cada remonte de StrictMode dejaria un socket vivo publicando la
    // posicion de un jugador ya destruido.
    await vi.waitFor(() => expect(connector.hasLeft()).toBe(true));
  });
});

describe('OfficeScene: roster de personas conectadas via el puente (#74)', () => {
  it('un alta remota emite "roster" con ese par', async () => {
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }));

    expect(roster.at(-1)).toEqual({
      peers: [{ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }],
    });
  });

  it('no incluye al propio jugador aunque el servidor lo repita en el estado (mismo ignoreSessionId que los avatares)', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: DEFAULT_NAME }));

    expect(roster).toHaveLength(0);
  });

  it('una baja remota emite "roster" sin ese par', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-va', name: 'Se Va' }));
    await vi.waitFor(() => expect(roster.at(-1)?.peers).toHaveLength(1));

    connector.handlers()!.onRemove('se-va');

    expect(roster.at(-1)).toEqual({ peers: [] });
  });

  it('un onChange de solo posicion no reemite "roster"', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const roster: OfficeEventMap['roster'][] = [];
    bridge.on('roster', (r) => roster.push(r));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g' }));
    const emissionsAfterAdd = roster.length;

    connector.handlers()!.onChange(
      remoteSnapshot({ sessionId: 'par-1', name: 'Ana Remota', status: 'g', x: 999, y: 999 }),
    );

    expect(roster).toHaveLength(emissionsAfterAdd);
  });
});

describe('OfficeScene: drift de spacesVersion entre pares (#74, PR3a)', () => {
  it('un alta con una version distinta de la mia emite "spacesstale" con esa version', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });

  it('la MISMA version que la mia no emite nada: nadie esta desacompasado', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    // `remoteSnapshot()` por defecto ya lleva `BUILT_IN_SPACES_VERSION`, la
    // misma con la que arranca la escena.
    connector.handlers()!.onAdd(remoteSnapshot());

    expect(stale).toHaveLength(0);
  });

  it('un onChange con version distinta TAMBIEN emite: cubre la edicion de un par ya conectado', async () => {
    // Una edicion desde /dashboard o desde el editor en oficina desacompasa a
    // un par YA conectado -- su alta ya paso, asi que solo un onChange puede
    // avisar de esto.
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));

    connector.handlers()!.onChange(remoteSnapshot({ sessionId: 'par-1', spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });

  it('una version ya vista no vuelve a emitir, la reporte el mismo par o uno distinto', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const stale: OfficeEventMap['spacesstale'][] = [];
    bridge.on('spacesstale', (s) => stale.push(s));
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', spacesVersion: 'version-editada' }));

    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'par-2', spacesVersion: 'version-editada' }));

    expect(stale).toEqual([{ version: 'version-editada' }]);
  });
});

describe('OfficeScene: comando setStatus via el puente (#1)', () => {
  it('repinta el punto de estado del jugador local', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR[DEFAULT_STATUS]);

    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe('r');
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR.r);
  });

  it('publica el estado nuevo al servidor', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'y' });

    expect(connector.statuses).toEqual(['y']);
  });

  it('corta el audio al instante, sin esperar al siguiente tic de proximidad', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });

    // Sin esperar nada: un "No molestar" que tarda un cuarto de segundo en
    // cortar el audio no es un corte, es un retraso.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it('un par que pasa a "No molestar" deja de ser audible en el siguiente tic', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    connector
      .handlers()!
      .onChange(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y, status: 'r' }));

    await vi.waitFor(() => {
      expect(voices.at(-1)?.peers).toEqual([]);
    }, LOOP_WAIT);
  });

  it('el mismo estado dos veces no vuelve a publicarlo', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(connector.statuses).toEqual(['r']);
  });

  it('el join lleva el estado actual del jugador, no un valor fijo', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedWith()).toBe(DEFAULT_STATUS), LOOP_WAIT);
  });

  it('el join lleva la version de config de espacios fallback (#7, D4)', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // Sin `spacesVersion` en las opciones la escena publica la constante
    // fallback, que es el camino de la oficina en solitario y el de un
    // despliegue sin `DATABASE_URL`: todos sus clientes caen en el mismo valor
    // y por tanto siguen de acuerdo.
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );
  });

  it('un cambio de estado mientras la conexion esta en vuelo no se pierde', async () => {
    const bridge = createOfficeBridge();
    const statuses: PresenceStatus[] = [];
    let joinedWith: PresenceStatus | undefined;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const connection: OfficeConnection = {
      sessionId: 'mi-sesion',
      sendMove: () => {},
      sendStatus: (status) => statuses.push(status),
      sendSpacesVersion: () => {},
      sendCall: () => {},
      sendCallRespond: () => {},
      sendSit: () => {},
      sendStand: () => {},
      leave: async () => {},
    };

    await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async (options: ConnectOfficeRoomOptions) => {
        joinedWith = options.status;
        await gate;
        return connection;
      },
    });

    bridge.emitCommand('setStatus', { status: 'r' });
    openGate();

    // El join ya habia salido con el estado viejo: si nadie reconcilia al
    // aterrizar, el servidor nos publica "En linea" habiendo pedido "No
    // molestar", y el aislamiento local no se nota desde fuera.
    await vi.waitFor(() => expect(statuses).toEqual(['r']), LOOP_WAIT);
    expect(joinedWith).toBe(DEFAULT_STATUS);
  });

  it('desuscribe el handler de setStatus al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe(DEFAULT_STATUS);
  });
});

describe('OfficeScene: comando speakers via el puente (issue #17, D7 -- habla real enciende el anillo)', () => {
  it('enciende el anillo de un avatar remoto real cuando su sessionId reporta estar hablando', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    expect(avatar.ring.visible).toBe(false);

    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(true);
  });

  it('apaga el anillo cuando su sessionId deja de aparecer en el conjunto reportado', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });
    expect(avatar.ring.visible).toBe(true);

    bridge.emitCommand('speakers', { sessionIds: [] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('un sessionId ajeno en el comando no enciende avatares que no coinciden', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    bridge.emitCommand('speakers', { sessionIds: ['alguien-mas'] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('desuscribe el handler de speakers al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(false);
  });
});

describe('OfficeScene: retratos fieles exportados una vez desde create() (issue #17, D1)', () => {
  it('emite "portraits" una sola vez con una URL de datos PNG decodificable por cada clave base', async () => {
    const bridge = createOfficeBridge();
    const events: { byKey: Record<string, string> }[] = [];
    bridge.on('portraits', (payload) => events.push(payload));

    await bootOfficeScene(bridge);

    expect(events).toHaveLength(1);
    const { byKey } = events[0];
    const expectedKeys = [...AVATAR_KEYS, PLAYER_TEXTURE].sort();
    expect(Object.keys(byKey).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      const dataUrl = byKey[key];
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(atob(dataUrl.split(',')[1]).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Issue #2, unit 12 (kill switch final de la cadena, D3/D9/D10). Como el
 * resto de este archivo, **no puede ejecutarse en este entorno**
 * (`chrome-headless-shell` sin `libglib-2.0.so.0`, mismo fallo que arrastra
 * toda la cadena desde PR3). Escrito y verificado a mano contra la
 * implementacion, no contra una corrida verde -- mismo precedente que la
 * unit 8 en PR3.
 */
describe('OfficeScene: comandos de llamada via el puente (issue #2, D3)', () => {
  it('el comando callPeer reenvia el sessionId al transporte (connection.sendCall)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual(['peer-1']);
  });

  it('el comando respondCall reenvia {from,accept} al transporte (connection.sendCallRespond)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });

    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: false }]);
  });

  it('sin conexion activa, los comandos de llamada no lanzan (oficina en solitario)', async () => {
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: null });

    expect(() => bridge.emitCommand('callPeer', { sessionId: 'peer-1' })).not.toThrow();
    expect(() => bridge.emitCommand('respondCall', { from: 'x', accept: true })).not.toThrow();
    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' })).not.toThrow();
  });

  it('desuscribe los tres handlers de llamada al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });
    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual([]);
    expect(connector.respondedCalls).toEqual([]);
  });
});

describe('OfficeScene: mensajes de llamada del servidor se relanzan al puente (issue #2, D4)', () => {
  it('onCallInvite del transporte se relanza como "callinvite"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string; name: string }[] = [];
    bridge.on('callinvite', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallInvite?.({ from: 'caller-1', name: 'Diego Soto' });

    expect(events).toEqual([{ from: 'caller-1', name: 'Diego Soto' }]);
  });

  it('forwards transport desk invalidation to the bridge without changing geometry', async () => {
    const bridge = createOfficeBridge();
    const changed = vi.fn();
    bridge.on('deskschanged', changed);
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://office', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onDesksChanged?.();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('onCallerLeft del transporte se relanza como "callerleft"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string }[] = [];
    bridge.on('callerleft', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallerLeft?.({ from: 'caller-1' });

    expect(events).toEqual([{ from: 'caller-1' }]);
  });

  it('onCallAccepted del transporte se relanza como "callaccepted"', async () => {
    const bridge = createOfficeBridge();
    const events: { by: string; name: string }[] = [];
    bridge.on('callaccepted', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallAccepted?.({ by: 'peer-1', name: 'Marta Ríos' });

    expect(events).toEqual([{ by: 'peer-1', name: 'Marta Ríos' }]);
  });

  it('onRecordings and onRecordingReady are forwarded as "recordings" and "recordingready" (#5, #58)', async () => {
    const bridge = createOfficeBridge();
    const events: unknown[] = [];
    bridge.on('recordings', (payload) => events.push(payload));
    bridge.on('recordingready', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onRecordings?.({ sala: { startedBy: 'ses-1', startedAt: 1 } });
    connector.handlers()!.onRecordingReady?.({ recordingId: 'rec-1', spaceId: 'sala', availableUntil: 2 });

    expect(events).toEqual([
      { active: { sala: { startedBy: 'ses-1', startedAt: 1 } } },
      { recordingId: 'rec-1', spaceId: 'sala', availableUntil: 2 },
    ]);
  });
});

describe('OfficeScene: auto-caminata al aceptar una llamada (issue #2, D9/D10)', () => {
  it(
    'walkToPeer mueve al jugador junto al peer y LO DEJA QUIETO ahi -- regresion ' +
      'directa de la trampa de renormalizar la velocidad del reductor (ver discovery ' +
      '"update() renormaliza la velocidad del reductor"): normalize().scale() la ' +
      'reescala a una magnitud constante y el jugador oscilaria alrededor del ' +
      'destino sin llegar nunca. Si alguien reintroduce esa renormalizacion en el ' +
      'camino de autoWalk, la velocidad jamas se asienta en (0,0) y esta prueba no ' +
      'converge (timeout en el primer `vi.waitFor`, o la posicion sigue derivando en ' +
      'el segundo chequeo).',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Zona abierta del cesped, lejos del jugador y de cualquier colisionador.
      (player.body as Phaser.Physics.Arcade.Body).reset(22 * TILE + 16, 28 * TILE + 16);
      const peerX = 30 * TILE;
      const peerY = 30 * TILE;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      await vi.waitFor(() => {
        const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
        expect(d).toBeLessThanOrEqual(TILE * 1.5);
      }, LOOP_WAIT);

      const body = player.body as Phaser.Physics.Arcade.Body;
      await vi.waitFor(() => {
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      // Asentado de verdad, no solo un cruce momentaneo de la ventana de
      // ARRIVE_EPSILON_PX: la posicion no debe seguir derivando cuadros despues.
      const settledX = player.x;
      const settledY = player.y;
      await advanceGameClock(scene, 300);
      expect(player.x).toBe(settledX);
      expect(player.y).toBe(settledY);
    },
    20000,
  );

  it('un toque de WASD durante la auto-caminata cancela y devuelve el control al instante', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 30 * TILE, y: 30 * TILE }));
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    // Deja que la auto-caminata arranque de verdad antes de interrumpirla.
    await vi.waitFor(() => {
      const body = player.body as Phaser.Physics.Arcade.Body;
      expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
    }, LOOP_WAIT);

    dispatchKey('keydown', KEY.RIGHT);
    try {
      // D10: el mismo cuadro que lee la tecla ya se mueve bajo velocidad de
      // teclado -- esa lectura ES la cancelacion, sin listener aparte.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBeGreaterThan(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('aceptar una llamada (respondCall accept:true) dispara la misma auto-caminata que walkToPeer', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const peerX = 30 * TILE;
    const peerY = 30 * TILE;
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: peerX, y: peerY }));
    const startDistance = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });

    await vi.waitFor(() => {
      const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
      expect(d).toBeLessThan(startDistance);
    }, LOOP_WAIT);
    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: true }]);
  });

  it('pasar una llamada (respondCall accept:false) NO mueve al jugador', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: 30 * TILE, y: 30 * TILE }));
    const startX = player.x;
    const startY = player.y;

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it('walkToPeer sobre un sessionId desconocido no hace nada (peer ya desconectado)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const startX = player.x;
    const startY = player.y;

    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'fantasma' })).not.toThrow();
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it(
    'el destino respeta el espacio de quien llama (issue #10, S2 3.2): el jugador aterriza ' +
      'DENTRO del rectangulo servido, no solo cerca del peer -- regresion directa de usar ' +
      'findFreeAdjacentTile sin el rectangulo, que aterrizaria fuera de un espacio cuando el ' +
      'primer offset del peer cae al otro lado del borde',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);

      // Cubiculo 3x3 en cesped abierto, lejos de cualquier colisionador del
      (player.body as Phaser.Physics.Arcade.Body).reset(22 * TILE + 16, 28 * TILE + 16);
      // mapa base (mismas tiles que `terrainGrid.test.ts`).
      const rect = { x0: 30, y0: 30, x1: 32, y1: 32 };
      const cubiculo = {
        id: 'desk-borde',
        name: 'Escritorio de Borde',
        x: rect.x0 * TILE,
        y: rect.y0 * TILE,
        w: (rect.x1 - rect.x0 + 1) * TILE,
        h: (rect.y1 - rect.y0 + 1) * TILE,
      };
      bridge.emitCommand('spacesconfig', { spaces: [cubiculo], version: 'version-cubiculo' });

      // El peer esta en el borde DERECHO del cubiculo: su primer
      // ADJACENT_OFFSETS ([1,0]) cae en (33,31), fuera del rectangulo. Sin la
      // restriccion de espacio, `findFreeAdjacentTile` aterrizaria ahi mismo.
      const peerX = rect.x1 * TILE + 16;
      const peerY = 31 * TILE + 16;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      // Primero confirma que la auto-caminata REALMENTE arranco (velocidad
      // distinta de cero en algun momento) antes de esperar a que se asiente:
      // sin este chequeo intermedio, un `walkToPeer` que aborta temprano
      // (peer no encontrado, destino null) pasaria el chequeo de asentado de
      // forma trivial -- la velocidad ya es (0,0) en reposo desde el inicio.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
      }, LOOP_WAIT);

      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      const landedTx = Math.floor(player.x / TILE);
      const landedTy = Math.floor(player.y / TILE);
      expect(landedTx).toBeGreaterThanOrEqual(rect.x0);
      expect(landedTx).toBeLessThanOrEqual(rect.x1);
      expect(landedTy).toBeGreaterThanOrEqual(rect.y0);
      expect(landedTy).toBeLessThanOrEqual(rect.y1);
    },
    20000,
  );
});

describe('OfficeScene: nombre real del usuario local (#6)', () => {
  it('la pildora del jugador local lleva el nombre de la sesion', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { playerName: 'Ana Torres' });

    expect(findPlayer(scene).nameText).toBe('Ana Torres');
  });

  it('sin nombre de sesion el jugador local cae en DEFAULT_NAME, no en el de una persona', async () => {
    const { scene } = await bootOfficeScene();

    // Desarrollo local, e2e y la oficina sin autenticacion comparten este
    // camino: la escena llama al usuario como lo llama el servidor.
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('entra a la sala de Colyseus con ese mismo nombre', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
      playerName: 'Ana Torres',
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBe('Ana Torres'), LOOP_WAIT);
  });

  it('sin nombre de sesion entra a la sala con el de la pildora, no con undefined', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBeDefined(), LOOP_WAIT);
    expect(connector.joinedName()).toBe(findPlayer(scene).nameText);
  });

  it('el tile de video propio se etiqueta con el mismo nombre que la pildora', async () => {
    const bridge = createOfficeBridge();
    const voices: { selfName: string }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null, playerName: 'Ana Torres' });

    // `emitVoice` lee la pildora: si la pildora deja de ser la sesion, el tile
    // propio se va con ella. Se comprueban juntas para que no se separen.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    expect(voices.at(-1)?.selfName).toBe('Ana Torres');
    expect(voices.at(-1)?.selfName).toBe(findPlayer(scene).nameText);
  });
});

/**
 * La config servida llegando a la escena (#7, slice 3). Quien la LEE es
 * `spacesConfig.ts` y quien la resuelve es `useSpacesConfig`, ambos probados
 * sin Phaser. Lo que falta cubrir aqui es que, una vez dentro, gobierne de
 * verdad la pertenencia y se anuncie a los pares.
 *
 * Entra por COMANDO y no por opcion de construccion: llega despues de que
 * Phaser arranque, porque la escena no puede esperar a un viaje de red para
 * existir.
 */
describe('OfficeScene: config de espacios servida (#7, slice 3)', () => {
  /** Un espacio que NO existe en `BUILT_IN_SPACES`, en pixeles y sobre el spawn. */
  const SERVIDO = {
    id: 'id-espacio-servido',
    name: 'Espacio Servido',
    x: (PLAYER_SPAWN_TX - 2) * TILE,
    y: (PLAYER_SPAWN_TY - 2) * TILE,
    w: 6 * TILE,
    h: 6 * TILE,
  };

  it('tras el comando deriva la pertenencia de los espacios servidos', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    // El jugador nace dentro de `SERVIDO`, que no es ninguna de las dos salas
    // incorporadas: sin adoptar la config, el spawn caeria en piso abierto y
    // este evento no llegaria nunca.
    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)?.spaceId).toBe(SERVIDO.id), LOOP_WAIT);
  });

  it('adopts a config that arrived before the scene finished loading (#144)', async () => {
    // React emits the served config as soon as `/spaces` answers, which can
    // be before `preload()` is done with the art pack. Lost, the scene kept the
    // built-in rooms for the whole session and every space token was refused.
    const bridge = createOfficeBridge();
    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    const { scene } = await bootOfficeScene(bridge);

    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)?.spaceId).toBe(SERVIDO.id), LOOP_WAIT);
  });

  it('anuncia la version nueva a los pares con sendSpacesVersion', async () => {
    // Es la mitad que hace util al predicado mutuo: un cliente que cambia de
    // config tiene que DECIRLO, o el resto seguira creyendo que coinciden.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION), LOOP_WAIT);

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    await vi.waitFor(() => expect(connector.sentSpacesVersions).toContain('version-servida'), LOOP_WAIT);
  });

  it('una config cuya version ya es la vigente no se reenvia', async () => {
    // El caso normal de un despliegue sin editar: lo servido coincide con lo
    // incorporado. Un mensaje por sesion que no dice nada nuevo es ruido.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );

    bridge.emitCommand('spacesconfig', {
      spaces: BUILT_IN_SPACES,
      version: BUILT_IN_SPACES_VERSION,
    });
    await advanceGameClock(scene, 400);

    expect(connector.sentSpacesVersions).toEqual([]);
  });

  it('paints each served space with its persisted floor, recolored and over the walkable tiles only (art step 4)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const floorKey = recoloredSheetKey('floor-plain', 'sheet', '#2c3e50');

    bridge.emitCommand('spacesconfig', {
      spaces: [{ ...SERVIDO, floor: { materialId: 'floor-plain', color: '#2c3e50' } }, { ...SERVIDO, id: 'sin-suelo', x: 0 }],
      version: 'version-servida',
    });

    const floors = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image => c.type === 'Image' && (c as Phaser.GameObjects.Image).texture.key === floorKey,
    );
    expect(floors).toHaveLength(spaceFloorTiles(SERVIDO, buildTerrainGrid()).length);
    expect(floors[0]?.depth).toBe(1.5);
  });

  it('a config equal to the built-in one still brings its floors, and a new one replaces them', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const grassRooms = BUILT_IN_SPACES.map((room) => ({ ...room, floor: { materialId: 'floor-grass', color: null } }));
    const count = (): number =>
      scene.children.list.filter((c) => c.type === 'Image' && (c as Phaser.GameObjects.Image).depth === 1.5).length;

    bridge.emitCommand('spacesconfig', { spaces: grassRooms, version: BUILT_IN_SPACES_VERSION });
    expect(count()).toBeGreaterThan(0);

    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-vacia' });
    expect(count()).toBe(0);
  });

  it('a space floor that cannot load leaves a visible veil instead of nothing', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { artManifestUrl: null });

    bridge.emitCommand('spacesconfig', {
      spaces: [{ ...SERVIDO, floor: { materialId: 'floor-wood', color: null } }],
      version: 'version-servida',
    });

    const veils = scene.children.list.filter((c) => c.type === 'Rectangle' && (c as Phaser.GameObjects.Rectangle).depth === 1.5);
    expect(veils).toHaveLength(1);
  });

  it('una lista servida vacia deja al jugador en piso abierto', async () => {
    // Un despliegue con la tabla vacia es legitimo. La escena no puede
    // degradar a los incorporados: derivaria pertenencia de rectangulos que el
    // servidor no tiene.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-vacia' });
    const rooms: { spaceId: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    // Varios tics de proximidad (250ms cada uno) de reloj de JUEGO.
    await advanceGameClock(scene, 800);

    expect(rooms.every((room) => room.spaceId === null)).toBe(true);
  });
});

/**
 * Los escritorios asignables llegando a la escena (#7, slice 5). Quien los LEE
 * es `desksClient.ts` y quien los resuelve es `useDesks`, ambos probados sin
 * Phaser. Lo que falta cubrir aqui es el DIBUJO y el clic: que cada zona de
 * 3x3 aparece donde toca, que la decoracion de su ocupante cae en su caja, que
 * el propio se distingue del ajeno y que solo se puede clicar lo que es de uno
 * o lo que esta libre.
 *
 * Entran por COMANDO y no por opcion de construccion, misma razon que
 * `spacesconfig`: llegan despues de que Phaser arranque, porque la escena no
 * puede esperar a un viaje de red para existir.
 */
describe('OfficeScene: escritorios asignables (#7, slice 5)', () => {
  function servedDesk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
    return {
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
      ...overrides,
    };
  }

  function occupant(displayName: string | null, items: DeskDecorItem[] = []): DeskOccupant {
    return { id: `id-${displayName ?? 'anonimo'}`, displayName, items };
  }

  function fakePointer(): Phaser.Input.Pointer {
    return { event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
  }

  function findZone(scene: Phaser.Scene, deskId: string): Phaser.GameObjects.Rectangle | null {
    return scene.children.getByName(deskZoneName(deskId)) as Phaser.GameObjects.Rectangle | null;
  }

  function countZones(scene: Phaser.Scene): number {
    return scene.children.list.filter((child) => child.name.startsWith('desk:')).length;
  }

  it('arranca sin ningun escritorio asignable: nadie espera a la red', async () => {
    // La escena existe antes que la respuesta de `/desks`, igual que existe
    // antes que la de `/spaces`.
    const { scene } = await bootOfficeScene();

    expect(countZones(scene)).toBe(0);
  });

  it('tras el comando dibuja la zona de 3x3 de cada escritorio, en pixeles del mundo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const zone = findZone(scene, 'id-mesa');
    expect(zone).not.toBeNull();
    // Origen arriba a la izquierda, 96x96: el rectangulo de Phaser se ancla en
    // su centro, asi que la esquina es centro menos medio lado.
    expect(zone!.x - zone!.width / 2).toBe(10 * TILE);
    expect(zone!.y - zone!.height / 2).toBe(12 * TILE);
    expect(zone!.width).toBe(3 * TILE);
    expect(zone!.height).toBe(3 * TILE);
  });

  it('no toca los 39 escritorios del mapa base: son mobiliario, no sitios que se cojan', async () => {
    // The base desks are 2x1 props of the layout. Un escritorio asignable se
    // dibuja ENCIMA: es config servida, no parte del mapa base.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const deskCount = BASE_LAYOUT.props.filter((prop) => prop.kind === 'desk').length;

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const baseDesks = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image =>
        c.type === 'Image' &&
        (c as Phaser.GameObjects.Image).texture.key === artSheetKey('desk-wood', 'sheet') &&
        !c.name.startsWith('desk-furniture:'),
    );
    expect(baseDesks).toHaveLength(deskCount);
  });

  function furniture(scene: Phaser.Scene, deskId: string): Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null {
    return scene.children.getByName(deskFurnitureName(deskId)) as Phaser.GameObjects.Image | null;
  }

  it('draws the desk in its persisted material and color, at native size in the middle of the area (art step 4)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk({ appearance: { materialId: 'desk-painted', color: '#c0392b' } })] });

    const image = furniture(scene, 'id-mesa') as Phaser.GameObjects.Image;
    expect(image.type).toBe('Image');
    expect(image.texture.key).toBe(recoloredSheetKey('desk-painted', 'sheet', '#c0392b'));
    const anchor = deskAreaAnchor({ x: 10 * TILE, y: 12 * TILE, w: 3 * TILE, h: 3 * TILE });
    const piece = { anchor: { x: 32, y: 40 }, facings: { down: { ground: { x: 0, y: 6 }, chairGround: { x: 0, y: -10 } } } };
    const placement = deskPlacement(piece as unknown as ArtDeskPiece, 'down', anchor);
    expect({ x: image.x, y: image.y, frame: Number(image.frame.name) }).toEqual({ x: placement.x, y: placement.y, frame: 1 });
    // 64px, the PNG cell: not stretched to the 96px area.
    expect(image.displayWidth).toBe(64);
    expect(image.displayHeight).toBe(64);
  });

  it('a desk without appearance draws the pack default desk', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect((furniture(scene, 'id-mesa') as Phaser.GameObjects.Image).texture.key).toBe(artSheetKey('desk-wood', 'sheet'));
  });

  it('a desk whose material cannot load keeps a visible placeholder', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk({ appearance: { materialId: 'desk-retirado', color: null } })] });

    expect(furniture(scene, 'id-mesa')?.type).toBe('Rectangle');
    // After the catalog re-read finds nothing, it stays a placeholder, still drawn.
    await advanceGameClock(scene, 600);
    expect(furniture(scene, 'id-mesa')?.type).toBe('Rectangle');
  });

  it('redraws a desk once its texture finishes loading during the session', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    // As if this material had not been loaded at boot.
    scene.textures.remove(artSheetKey('desk-glass', 'sheet'));

    bridge.emitCommand('desks', { desks: [servedDesk({ appearance: { materialId: 'desk-glass', color: null } })] });

    expect(furniture(scene, 'id-mesa')?.type).toBe('Rectangle');
    await vi.waitFor(() => {
      const drawn = furniture(scene, 'id-mesa') as Phaser.GameObjects.Image | null;
      expect(drawn?.type).toBe('Image');
      expect(drawn?.texture.key).toBe(artSheetKey('desk-glass', 'sheet'));
    }, LOOP_WAIT);
  });

  it('draws pieces of the uploads catalog too (#121)', async () => {
    const bridge = createOfficeBridge();
    // The pack manifest stands in for the server's uploads manifest: same format.
    const { scene } = await bootOfficeScene(bridge, {
      artManifestUrl: 'assets/pack/missing-manifest.json',
      artUploadsUrl: 'assets/pack/manifest.json',
    });

    bridge.emitCommand('desks', { desks: [servedDesk({ appearance: { materialId: 'desk-glass', color: null } })] });

    await vi.waitFor(() => {
      const drawn = furniture(scene, 'id-mesa') as Phaser.GameObjects.Image | null;
      expect(drawn?.texture.key).toBe(artSheetKey('desk-glass', 'sheet'));
    }, LOOP_WAIT);
  });

  it('without the art pack a desk is a visible placeholder, not a crash', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { artManifestUrl: null });

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(findZone(scene, 'id-mesa')).not.toBeNull();
    expect(furniture(scene, 'id-mesa')?.type).toBe('Rectangle');
  });

  it('pinta la decoracion del ocupante dentro de su caja, no en cualquier sitio', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({
          occupant: occupant('Ana Torres', [
            { id: 'id-item', slot: 8, rotation: 0, textureKey: 'no-existe-en-el-bundle', aboveAvatars: false },
          ]),
        }),
      ],
    });

    // El slot 8 es la caja de abajo a la derecha (`deskSlotRect`): su centro
    // cae a dos tiles y medio del origen del escritorio.
    const decor = scene.children.getByName('desk-item:id-item') as Phaser.GameObjects.Rectangle;
    expect(decor).not.toBeNull();
    expect(decor.x).toBe(10 * TILE + 2.5 * TILE);
    expect(decor.y).toBe(12 * TILE + 2.5 * TILE);
  });

  it('decor that points at an art texture (an uploaded plant, #121) loads that piece on demand and redraws with it', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    // Any sheet the map has not loaded stands in for an upload that arrived
    // after the page did; a character sheet is one nobody draws at boot.
    const textureKey = artSheetKey('character-p02-beige-blazer', 'walk');

    bridge.emitCommand('desks', {
      desks: [servedDesk({ occupant: occupant('Ana Torres', [{ id: 'id-planta', slot: 4, rotation: 0, textureKey, aboveAvatars: false }]) })],
    });

    expect(scene.children.getByName('desk-item:id-planta')?.type).toBe('Rectangle');
    await vi.waitFor(() => {
      const drawn = scene.children.getByName('desk-item:id-planta') as Phaser.GameObjects.Image | null;
      expect(drawn?.type).toBe('Image');
      expect(drawn?.texture.key).toBe(textureKey);
    }, LOOP_WAIT);
  });

  it('una pieza con un slot que no existe se salta sin llevarse el escritorio por delante', async () => {
    // El dato viene de la red. Pintarla en una caja inventada la dejaria fuera
    // del escritorio, y no pintar nada dejaria la oficina sin ese sitio.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({
          occupant: occupant('Ana Torres', [
            { id: 'id-fuera', slot: 99, rotation: 0, textureKey: 'x', aboveAvatars: false },
          ]),
        }),
      ],
    });

    expect(scene.children.getByName('desk-item:id-fuera')).toBeNull();
    expect(findZone(scene, 'id-mesa')).not.toBeNull();
  });

  it('el escritorio propio se distingue del de otra persona', async () => {
    // Cual es el propio lo dice el SERVIDOR (`mine`), que es quien sabe quien
    // pregunta. La escena lo lee, no lo deduce.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'mia', occupant: occupant('Ana Torres'), mine: true }),
        servedDesk({ id: 'ajena', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    expect(findZone(scene, 'mia')!.fillColor).not.toBe(findZone(scene, 'ajena')!.fillColor);
  });

  it('un homonimo NO hereda tu escritorio: manda `mine`, no el nombre', async () => {
    // El pin de regresion de esta slice. Decidir la pertenencia comparando el
    // nombre visible es lo que la slice 1 de esta misma issue retiro de
    // `proximityAudio.ts`: alli un renombrado cambiaba en silencio quien oye a
    // quien, y aqui cambiaria de manos un escritorio. Dos personas del
    // directorio pueden llamarse igual, y una de ellas puede llamarse como tu
    // desde que un Admin la renombro.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'homonima', occupant: occupant('Ana Torres'), mine: false }),
        servedDesk({ id: 'ajena', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    // Se ve como lo que es: el escritorio de otra persona, y sin nada que
    // ofrecer al clicarlo.
    const homonima = findZone(scene, 'homonima')!;
    expect(homonima.fillColor).toBe(findZone(scene, 'ajena')!.fillColor);
    expect(homonima.input).toBeNull();
  });

  it('un escritorio libre se distingue de uno ocupado', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'libre' }),
        servedDesk({ id: 'ocupada', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    expect(findZone(scene, 'libre')!.fillColor).not.toBe(findZone(scene, 'ocupada')!.fillColor);
  });

  it('la profundidad es el borde inferior, misma convencion que el mobiliario del mapa', async () => {
    // `placeFurniture` uses `(y + h) * TILE` for every piece, so the desk
    // y-sorts against the furniture around it inside the world band. Avatars
    // no longer depend on this: they live in their own band above it (#70).
    // The zone itself is a floor marker since step 6, so it never veils the
    // desk's sitter.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(furniture(scene, 'id-mesa')!.depth).toBe(12 * TILE + 3 * TILE);
    expect(findZone(scene, 'id-mesa')!.depth).toBe(DESK_ZONE_DEPTH);
  });

  it('clicar un escritorio libre pide cogerlo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    findZone(scene, 'id-mesa')!.emit('pointerdown', fakePointer());

    // La escena sabe que hay dibujado; quien habla con el servidor es React.
    expect(clicks).toEqual([{ deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }]);
  });

  it('clicar el propio ofrece dejarlo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', {
      desks: [servedDesk({ occupant: occupant('Ana Torres'), mine: true })],
    });
    findZone(scene, 'id-mesa')!.emit('pointerdown', fakePointer());

    expect(clicks).toEqual([{ deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }]);
  });

  it('clicar el de otra persona no hace nada', async () => {
    // Ni siquiera se hace clicable: un escritorio ajeno no tiene ninguna
    // accion que ofrecer, y `release` solo suelta el propio.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [servedDesk({ occupant: occupant('Luis Paz') })] });
    const zone = findZone(scene, 'id-mesa')!;
    zone.emit('pointerdown', fakePointer());

    expect(zone.input).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('un clic que llega por el minimapa no ofrece el escritorio: solo mueve la camara (#98)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    const pointer = { ...fakePointer(), camera: scene.cameras.cameras[1] } as Phaser.Input.Pointer;
    findZone(scene, 'id-mesa')!.emit('pointerdown', pointer);

    expect(clicks).toEqual([]);
  });

  it('el clic no se cuela al mapa de fondo', async () => {
    // Mismo `stopPropagation` que el clic de un peer: sin el, el
    // `pointerdown` de la escena cerraria el menu contextual a la vez.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const pointer = fakePointer();

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    findZone(scene, 'id-mesa')!.emit('pointerdown', pointer);

    const { stopPropagation } = pointer.event as unknown as { stopPropagation: () => void };
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('una lista nueva reemplaza a la anterior en vez de acumularse encima', async () => {
    // Cada refresco trae el estado COMPLETO, no un delta: quien solto su sitio
    // tiene que dejar de verse ocupado, y dibujar encima lo dejaria pintado.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'primera' })] });
    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'segunda' })] });

    expect(countZones(scene)).toBe(1);
    expect(findZone(scene, 'primera')).toBeNull();
    expect(findZone(scene, 'segunda')).not.toBeNull();
  });

  it('una lista vacia deja la oficina sin escritorios asignables y sin tocar nada mas', async () => {
    // Es el despliegue sin directorio configurado, donde `/desks` responde 503
    // y el cliente degrada a no pintar ninguno. Todo lo demas sigue igual.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    bridge.emitCommand('desks', { desks: [] });

    expect(countZones(scene)).toBe(0);
    expect(findPlayer(scene)).toBeDefined();
  });

  it('desuscribe el handler de desks al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(countZones(scene)).toBe(0);
  });
});

/**
 * Cableado de la reconexion en la escena (issue #52). El viaje por cable ya lo
 * cubre `officeRoomClient.node.test.ts` contra un Colyseus real; lo que se
 * prueba aqui es lo que la escena TIENE que hacer cuando ese viaje termina
 * bien: tirar los avatares viejos y, sobre todo, dejar que el audio vuelva.
 */
describe('OfficeScene: reconexion (issue #52)', () => {
  it('un resync vacia el registro: el replay de la sala nueva es quien repuebla', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-fue-durante-la-caida' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onResync!();

    // Quien se haya ido mientras duraba la caida no tiene `onRemove` que lo
    // retire: ese borrado ocurrio en una sala que ya no existe. Si no se vacia
    // aqui, se queda pintado para siempre.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('tras un resync el audio vuelve a emitirse aunque el conjunto de pares sea identico', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const audible = () => remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y });
    connector.handlers()!.onAdd(audible());

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);
    const emitidosAntes = voices.length;

    // Resync y replay en la MISMA vuelta, sin tic por medio: asi el conjunto de
    // pares que ve el siguiente tic es identico al de antes, y lo unico que
    // puede hacer que se reemita es haber borrado la clave de dedupe.
    connector.handlers()!.onResync!();
    connector.handlers()!.onAdd(audible());

    // Esta es la trampa de la issue #41 vuelta a pisar: `emitVoice` deduplica
    // por `lastVoiceKey`, asi que sin invalidarla el par recuperado se veria y
    // no se oiria -- nadie volveria a pedirle a LiveKit que lo suscriba.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(emitidosAntes), LOOP_WAIT);
    expect(voices.at(-1)?.peers.map((peer) => peer.sessionId)).toEqual(['par-1']);
  });

  it('el estado de conexion viaja por "presence" sin cambiarle el significado a `online`', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onConnectionState!('reconnecting');

    // `online` sigue significando lo mismo que siempre (hay sesion viva), para
    // que nada rio abajo cambie de sentido en silencio al ensancharse el evento.
    expect(presence.at(-1)).toEqual({
      online: false,
      peers: 0,
      state: 'reconnecting',
      canRetry: true,
    });
  });

  it('el comando "reconnect" tira la sesion muerta, limpia la oficina y vuelve a entrar', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'de-la-sesion-vieja' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    bridge.emitCommand('reconnect', undefined);

    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    expect(connector.hasLeft()).toBe(true);
    // Los avatares de la sesion anterior no pueden sobrevivir a la nueva: el
    // join reparte los suyos, y mezclarlos dejaria fantasmas.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('deja de escuchar "reconnect" al apagarse la escena', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('reconnect', undefined);

    // Un comando tardio del HUD no puede resucitar una escena destruida: seria
    // el mismo socket huerfano que la guarda `alive` lleva evitando desde el
    // principio, entrando por otra puerta. El doble cuenta la entrada de forma
    // sincrona, asi que no hace falta esperar a nada para afirmarlo.
    expect(connector.connectCount()).toBe(1);
  });

  it('el reintento manual se anuncia como "reconectando" antes de esperar al servidor', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onConnectionState!('offline');
    bridge.on('presence', (p) => presence.push(p));

    bridge.emitCommand('reconnect', undefined);

    // El aviso sale ANTES del `await` del join, no despues: entrar tarda lo que
    // tarde la red, y durante ese rato el HUD seguiria pintando "Sin servidor"
    // con su boton al lado -- o sea, sin acuse de recibo de un clic que SI hizo
    // algo. Es el mismo sintoma que esta issue viene a quitar, en pequeno.
    expect(presence.at(-1)?.state).toBe('reconnecting');
  });

  it('dos clics seguidos en Reintentar no abren dos sesiones', async () => {
    const connector = fakeConnector();
    const { bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('reconnect', undefined);
    bridge.emitCommand('reconnect', undefined);

    // Entrar es asincrono, asi que sin guarda el segundo clic arranca un join
    // mientras el primero sigue en vuelo: gana el que resuelva el ultimo y el
    // otro queda huerfano, vivo y publicando la posicion del jugador. Dos
    // sesiones para una persona son DOS avatares suyos en la oficina de los
    // demas -- justo la clase de fantasma que esta issue viene a quitar.
    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connector.connectCount()).toBe(2);
  });
});

/**
 * Modo edicion de layout (#74, PR3b): la escena solo sabe SI se esta
 * editando (para suspender claim/release) y delega el resto -- overlays,
 * ghost, pick/place -- en `LayoutEditLayer`, ya probado por su cuenta en
 * `LayoutEditLayer.browser.test.ts`. Lo que falta cubrir aqui es la
 * integracion: que el flag realmente gatea el clic de escritorio, y que el
 * `pointerdown` global de la escena de verdad llega a la capa.
 */
describe('OfficeScene: modo edicion de layout (#74, PR3b)', () => {
  function fakePointer(worldX = 0, worldY = 0): Phaser.Input.Pointer {
    return { worldX, worldY, event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
  }

  function editableDesk(): OfficeDesk {
    return {
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
    };
  }

  it('mientras se edita, clicar un escritorio no ofrece cogerlo ni soltarlo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    bridge.emitCommand('desks', { desks: [editableDesk()] });

    const zone = scene.children.getByName(deskZoneName('id-mesa')) as Phaser.GameObjects.Rectangle;
    zone.emit('pointerdown', fakePointer());

    expect(clicks).toEqual([]);
  });

  it('fuera del modo edicion, el clic del escritorio sigue ofreciendo cogerlo (sin regresion)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [editableDesk()] });
    const zone = scene.children.getByName(deskZoneName('id-mesa')) as Phaser.GameObjects.Rectangle;
    zone.emit('pointerdown', fakePointer());

    expect(clicks).toEqual([{ deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }]);
  });

  it('un clic en el mapa mientras se coloca emite layoutplace con la posicion encajada', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const placements: unknown[] = [];
    bridge.on('layoutplace', (payload) => placements.push(payload));

    bridge.emitCommand('layoutedit', {
      pickable: [],
      selectedId: null,
      placing: { w: 3, h: 3, obstacles: [] },
    });
    scene.input.emit('pointerdown', fakePointer(10 * TILE, 10 * TILE));

    expect(placements).toEqual([{ tx: 9, ty: 9, valid: true }]);
  });
});

/**
 * Render layers (#70, #71). The bands themselves are pinned by
 * `depthLayers.test.ts`; what is covered here is that the scene actually puts
 * each object in its band, for both the local player and remote peers.
 */
describe('OfficeScene: render layers (#70, #71)', () => {
  function renderDesk(items: DeskDecorItem[] = []): OfficeDesk {
    return {
      id: 'id-mesa-capas',
      label: 'Mesa 9',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-ocupante', displayName: 'Ana Torres', items },
      mine: false,
    };
  }

  function depthOf(object: Phaser.GameObjects.GameObject): number {
    return (object as unknown as Phaser.GameObjects.Components.Depth).depth;
  }

  /** Everything drawn in the world that is neither an avatar nor a HUD overlay. */
  function normalWorldObjects(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
    return scene.children.list.filter(
      (c) => c.type !== 'Container' && depthOf(c) < MINIMAP_MARKER_DEPTH,
    );
  }

  function maxDepth(objects: readonly Phaser.GameObjects.GameObject[]): number {
    return Math.max(...objects.map(depthOf));
  }

  it('the local player covers every normal asset, even standing north of it (#70)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    bridge.emitCommand('desks', {
      desks: [
        renderDesk([
          {
            id: 'id-normal',
            slot: 4,
            rotation: 0,
            textureKey: 'no-existe-en-el-bundle',
            aboveAvatars: false,
          },
        ]),
      ],
    });
    const player = findPlayer(scene);

    // Near the top of the map: with plain y-sorting almost every tree, desk
    // and chair has a larger bottom edge and would be drawn over the player.
    player.setPosition(player.x, 3 * TILE + 16);

    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(maxDepth(normalWorldObjects(scene)));
    }, LOOP_WAIT);
  });

  it('a remote peer covers every normal asset too (#70)', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-arriba', x: 20 * TILE, y: 2 * TILE }));
    const remote = findRemoteAvatars(scene)[0];

    // Right after creation, before any `update()` re-sorts it.
    expect(remote.depth).toBeGreaterThan(maxDepth(normalWorldObjects(scene)));
    await advanceGameClock(scene, 100);
    expect(remote.depth).toBeGreaterThan(maxDepth(normalWorldObjects(scene)));
  });

  it('a special asset covers a player passing under it; a normal one does not (#71)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const desk = renderDesk([
      { id: 'id-normal', slot: 3, rotation: 0, textureKey: 'no-existe-en-el-bundle', aboveAvatars: false },
      { id: 'id-especial', slot: 5, rotation: 0, textureKey: 'no-existe-en-el-bundle', aboveAvatars: true },
    ]);
    bridge.emitCommand('desks', { desks: [desk] });
    const normal = scene.children.getByName('desk-item:id-normal')!;
    const special = scene.children.getByName('desk-item:id-especial')!;
    const player = findPlayer(scene);

    // Walking through the middle row of the desk, below both pieces' bottom
    // edge: plain y-sorting would put the player over both.
    player.setPosition(desk.x + desk.w / 2, desk.y + desk.h - 4);

    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(depthOf(normal));
      expect(depthOf(special)).toBeGreaterThan(player.depth);
    }, LOOP_WAIT);
  });

  it('a special asset covers remote peers as well (#71)', async () => {
    const connector = fakeConnector();
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const desk = renderDesk([
      { id: 'id-especial', slot: 4, rotation: 0, textureKey: 'no-existe-en-el-bundle', aboveAvatars: true },
    ]);
    bridge.emitCommand('desks', { desks: [desk] });

    connector.handlers()!.onAdd(
      remoteSnapshot({ sessionId: 'par-debajo', x: desk.x + desk.w / 2, y: desk.y + desk.h }),
    );
    const remote = findRemoteAvatars(scene)[0];

    await advanceGameClock(scene, 100);
    expect(depthOf(scene.children.getByName('desk-item:id-especial')!)).toBeGreaterThan(remote.depth);
  });
});

describe('OfficeScene: integracion camera pan y colision de peers (#53, #59)', () => {
  function screenPointer(
    x: number,
    y: number,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): Phaser.Input.Pointer {
    return { x, y, button: 0, camera } as unknown as Phaser.Input.Pointer;
  }

  it('walkToPeer aterriza en la tile al OESTE del peer cuando el jugador se acerca desde el oeste (#59)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const peerTx = 30;
    const peerTy = 30;
    // Bien al oeste del peer, misma fila: cesped abierto, lejos de cualquier
    // colisionador del mapa base.
    player.setPosition((peerTx - 10) * TILE + 16, peerTy * TILE + 16);
    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerTx * TILE + 16, y: peerTy * TILE + 16 }));

    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

    // Primero confirma que la auto-caminata REALMENTE arranco (mismo chequeo
    // que la regresion de arriba, y por la misma razon: sin el, el primer
    // sondeo podria caer ANTES del primer `update()`, con velocidad (0,0)
    // todavia de reposo, y el "asentado" de abajo pasaria trivialmente sin
    // que el jugador se haya movido un pixel).
    await vi.waitFor(() => {
      const body = player.body as Phaser.Physics.Arcade.Body;
      expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
    }, LOOP_WAIT);
    await vi.waitFor(() => {
      const body = player.body as Phaser.Physics.Arcade.Body;
      expect(body.velocity.x).toBe(0);
      expect(body.velocity.y).toBe(0);
    }, LOOP_WAIT);
    // Antes de #59 el primer ADJACENT_OFFSETS ([1,0], ver terrainGrid.ts) lo
    // habria aterrizado al ESTE del peer, sin enterarse de que el jugador
    // venia del oeste.
    expect(Math.floor(player.x / TILE)).toBe(peerTx - 1);
    expect(Math.floor(player.y / TILE)).toBe(peerTy);
  });

  it('el colisionador vivo del peer bloquea al jugador (#59): no es solo la prueba aislada de remoteAvatarSink', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    // Cesped abierto, una tile al oeste del peer: un solo paso lo solaparia
    // si no hubiese colisionador.
    player.setPosition(29 * TILE + 16, 30 * TILE + 16);
    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 30 * TILE + 16, y: 30 * TILE + 16 }));

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await advanceGameClock(scene, 300);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }

    expect(player.x).toBeLessThan(30 * TILE + 16);
  });

  it('un drag por encima del umbral panea SOLO cameras.main; el minimapa queda intacto (#53)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const minimap = scene.cameras.cameras[1];
    const minimapScrollX = minimap.scrollX;
    const startScrollX = mainCam.scrollX;

    scene.input.emit('pointerdown', screenPointer(50, 50, mainCam), []);
    scene.input.emit('pointermove', screenPointer(70, 50, mainCam));

    expect(mainCam.scrollX).not.toBe(startScrollX);
    expect(minimap.scrollX).toBe(minimapScrollX);

    scene.input.emit('pointerup', screenPointer(70, 50, mainCam));
  });

  it('un clic en el minimapa planea cameras.main hasta ese punto del mundo sin mover al jugador (#98)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const minimap = scene.cameras.cameras[1];
    const player = findPlayer(scene);
    const playerStart = { x: player.x, y: player.y };
    // Cerca del centro, no de una esquina: el ancho del minimapa ya no
    // coincide con el ratio del mundo (#86, RAIL_WIDTH), asi que una esquina
    // puede caer en el margen sin contenido; un punto centrado siempre mapea
    // dentro de los bounds del mundo, sin depender del tamano del minimapa.
    const clickX = minimap.x + minimap.width / 2 + 20;
    const clickY = minimap.y + minimap.height / 2 + 15;
    const worldPoint = minimap.getWorldPoint(clickX, clickY);

    scene.input.emit('pointerdown', screenPointer(clickX, clickY, minimap), []);
    scene.input.emit('pointerup', screenPointer(clickX, clickY, minimap));

    // Hasta 1px de diferencia: la oficina es pixel art y la camara redondea
    // el scroll (`roundPixels`).
    await vi.waitFor(() => {
      expect(Math.abs(mainCam.midPoint.x - worldPoint.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mainCam.midPoint.y - worldPoint.y)).toBeLessThanOrEqual(1);
    }, LOOP_WAIT);
    expect({ x: player.x, y: player.y }).toEqual(playerStart);
  });

  it('con el pan activo, las teclas de movimiento siguen moviendo al jugador y la camara no retoma el seguimiento (#53)', async () => {
    const { scene } = await bootOfficeScene();
    const mainCam = scene.cameras.main;
    const player = findPlayer(scene);
    const startX = player.x;

    scene.input.emit('pointerdown', screenPointer(50, 50, mainCam), []);
    scene.input.emit('pointermove', screenPointer(70, 50, mainCam));
    const pannedScrollX = mainCam.scrollX;
    expect(pannedScrollX).not.toBe(0);

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await advanceGameClock(scene, 500);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }

    // El jugador se sigue moviendo por teclado aunque el pan siga activo...
    expect(player.x).toBeGreaterThan(startX);
    // ...y la camara se queda donde el drag la dejo: no retoma el seguimiento
    // hasta soltar el pan (CameraPanLayer no comparte estado con el teclado).
    expect(mainCam.scrollX).toBe(pannedScrollX);

    scene.input.emit('pointerup', screenPointer(70, 50, mainCam));
  });
});

describe('OfficeScene: persisted character ids (art migration, step 5)', () => {
  it('loads the sheets of the own character the server replicates, keeping the procedural body', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const texture = player.baseTexture;

    connector.handlers()!.onLocalAvatar?.('character-p07-green-suit');

    await vi.waitFor(() => {
      expect(scene.textures.exists(artSheetKey('character-p07-green-suit', 'walk'))).toBe(true);
      expect(scene.textures.exists(artSheetKey('character-p07-green-suit', 'seated'))).toBe(true);
    }, LOOP_WAIT);
    expect((scene as OfficeScene).playerAvatarId).toBe('character-p07-green-suit');
    expect(player.baseTexture).toBe(texture);
  });

  it('a peer avatar carries its persisted character and its sheets get loaded', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p12-mint-blazer' }));

    await vi.waitFor(() => {
      expect(scene.textures.exists(artSheetKey('character-p12-mint-blazer', 'walk'))).toBe(true);
    }, LOOP_WAIT);
    const [peer] = findRemoteAvatars(scene) as (CharacterContainer & { avatarId?: string | null })[];
    expect(peer.avatarId).toBe('character-p12-mint-blazer');
  });
});

/**
 * Push-to-sit: walking into a free chair from right next to it sits the
 * player, then movement is locked for `SIT_LOCK_MS`; after that the held key
 * stands the player up without sitting again at once. There is no E key.
 */
describe('OfficeScene: push-to-sit', () => {
  type Arena = Awaited<ReturnType<typeof movementArena>>;
  const SEAT = BASE_MAP_SEATS[0]!;
  const GROUND = { x: (SEAT.tx + 0.5) * TILE, y: (SEAT.ty + 0.5) * TILE };
  const sitLock = (arena: Arena) => (arena.scene as unknown as { sitLockUntil: number | null }).sitLockUntil;

  /** On the tile north of the chair, its feet 14 px above the chair ground point. */
  function besideChair(arena: Arena) {
    arena.body.reset(GROUND.x, GROUND.y - TILE);
  }

  /** Holds the down arrow (toward the chair) until the player sits, at most a few frames. */
  function pushIntoChair(arena: Arena) {
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && arena.player.seatFacing === null; i++) arena.frame();
  }

  it('pushing into a free chair from the next tile sits on it and stops the walk', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);

    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect(feetOf(arena.player)).toEqual(GROUND);
    expect(arena.body.velocity.length()).toBe(0);
    expect(arena.movement.walkingMs).toBe(0);
  });

  it('E next to a chair does nothing any more', async () => {
    const arena = await movementArena();
    besideChair(arena);
    dispatchKey('keydown', KEY.E);
    try {
      arena.walk(200);
    } finally {
      dispatchKey('keyup', KEY.E);
    }
    expect(arena.player.seatFacing).toBeNull();
  });

  it('walking past a row of chairs, next to them, does not sit', async () => {
    const arena = await movementArena();
    besideChair(arena);
    arena.movement.cursors.right.isDown = true;
    arena.walk(400);

    expect(arena.player.seatFacing).toBeNull();
    expect(arena.player.x).toBeGreaterThan(GROUND.x + 2 * TILE);
  });

  it('double-click walking onto a chair does not sit', async () => {
    const arena = await movementArena();
    arena.body.reset(GROUND.x, GROUND.y - 3 * TILE);
    arena.doubleClick(GROUND.x, GROUND.y - 18);
    for (let i = 0; i < 200 && arena.movement.autoWalk !== undefined; i++) arena.frame();

    expect(arena.movement.autoWalk).toBeUndefined();
    expect(arena.player.seatFacing).toBeNull();
  });

  it('locks movement for SIT_LOCK_MS, then the held key stands up and walks away without sitting again', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);
    const seated = { x: arena.player.x, y: arena.player.y };

    arena.walk(SIT_LOCK_MS - 100);
    expect(arena.player.seatFacing).toBe(SEAT.facing);
    expect({ x: arena.player.x, y: arena.player.y }).toEqual(seated);

    arena.walk(200);
    expect(arena.player.seatFacing).toBeNull();
    expect(arena.player.y).toBeGreaterThan(seated.y);
    expect(sitLock(arena)).toBeNull();

    // Still held: the chair just left is ignored, not sat on again.
    arena.walk(60);
    expect(arena.player.seatFacing).toBeNull();
  });

  it('a released key lifts the re-sit guard: a fresh push into the chair sits again', async () => {
    const arena = await movementArena();
    pushIntoChair(arena);
    arena.walk(SIT_LOCK_MS + 60);
    expect(arena.player.seatFacing).toBeNull();

    arena.movement.cursors.down.isDown = false;
    arena.frame();
    arena.movement.cursors.up.isDown = true;
    for (let i = 0; i < 10 && arena.player.seatFacing === null; i++) arena.frame();
    expect(arena.player.seatFacing).toBe(SEAT.facing);
  });

  it('asks the room for the seat once and only its confirmation seats the player', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && connector.sits.length === 0; i++) arena.frame();
    expect(connector.sits).toEqual([mapSeatId(0)]);
    expect(arena.player.seatFacing).toBeNull();

    // Locked while the answer is on its way: the held key moves nothing.
    const asked = { x: arena.player.x, y: arena.player.y };
    arena.walk(200);
    expect({ x: arena.player.x, y: arena.player.y }).toEqual(asked);
    expect(connector.sits).toEqual([mapSeatId(0)]);

    connector.handlers()!.onLocalSeat?.(mapSeatId(0));
    expect(feetOf(arena.player)).toEqual(GROUND);
  });

  it('a refused request never locks longer than SIT_LOCK_MS', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    besideChair(arena);
    arena.movement.cursors.down.isDown = true;
    for (let i = 0; i < 10 && connector.sits.length === 0; i++) arena.frame();
    const asked = arena.player.y;

    arena.walk(SIT_LOCK_MS + 60);
    expect(arena.player.y).toBeGreaterThan(asked);
    expect(connector.stands()).toBe(1);
    expect(connector.sits).toEqual([mapSeatId(0)]);
  });

  it('the room standing the player up, or a position reset, ends the lock at once', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const handlers = connector.handlers()!;
    pushIntoChair(arena);
    handlers.onLocalSeat?.(mapSeatId(0));
    expect(sitLock(arena)).not.toBeNull();
    handlers.onLocalSeat?.(null);
    expect(sitLock(arena)).toBeNull();
    const stoodAt = arena.player.y;
    arena.frame();
    expect(arena.player.y).toBeGreaterThan(stoodAt);

    // Far from the chair, then a fresh push into it, and a reset during the lock.
    arena.movement.cursors.down.isDown = false;
    arena.frame();
    pushIntoChair(arena);
    expect(sitLock(arena)).not.toBeNull();
    handlers.onPositionReset?.(remoteSnapshot({ sessionId: 'mi-sesion', x: 500, y: 600 }));
    expect(sitLock(arena)).toBeNull();
    arena.movement.cursors.down.isDown = true;
    arena.frame();
    expect(arena.player.y).toBeGreaterThan(600);
  });
});

describe('OfficeScene: pack characters, walking and seats (art migration, step 6)', () => {
  const CHAIR_INDEX = 0;
  const CHAIR = BASE_MAP_SEATS[CHAIR_INDEX];
  const CHAIR_GROUND = { x: (CHAIR.tx + 0.5) * TILE, y: (CHAIR.ty + 0.5) * TILE };

  async function connected(sessionId = 'mi-sesion', bridge = createOfficeBridge()) {
    const connector = fakeConnector(sessionId);
    const { scene } = await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { connector, scene, bridge, player: findPlayer(scene) };
  }

  /** Next to the first meeting room chair, on the tile north of it. */
  function nextToChair(player: CharacterContainer): void {
    player.setPosition(CHAIR.tx * TILE + 16, (CHAIR.ty - 1) * TILE + 16);
  }

  it('draws the local player from the character the server replicates, once its sheets load', async () => {
    const { connector, player } = await connected();

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');

    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p03-forest-suit', 'walk'));
    }, LOOP_WAIT);
  });

  it('draws a peer from its character, and keeps it procedural without the pack', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit' }));

    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    const offline = await bootOfficeScene(createOfficeBridge(), { artManifestUrl: null });
    expect(findPlayer(offline.scene).sprite.texture.key).toBe(`${PLAYER_TEXTURE}-down`);
  });

  it('a peer whose character is retired mid-session is redrawn with the new one (#122)', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit' }));
    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    connector.handlers()!.onChange(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p09-mint-shirt' }));

    await vi.waitFor(() => {
      expect(findRemoteAvatars(scene)[0].sprite.texture.key).toBe(artSheetKey('character-p09-mint-shirt', 'walk'));
    }, LOOP_WAIT);
  });

  it('a player without a replicated character is the pack default', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { endpoint: null });
    const player = findPlayer(scene);

    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p01-burgundy-suit', 'walk'));
    }, LOOP_WAIT);
  });

  it('drawing the pack sprite does not move what the network, proximity and spaces read', async () => {
    const { connector, scene, player } = await connected();
    const rooms: OfficeEventMap['room'][] = [];
    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.on('room', (room) => rooms.push(room));
    const meeting = BUILT_IN_SPACES[0];
    player.setPosition(meeting.x + 2 * TILE + 16, meeting.y + 2 * TILE + 16);
    const position = { x: player.x, y: player.y };

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');
    await vi.waitFor(() => {
      expect(player.sprite.texture.key).toBe(artSheetKey('character-p03-forest-suit', 'walk'));
      expect(rooms.at(-1)?.name).toBe(meeting.name);
    }, LOOP_WAIT);

    expect({ x: player.x, y: player.y }).toEqual(position);
    expect(connector.sent.at(-1)).toMatchObject(position);
  });

  it('toggleSeat next to a free chair asks the room to sit; only the confirmation seats the player on it', async () => {
    const { connector, scene, player } = await connected();
    nextToChair(player);
    await advanceGameClock(scene, 50);

    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([mapSeatId(CHAIR_INDEX)]);
    await advanceGameClock(scene, 100);
    expect(player.seatFacing).toBeNull();

    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    expect(feetOf(player)).toEqual(CHAIR_GROUND);
    expect(player.seatFacing).toBe(CHAIR.facing);
    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(chairLayerDepth(CHAIR_GROUND.y, 'back'));
      expect(player.depth).toBeLessThan(chairLayerDepth(CHAIR_GROUND.y, 'front'));
      expect(connector.sent.at(-1)).toMatchObject({ x: player.x, y: player.y, facing: CHAIR.facing });
    }, LOOP_WAIT);
  });

  it('offers a placed chair the room sends, seats the player on its tile facing its way, and stands them up when it goes', async () => {
    const { connector, scene, player } = await connected();
    // On the open lawn, far from every base chair.
    const chairIndex = 22 * BASE_LAYOUT.width + 67;
    const ground = { x: 67.5 * TILE, y: 22.5 * TILE };
    const chairObjects = () => scene.children.list.filter((child) => child.name === CHAIR_OBJECT_NAME);
    connector.handlers()!.onChairs?.([{ index: chairIndex, piece: 'chair-gamer', facing: 'left' }]);
    expect(chairObjects().length).toBeGreaterThan(0);
    player.setPosition(ground.x, ground.y - TILE);
    await advanceGameClock(scene, 50);

    (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([chairSeatId(chairIndex)]);
    connector.handlers()!.onLocalSeat?.(chairSeatId(chairIndex));
    expect(feetOf(player)).toEqual(ground);
    expect(player.seatFacing).toBe('left');

    connector.handlers()!.onChairs?.([]);
    expect(player.seatFacing).toBeNull();
    expect(chairObjects()).toHaveLength(0);
  });

  it('toggleSeat again stands up; walking stands up too', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    nextToChair(player);
    bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.stands()).toBe(1);
    expect(player.seatFacing).toBeNull();

    bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));
    dispatchKey('keydown', KEY.LEFT);
    try {
      await vi.waitFor(() => expect(connector.stands()).toBe(2), LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.LEFT);
    }
    expect(player.seatFacing).toBeNull();
    await vi.waitFor(() => expect(player.depth).toBe(avatarDepth(feetOf(player).y)), LOOP_WAIT);
  });

  it('the room standing the player up (for example after a move away) shows it standing', async () => {
    const { connector, player } = await connected();
    nextToChair(player);
    (player.scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge.emitCommand('toggleSeat', undefined);
    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    connector.handlers()!.onLocalSeat?.(null);

    expect(player.seatFacing).toBeNull();
  });

  it('a seat confirmation nobody asked for is answered by standing up', async () => {
    const { connector } = await connected();

    connector.handlers()!.onLocalSeat?.(mapSeatId(CHAIR_INDEX));

    expect(connector.stands()).toBe(1);
  });

  it('never offers a seat out of reach or one a peer sits on', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;

    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([]);

    connector.handlers()!.onAdd(
      remoteSnapshot({ sessionId: 'par-1', x: CHAIR.tx * TILE + 16, y: CHAIR.ty * TILE - 2, seat: mapSeatId(CHAIR_INDEX), facing: CHAIR.facing }),
    );
    nextToChair(player);
    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).not.toContain(mapSeatId(CHAIR_INDEX));
  });

  it('shows a seated peer between the layers of its chair, facing the way the room says', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(
      remoteSnapshot({ sessionId: 'par-1', x: CHAIR_GROUND.x, y: CHAIR_GROUND.y - 18, seat: mapSeatId(CHAIR_INDEX), facing: CHAIR.facing }),
    );
    const peer = findRemoteAvatars(scene)[0];

    expect(peer.seatFacing).toBe(CHAIR.facing);
    await vi.waitFor(() => {
      expect(peer.depth).toBeGreaterThan(worldAssetDepth(CHAIR_GROUND.y));
      expect(peer.depth).toBeLessThan(chairLayerDepth(CHAIR_GROUND.y, 'front'));
    }, LOOP_WAIT);
  });

  it('a peer walks in the direction its position moves', async () => {
    const { connector, scene } = await connected();
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit', x: 500, y: 600 }));
    const peer = findRemoteAvatars(scene)[0];
    await vi.waitFor(() => {
      expect(peer.sprite.texture.key).toBe(artSheetKey('character-p05-charcoal-suit', 'walk'));
    }, LOOP_WAIT);

    connector.handlers()!.onChange(
      remoteSnapshot({ sessionId: 'par-1', avatarId: 'character-p05-charcoal-suit', x: 500, y: 520, facing: 'up' }),
    );

    await vi.waitFor(() => expect(peer.animation.direction).toBe('N'), LOOP_WAIT);
    expect(peer.animation.walkMs).toBeGreaterThan(0);
  });

  it('sits at an assignable desk it may use, on a chair drawn at the desk', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const desk: OfficeDesk = {
      id: 'id-mesa-libre',
      label: 'Mesa 1',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
    };
    bridge.emitCommand('desks', { desks: [desk] });
    const chairs = () =>
      scene.children.list.filter(
        (c) => c.type === 'Image' && (c as Phaser.GameObjects.Image).texture.key === artSheetKey('chair-wood', 'sheet'),
      ).length;
    const baseChairs = BASE_MAP_SEATS.length * 2;
    await vi.waitFor(() => expect(chairs()).toBe(baseChairs + 2), LOOP_WAIT);

    player.setPosition(desk.x + desk.w / 2, desk.y + desk.h / 2);
    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([deskSeatId(desk.id)]);

    connector.handlers()!.onLocalSeat?.(deskSeatId(desk.id));
    const furnitureImage = scene.children.getByName(deskFurnitureName(desk.id)) as Phaser.GameObjects.Image;
    expect(feetOf(player).y).toBeLessThan(furnitureImage.depth);
    expect(player.seatFacing).toBe('down');
  });

  it('never offers a desk someone else claimed', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const desk: OfficeDesk = {
      id: 'id-mesa-ajena',
      label: 'Mesa 2',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-otra', displayName: 'Otra', items: [] },
      mine: false,
    };
    bridge.emitCommand('desks', { desks: [desk] });

    player.setPosition(desk.x + desk.w / 2, desk.y + desk.h / 2);
    bridge.emitCommand('toggleSeat', undefined);

    expect(connector.sits).toEqual([]);
  });

  it('offers a decor chair of a desk someone else claimed as a guest seat, drawn in its slot, and stands up when it goes', async () => {
    const { connector, scene, player } = await connected();
    const bridge = (scene as unknown as { bridge: ReturnType<typeof createOfficeBridge> }).bridge;
    const decorChair = { id: 'item-silla', slot: 8, rotation: 90 as const, textureKey: artSheetKey('chair-gamer', 'sheet'), aboveAvatars: false };
    const desk: OfficeDesk = {
      id: 'id-mesa-ajena',
      label: 'Mesa 2',
      x: 10 * TILE,
      y: 30 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: { id: 'id-otra', displayName: 'Otra', items: [decorChair] },
      mine: false,
    };
    // Slot 8 is the bottom right box of the 3x3 desk: tile (12, 32).
    const ground = { x: 12.5 * TILE, y: 32.5 * TILE };
    const gamerLayers = () =>
      scene.children.list.filter(
        (c) => c.type === 'Image' && (c as Phaser.GameObjects.Image).texture.key === artSheetKey('chair-gamer', 'sheet'),
      ) as Phaser.GameObjects.Image[];
    bridge.emitCommand('desks', { desks: [desk] });
    await vi.waitFor(() => expect(gamerLayers()).toHaveLength(2), LOOP_WAIT);
    // Both layers around the chair ground, like any other chair, facing right (rotation 90).
    expect(gamerLayers().map((layer) => layer.depth).sort((a, b) => a - b)).toEqual([
      chairLayerDepth(ground.y, 'back'),
      chairLayerDepth(ground.y, 'front'),
    ]);
    expect(gamerLayers().every((layer) => layer.name === deskItemName(decorChair.id))).toBe(true);

    player.setPosition(ground.x, ground.y - TILE);
    await advanceGameClock(scene, 50);
    bridge.emitCommand('toggleSeat', undefined);
    expect(connector.sits).toEqual([decorSeatId(desk.id, 8)]);
    connector.handlers()!.onLocalSeat?.(decorSeatId(desk.id, 8));
    expect(feetOf(player)).toEqual(ground);
    expect(player.seatFacing).toBe('right');

    bridge.emitCommand('desks', { desks: [{ ...desk, occupant: { ...desk.occupant!, items: [] } }] });
    expect(player.seatFacing).toBeNull();
    expect(gamerLayers()).toHaveLength(0);
  });

  it('publishes the pack portrait of the own session for the video tiles', async () => {
    const bridge = createOfficeBridge();
    const portraits: OfficeEventMap['characterportraits'][] = [];
    bridge.on('characterportraits', (payload) => portraits.push(payload));
    const { connector } = await connected('mi-sesion', bridge);

    connector.handlers()!.onLocalAvatar?.('character-p03-forest-suit');

    await vi.waitFor(() => expect(portraits.at(-1)?.bySession['mi-sesion']).toMatch(/^data:image\/png/), LOOP_WAIT);
  });
});

/**
 * Edited terrain (#123 phase 2): the room replicates the blocks and the scene
 * follows them live, tilemap and colliders alike; the editor's preview only
 * repaints.
 */
describe('OfficeScene: edited terrain', () => {
  it('renders the empty production default and a pending paint without changing walkability until replication', async () => {
    const { BASE_LAYOUT: empty } = await import('./officeLayout');
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), { layout: empty, seats: [], endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    // The middle of the block west of the entrance, void by default.
    const west = { tx: PLAYER_SPAWN_TX - 9, ty: PLAYER_SPAWN_TY };
    const before = terrainTilesAt(scene, west.tx, west.ty);
    const draft = withBlock(empty.blocks, SPAWN_BLOCK_INDEX - 1, 'wood');
    const point = { x: west.tx * TILE + 16, y: west.ty * TILE + 16 };
    expect(solidAt(scene, point.x, point.y)).toBe(true);
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'wood' }, previewBlocks: draft });
    expect(terrainTilesAt(scene, west.tx, west.ty)).not.toEqual(before);
    expect(solidAt(scene, point.x, point.y)).toBe(true);
    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, west.tx, west.ty)).toEqual(before);
    connector.handlers()!.onTerrain!(draft);
    await vi.waitFor(() => expect(solidAt(scene, point.x, point.y)).toBe(false), LOOP_WAIT);
    expect(terrainTilesAt(scene, west.tx, west.ty)).not.toEqual(before);
  });
  it('bounds the main camera to the painted terrain plus three tiles and grows them with a replicated block (#179)', async () => {
    const { BASE_LAYOUT: empty } = await import('./officeLayout');
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), { layout: empty, seats: [], endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const cam = scene.cameras.main;
    const block = 9 * TILE;
    const margin = 3 * TILE;
    // Only the spawn block (column 10, row 7) is painted; the default zoom 2 shows less than it.
    const spawnRegion = { x: 10 * block - margin, y: 7 * block - margin, width: block + 2 * margin, height: block + 2 * margin };
    await vi.waitFor(() => expect(cam.getBounds()).toMatchObject(spawnRegion), LOOP_WAIT);

    connector.handlers()!.onTerrain!(withBlock(empty.blocks, SPAWN_BLOCK_INDEX - 1, 'wood'));

    await vi.waitFor(
      () => expect(cam.getBounds()).toMatchObject({ ...spawnRegion, x: 9 * block - margin, width: 2 * block + 2 * margin }),
      LOOP_WAIT,
    );
  });
  const LAWN = 35;
  /** The middle of the lawn block: its own material whatever the borders do. */
  const lawn = { x: 67 * TILE + 16, y: 22 * TILE + 16 };
  /** Dual-grid cell whose four corners are tiles inside the lawn block. */
  const lawnCell = { cx: 67, cy: 22 };

  function terrainTilesAt(scene: Phaser.Scene, cx: number, cy: number): (number | undefined)[] {
    return scene.children.list
      .filter((child): child is Phaser.Tilemaps.TilemapLayer => child.type === 'TilemapLayer')
      .filter((layer) => layer.layer.name.startsWith('terrain'))
      .map((layer) => layer.getTileAt(cx, cy, true)?.index);
  }

  function solidAt(scene: Phaser.Scene, x: number, y: number): boolean {
    return scene.physics.world.staticBodies.getArray().some((body) => body.hitTest(x, y));
  }

  async function bootConnected() {
    const connector = fakeConnector();
    const booted = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { ...booted, handlers: connector.handlers()! };
  }

  it('redraws the terrain and rebuilds the colliders from the blocks the room sends, and tells React', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));
    const grass = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);

    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    handlers.onTerrain!(watered);

    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(grass);
    expect(seen).toEqual([{ blocks: watered, walls: BASE_LAYOUT.walls, chairs: [] }]);

    handlers.onTerrain!(BASE_LAYOUT.blocks);
    // Arcade drops a destroyed static body on its next step.
    await vi.waitFor(() => expect(solidAt(scene, lawn.x, lawn.y)).toBe(false), LOOP_WAIT);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
    // The base map's own solids survive every rebuild.
    expect(solidAt(scene, 20 * TILE + 16, 20 * TILE + 16)).toBe(true);
  });

  it('paints pending blocks for the editor without changing collisions, and drops them when the editor closes', async () => {
    const { scene, bridge } = await bootConnected();
    const grass = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'water' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'water') });

    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(grass);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'water' } });
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'sand' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'sand') });
    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(grass);
  });

  it('keeps pending paints over an edit that arrives meanwhile, then shows the edit', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'sand' }, previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'sand') });
    const sand = terrainTilesAt(scene, lawnCell.cx, lawnCell.cy);

    handlers.onTerrain!(withBlock(BASE_LAYOUT.blocks, LAWN, 'water'));
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).toEqual(sand);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);

    bridge.emitCommand('terrainedit', null);
    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy)).not.toEqual(sand);
  });

  it('draws void as nothing over a black background, on the map and the minimap, and collides with it', async () => {
    const { scene, handlers } = await bootConnected();

    handlers.onTerrain!(withBlock(BASE_LAYOUT.blocks, LAWN, 'void'));

    expect(terrainTilesAt(scene, lawnCell.cx, lawnCell.cy).every((index) => index === undefined || index === -1)).toBe(true);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(true);
    expect(scene.cameras.cameras.length).toBeGreaterThanOrEqual(2);
    for (const camera of scene.cameras.cameras) {
      expect(camera.backgroundColor.color).toBe(VOID_COLOR);
      expect(camera.transparent).toBe(false);
    }
  });

  it('tells the editor the current blocks when it opens', async () => {
    const { bridge, handlers } = await bootConnected();
    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    handlers.onTerrain!(watered);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));

    bridge.emitCommand('terrainedit', { brush: null });
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });

    expect(seen).toEqual([{ blocks: watered, walls: BASE_LAYOUT.walls, chairs: [] }]);
  });

  it('a click on the map picks a block instead of closing menus while the editor is open', async () => {
    const { scene, bridge } = await bootConnected();
    const events: string[] = [];
    bridge.on('closemenu', () => events.push('closemenu'));
    bridge.on('terrainpick', ({ index }) => events.push(`pick:${index}`));

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });
    scene.input.emit('pointerdown', { worldX: lawn.x, worldY: lawn.y, button: 0, event: { stopPropagation() {} } }, []);

    expect(events).toEqual([`pick:${LAWN}`]);
  });

  const lawnTile = 22 * BASE_LAYOUT.width + 67;
  /** The grid vertex a post on `lawnTile` stands on: the tile's top-left corner. */
  const lawnVertex = { x: 67 * TILE, y: 22 * TILE };
  const wallObjects = (scene: Phaser.Scene) => scene.children.list.filter((child) => child.name === WALL_OBJECT_NAME);

  it('draws and collides with the walls the room sends, rebuilding both on every change, and tells React', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));
    const before = wallObjects(scene).length;
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false);

    const walled = withWalls(BASE_LAYOUT.walls, [{ index: lawnTile, piece: 'wall-brick' }, { index: lawnTile + 1, piece: 'wall-brick' }]);
    handlers.onWalls!(walled);

    // The posts stand on the tiles' top-left vertices: the wall runs along the grid line between them, not through the tile.
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y - 7)).toBe(true);
    expect(solidAt(scene, lawnVertex.x + TILE / 2, lawnVertex.y + 9)).toBe(false);
    expect(solidAt(scene, lawn.x, lawn.y)).toBe(false);
    expect(wallObjects(scene).length).toBeGreaterThan(before);
    expect(seen).toEqual([{ blocks: BASE_LAYOUT.blocks, walls: walled, chairs: [] }]);

    handlers.onWalls!(BASE_LAYOUT.walls);
    await vi.waitFor(() => expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false), LOOP_WAIT);
    expect(wallObjects(scene)).toHaveLength(before);
    // Walls of another map size are not this layout's: ignored.
    handlers.onWalls!([]);
    expect(wallObjects(scene)).toHaveLength(before);
  });

  it('draws pending walls for the editor without colliding with them, and drops them when it closes', async () => {
    const { scene, bridge } = await bootConnected();
    const before = wallObjects(scene).length;

    bridge.emitCommand('terrainedit', { brush: { kind: 'wall', piece: 'wall-glass' }, previewWalls: [{ index: lawnTile, piece: 'wall-glass' }, { index: lawnTile + 1, piece: 'wall-glass' }] });

    expect(wallObjects(scene).length).toBeGreaterThan(before);
    expect(solidAt(scene, lawnVertex.x, lawnVertex.y)).toBe(false);

    bridge.emitCommand('terrainedit', null);
    expect(wallObjects(scene)).toHaveLength(before);
  });

  it('draws pending chairs for the editor over the live ones, and tells it the live chairs', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    const chairObjects = () => scene.children.list.filter((child) => child.name === CHAIR_OBJECT_NAME);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));
    const live = [{ index: lawnTile, piece: 'chair-wood' as const, facing: 'down' as const }];
    handlers.onChairs!(live);
    const one = chairObjects().length;
    expect(one).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ blocks: BASE_LAYOUT.blocks, walls: BASE_LAYOUT.walls, chairs: live });

    bridge.emitCommand('terrainedit', { brush: { kind: 'chair', piece: 'chair-metal', facing: 'up' }, previewChairs: [{ index: lawnTile + 1, chair: { piece: 'chair-metal', facing: 'up' } }, { index: lawnTile, chair: null }] });
    expect(chairObjects()).toHaveLength(one);
    bridge.emitCommand('terrainedit', { brush: { kind: 'chair', piece: 'chair-metal', facing: 'up' }, previewChairs: [{ index: lawnTile + 1, chair: { piece: 'chair-metal', facing: 'up' } }] });
    expect(chairObjects()).toHaveLength(2 * one);

    bridge.emitCommand('terrainedit', null);
    expect(chairObjects()).toHaveLength(one);
  });

  it('tells the editor the current walls when it opens', async () => {
    const { bridge, handlers } = await bootConnected();
    const walled = withWalls(BASE_LAYOUT.walls, [{ index: lawnTile, piece: 'wall-stone' }]);
    handlers.onWalls!(walled);
    const seen: OfficeEventMap['terrain'][] = [];
    bridge.on('terrain', (payload) => seen.push(payload));

    bridge.emitCommand('terrainedit', { brush: null });

    expect(seen).toEqual([{ blocks: BASE_LAYOUT.blocks, walls: walled, chairs: [] }]);
  });
});


/**
 * Collision areas per piece: the scene collides the player with one static
 * body per rectangle of the room's table and of the served desks, and the
 * terrain tiles apart, so an edit moves exactly what it says.
 */
describe('OfficeScene: piece collisions', () => {
  /** The middle of the first Tiled tree's tile, (2, 2): a tree-oak. */
  const treeTile = { x: 2 * TILE + 16, y: 2 * TILE + 16 };
  /** A served desk on the open lawn, and the middle of its area. */
  const lawnDesk: OfficeDesk = {
    id: 'id-mesa',
    label: 'Mesa 9',
    x: 21 * TILE,
    y: 50 * TILE,
    w: 3 * TILE,
    h: 3 * TILE,
    occupant: null,
    mine: false,
    appearance: { materialId: 'desk-oak', color: null },
  };
  const deskMiddle = { x: 22 * TILE + 16, y: 51 * TILE + 16 };

  function solidAt(scene: Phaser.Scene, x: number, y: number): boolean {
    return scene.physics.world.staticBodies.getArray().some((body) => body.hitTest(x, y));
  }

  async function bootConnected() {
    const connector = fakeConnector();
    const booted = await bootOfficeScene(createOfficeBridge(), { endpoint: 'ws://test', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    return { ...booted, handlers: connector.handlers()! };
  }

  it('blocks a layout prop by its default rectangle and frees it when the room says it is walk-through', async () => {
    const { scene, handlers } = await bootConnected();
    expect(solidAt(scene, treeTile.x, treeTile.y)).toBe(true);

    handlers.onCollisions!(new Map([['tree-oak', []]]));

    await vi.waitFor(() => expect(solidAt(scene, treeTile.x, treeTile.y)).toBe(false), LOOP_WAIT);
    // The terrain colliders stay: the border hedge is still there.
    expect(solidAt(scene, 20 * TILE + 16, 16)).toBe(true);
  });

  it('collides with a served desk once its piece has rectangles, wherever the desk list puts it', async () => {
    const { scene, bridge, handlers } = await bootConnected();
    bridge.emitCommand('desks', { desks: [lawnDesk] });
    expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(false);

    handlers.onCollisions!(new Map([['desk-oak', [{ x: -20, y: -12, w: 40, h: 16 }]]]));
    expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(true);
    expect(solidAt(scene, deskMiddle.x + 21, deskMiddle.y)).toBe(false);

    bridge.emitCommand('desks', { desks: [] });
    await vi.waitFor(() => expect(solidAt(scene, deskMiddle.x, deskMiddle.y)).toBe(false), LOOP_WAIT);
  });

  it('a click on the map picks a piece instead of closing menus while the collision editor is open', async () => {
    const { scene, bridge } = await bootConnected();
    const events: string[] = [];
    bridge.on('closemenu', () => events.push('closemenu'));
    bridge.on('collisionpick', ({ pieceId }) => events.push(`pick:${pieceId}`));

    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 });
    scene.input.emit('pointerdown', { worldX: treeTile.x, worldY: treeTile.y, isDown: true, event: { stopPropagation() {} } }, []);
    scene.input.emit('pointerup', { worldX: treeTile.x, worldY: treeTile.y, isDown: false, event: { stopPropagation() {} } }, []);

    expect(events).toEqual(['pick:tree-oak']);

    bridge.emitCommand('collisionedit', null);
    scene.input.emit('pointerdown', { worldX: treeTile.x, worldY: treeTile.y, isDown: true, event: { stopPropagation() {} } }, []);
    expect(events).toEqual(['pick:tree-oak', 'closemenu']);
  });

  it('keeps the tile helpers off a tile a rectangle touches', async () => {
    const { scene, handlers } = await bootConnected();
    const lawn = { tx: 67, ty: 22 };
    handlers.onCollisions!(new Map([['tree-oak', []]]));
    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[2]![2]).toBe(false);

    handlers.onCollisions!(new Map([['tree-oak', [{ x: -2, y: -4, w: 4, h: 4 }]]]));

    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[2]![2]).toBe(true);
    expect((scene as unknown as { grid: { solid: boolean[][] } }).grid.solid[lawn.ty]![lawn.tx]).toBe(false);
  });
});

describe('OfficeScene: map zoom (map-zoom)', () => {
  const offline = { endpoint: null, artManifestUrl: null, artUploadsUrl: null } as const;
  /** The legacy 14x10-block layout is painted everywhere: its region is the grid plus three tiles a side (#179). */
  const REGION = { x: -3 * TILE, y: -3 * TILE, width: 14 * 9 * TILE + 6 * TILE, height: 10 * 9 * TILE + 6 * TILE };
  const memoryStore = (zoom: number) => ({ load: () => zoom, save: vi.fn() }) satisfies ZoomStore;

  async function zoomScene(zoomStore?: ZoomStore) {
    const bridge = createOfficeBridge();
    const views: ZoomView[] = [];
    bridge.on('zoomchanged', (view) => views.push(view));
    const { scene } = await bootOfficeScene(bridge, { ...offline, zoomStore });
    scene.game.loop.stop();
    return { scene, bridge, views, cam: scene.cameras.main, minimap: scene.cameras.cameras[1] };
  }

  function frames(scene: Phaser.Scene, count = 60): void {
    for (let frame = 0; frame < count; frame++) scene.game.step(scene.time.now + 16, 16);
  }

  /** A real mouse event on the canvas, at a point in canvas pixels. */
  function mouse(scene: Phaser.Scene, type: string, x: number, y: number): void {
    const rect = scene.game.canvas.getBoundingClientRect();
    scene.game.canvas.dispatchEvent(new MouseEvent(type, {
      clientX: rect.left + x, clientY: rect.top + y, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      bubbles: true, cancelable: true,
    }));
  }

  it('starts at the stored zoom with the terrain region bounds, announces it once and does not save it back', async () => {
    const store = memoryStore(1);
    const { scene, views, cam } = await zoomScene(store);
    frames(scene, 2);

    expect(cam.zoom).toBe(1);
    expect(cam.getBounds()).toMatchObject(regionBounds(REGION, cam, 1));
    expect(views).toEqual([zoomView(1)]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([
    ['a store that throws', { load: () => { throw new Error('blocked'); }, save: vi.fn() }],
    ['a value that is not a stop', memoryStore(1.3)],
    ['the retired 1.5 stop', memoryStore(1.5)],
    ['zero', memoryStore(0)],
  ])('starts at the default with %s', async (_name, store) => {
    const { scene, views, cam } = await zoomScene(store);
    frames(scene, 2);

    expect(cam.zoom).toBe(2);
    expect(cam.getBounds()).toMatchObject(regionBounds(REGION, cam, 2));
    expect(views).toEqual([zoomView(2)]);
  });

  it('without a store the office starts at the default zoom 2 (2x)', async () => {
    const { scene, views, cam } = await zoomScene();
    frames(scene, 2);

    expect(cam.zoom).toBe(2);
    expect(views).toEqual([zoomView(2)]);
  });

  it.each([
    ['no edit tool', () => undefined],
    ['the layout editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null })],
    ['the terrain editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('terrainedit', { brush: null })],
    ['the collision editor', (b: ReturnType<typeof createOfficeBridge>) => b.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 })],
  ])('the zoom command eases the main camera only and saves the stop, with %s open', async (_name, open) => {
    const store = memoryStore(2);
    const { scene, bridge, cam, minimap } = await zoomScene(store);
    open(bridge);
    const minimapView = { zoom: minimap.zoom, x: minimap.scrollX, y: minimap.scrollY };

    bridge.emitCommand('zoom', { action: 'in' });
    frames(scene);

    expect(cam.zoom).toBe(3);
    expect(store.save).toHaveBeenCalledExactlyOnceWith(3);
    expect({ zoom: minimap.zoom, x: minimap.scrollX, y: minimap.scrollY }).toEqual(minimapView);
  });

  it('a real ctrl+wheel over the map zooms it and is default-prevented, so the page does not zoom', async () => {
    const { scene, views } = await zoomScene();
    const rect = scene.game.canvas.getBoundingClientRect();
    // Below the minimap, which covers the top of this small canvas.
    const wheel = new WheelEvent('wheel', {
      deltaY: -100, ctrlKey: true, clientX: rect.left + 50, clientY: rect.top + 200, bubbles: true, cancelable: true,
    });

    scene.game.canvas.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(views.at(-1)).toEqual(zoomView(3));
  });

  it.each([
    { zoom: 1, tile: { tx: PLAYER_SPAWN_TX + 2, ty: PLAYER_SPAWN_TY + 2 } },
    { zoom: 3, tile: { tx: PLAYER_SPAWN_TX + 1, ty: PLAYER_SPAWN_TY + 1 } },
  ])('double-click-to-walk at $zoom targets the world tile under the pointer', async ({ zoom, tile }) => {
    const { scene } = await zoomScene(memoryStore(zoom));
    frames(scene, 3);
    const player = findPlayer(scene);
    const cam = scene.cameras.main;

    // 64 canvas px right and down of the center, where the camera holds the player.
    mouse(scene, 'mousemove', cam.width / 2 + 64, cam.height / 2 + 64);
    // Two real press and release pairs on the same point: the double click that walks.
    for (let pair = 0; pair < 2; pair++) {
      mouse(scene, 'mousedown', cam.width / 2 + 64, cam.height / 2 + 64);
      mouse(scene, 'mouseup', cam.width / 2 + 64, cam.height / 2 + 64);
      if (pair === 0) expect((scene as unknown as { autoWalk?: AutoWalkState }).autoWalk).toBeUndefined();
    }

    const goal = (scene as unknown as { autoWalk?: AutoWalkState }).autoWalk?.goal;
    expect(goal).toBeDefined();
    expect(goal!.x).toBeCloseTo(player.x + 64 / zoom, -1);
    expect(goal!.y).toBeCloseTo(player.y + 64 / zoom, -1);
    expect({ tx: Math.floor(goal!.x / TILE), ty: Math.floor(goal!.y / TILE) }).toEqual(tile);
  });

  it.each(['SHUTDOWN', 'game.destroy'])('%s releases the zoom subscription', async (how) => {
    const { scene, bridge, views } = await zoomScene();
    bridge.emitCommand('zoom', { action: 'in' });
    expect(views.at(-1)).toEqual(zoomView(3));

    if (how === 'SHUTDOWN') {
      scene.scene.stop();
      frames(scene, 2);
    } else {
      scene.game.destroy(true);
      scene.game.step(0, 0);
      games.splice(games.indexOf(scene.game), 1);
    }
    bridge.emitCommand('zoom', { action: 'out' });

    expect(views.at(-1)).toEqual(zoomView(3));
  });
});
