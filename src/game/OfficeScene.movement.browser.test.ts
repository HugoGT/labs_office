import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE } from './mapData';
import { terrainSnapshot, wallColliderRects, type OfficeLayout } from './officeLayout';
import {
  LEGACY_LAYOUT as BASE_LAYOUT,
  LEGACY_SEATS as BASE_MAP_SEATS,
  LEGACY_SPACES as BUILT_IN_SPACES,
} from '../test/legacyOffice';
import { physicalBodyRect } from './avatarGeometry';
import { BODY_CENTER_OFFSET, positionForBodyTile } from './pathfinding';
import { chairSeatId, mapSeatId } from './seating';
import { LAYOUT_OUTLINE_NAME } from './LayoutEditLayer';
import { buildTerrainGrid } from './terrainGrid';
import { coveredTiles } from './pieceCollisions';
import type { OfficeDesk } from './desksPort';
import type { OfficeEventMap } from './officeBridge';
import { ARRIVE_EPSILON_PX, beginAutoWalk } from './autoWalk';
import {
  destroyOfficeGames,
  movementArena,
  fakeConnector,
  remoteSnapshot,
} from '../test/officeScene';

afterEach(destroyOfficeGames);

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

  it('resets on sitting and on every editor that picks something', async () => {
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
      () => bridge.emitCommand('layoutedit', { pickable: [], selectedId: 'desk-1', placing: null }),
      () => bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: { w: 3, h: 3, obstacles: [] } }),
      () => bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } }),
      () => bridge.emitCommand('collisionedit', { pieceId: 'tree-oak', draft: [], selectedRect: null, snap: 1 }),
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

  it('keeps walking with an editor open and nothing picked, and stops once something is', async () => {
    const { bridge, body, movement, frame } = await movementArena();
    const idle = [
      () => bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null }),
      () => bridge.emitCommand('terrainedit', { brush: null }),
      () => bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 }),
    ];
    movement.cursors.right.isDown = true;
    for (const open of idle) {
      open();
      frame();
      expect(body.velocity.x).toBeGreaterThan(0);
    }

    // Picking a brush holds the map; Escape (the brush back to null) frees it again.
    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });
    frame();
    expect(body.velocity.length()).toBe(0);
    bridge.emitCommand('terrainedit', { brush: null });
    frame();
    expect(body.velocity.x).toBeGreaterThan(0);
    movement.cursors.right.isDown = false;
  });

  it('hides the minimap while a terrain brush is picked, and shows it again once it is not', async () => {
    const { scene, bridge } = await movementArena();
    const minimap = scene.cameras.cameras[1]!;
    expect(minimap.visible).toBe(true);

    bridge.emitCommand('terrainedit', { brush: { kind: 'floor', material: 'grass' } });
    expect(minimap.visible).toBe(false);
    bridge.emitCommand('terrainedit', { brush: null });
    expect(minimap.visible).toBe(true);
    bridge.emitCommand('terrainedit', { brush: { kind: 'wall', piece: 'wall-brick' } });
    expect(minimap.visible).toBe(false);
    bridge.emitCommand('terrainedit', null);
    expect(minimap.visible).toBe(true);
  });

  it('keeps the space outlines of every editor off the minimap, where they are noise (#216)', async () => {
    const { scene, bridge } = await movementArena();
    const [main, minimap] = [scene.cameras.cameras[0]!, scene.cameras.cameras[1]!];
    const outlines = [{ x0: 2, y0: 2, x1: 4, y1: 4 }];
    const drawn = () => scene.children.list.filter((child) => child.name === LAYOUT_OUTLINE_NAME) as Phaser.GameObjects.Rectangle[];

    for (const [name, command] of [
      ['layoutedit', { pickable: [], selectedId: null, placing: null, outlines }],
      ['terrainedit', { brush: null, outlines }],
      ['decoredit', { brush: null, area: null, outlines }],
    ] as const) {
      bridge.emitCommand(name, command as never);
      expect(drawn(), name).toHaveLength(1);
      expect(drawn()[0]!.cameraFilter & minimap.id, name).not.toBe(0);
      expect(drawn()[0]!.cameraFilter & main.id, name).toBe(0);
      bridge.emitCommand(name, null);
      expect(drawn(), name).toEqual([]);
    }
  });

  it('hides the minimap and holds the map while a decor piece is picked, and lets go once it is not (#208)', async () => {
    const { scene, bridge, movement } = await movementArena();
    const minimap = scene.cameras.cameras[1]!;

    bridge.emitCommand('decoredit', { brush: null, area: null });
    expect(minimap.visible).toBe(true);
    expect((scene as unknown as { mapHeld: boolean }).mapHeld).toBe(false);
    bridge.emitCommand('decoredit', { brush: { kind: 'piece', piece: 'chair-wood', info: { kind: 'chair', footprint: { w: 1, h: 1 } }, rotation: 0 }, area: null });
    expect(minimap.visible).toBe(false);
    expect((scene as unknown as { mapHeld: boolean }).mapHeld).toBe(true);
    expect(movement.autoWalk).toBeUndefined();
    // A selected item holds the map too (the next click acts on it), but keeps the minimap.
    bridge.emitCommand('decoredit', { brush: null, area: null, selected: 4242 });
    expect(minimap.visible).toBe(true);
    expect((scene as unknown as { mapHeld: boolean }).mapHeld).toBe(true);
    bridge.emitCommand('decoredit', null);
    expect(minimap.visible).toBe(true);
    expect((scene as unknown as { mapHeld: boolean }).mapHeld).toBe(false);
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

  it('walks to the world point under a single right click on the map, without the browser menu', async () => {
    const { scene, movement, rightClick } = await movementArena();
    rightClick(1000, 300);
    expect(movement.autoWalk?.goal).toEqual({ x: 1000, y: 300 });

    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    scene.game.canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('does not turn right drags, right clicks on an item or on the minimap into walking', async () => {
    const { scene, movement, rightClick } = await movementArena();
    rightClick(1000, 300, { distance: 20 });
    expect(movement.autoWalk).toBeUndefined();
    rightClick(1000, 300, { over: [scene.add.rectangle(0, 0, 1, 1)] });
    expect(movement.autoWalk).toBeUndefined();
    const pointer = { button: 2, camera: scene.cameras.cameras[1], x: 10, y: 10, getDistance: () => 0 };
    scene.input.emit('pointerdown', pointer, []);
    scene.input.emit('pointerup', pointer, []);
    expect(movement.autoWalk).toBeUndefined();
  });

  it('walks to the world point under a double click on the minimap', async () => {
    const { scene, movement } = await movementArena();
    const minimap = scene.cameras.cameras[1]!;
    const screen = { x: minimap.x + minimap.width / 2, y: minimap.y + minimap.height / 2 };
    const goal = minimap.getWorldPoint(screen.x, screen.y);
    const pointer = { button: 0, camera: minimap, ...screen, getDistance: () => 0 };

    for (let press = 0; press < 2; press++) {
      scene.input.emit('pointerdown', pointer, []);
      scene.input.emit('pointerup', pointer, []);
    }

    expect(movement.autoWalk?.goal.x).toBeCloseTo(goal.x, 6);
    expect(movement.autoWalk?.goal.y).toBeCloseTo(goal.y, 6);
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

describe('sliding along walls and around corners in real Phaser frames (#252)', () => {
  type Rect = { x: number; y: number; w: number; h: number };
  const overlapsAny = (body: Phaser.Physics.Arcade.Body, rects: Rect[]) =>
    rects.some((r) => body.right > r.x && body.x < r.x + r.w && body.bottom > r.y && body.y < r.y + r.h);

  // A wall right of the player built from two rectangles, as merged terrain
  // and wall runs meet in the office: Arcade alone stops a slide at the seam.
  it.each([
    ['down', [{ x: 400, y: 0, w: 8, h: 340 }, { x: 400, y: 340, w: 8, h: 2000 }]],
    ['up', [{ x: 400, y: 0, w: 8, h: 260 }, { x: 400, y: 260, w: 8, h: 2000 }]],
  ] as const)('walking diagonally %s into a seamed wall slides past the seam', async (vertical, wall) => {
    const { player, body, movement, walk } = await movementArena();
    movement.collisionRects = [...wall];
    movement.buildPieceColliders();
    body.reset(360, 300);
    movement.cursors.right.isDown = true;
    movement.cursors[vertical].isDown = true;
    walk(800);
    // 1x diagonal is ~163 px/s per axis: well past the seam 40 px away.
    expect(Math.abs(player.y - 300)).toBeGreaterThan(100);
    expect(body.right).toBeLessThanOrEqual(400);
    expect(overlapsAny(body, [...wall])).toBe(false);
  });

  it('walking diagonally into a desk slides along it and off its corner', async () => {
    const { player, body, movement, walk } = await movementArena();
    const desk = { x: 400, y: 400, w: 64, h: 32 };
    movement.collisionRects = [desk];
    movement.buildPieceColliders();
    body.reset(360, 360);
    movement.walkingMs = 3000;
    movement.cursors.right.isDown = true;
    movement.cursors.down.isDown = true;
    walk(800);
    expect(body.y).toBeGreaterThan(desk.y + desk.h);
    expect(body.x).toBeGreaterThan(desk.x);
    expect(player.y - 360).toBeGreaterThan(300);
    expect(overlapsAny(body, [desk])).toBe(false);
  });

  it('walking straight into a wall still stops at it', async () => {
    const { player, body, movement, walk } = await movementArena();
    const wall = { x: 400, y: 0, w: 8, h: 2000 };
    movement.collisionRects = [wall];
    movement.buildPieceColliders();
    body.reset(360, 300);
    movement.cursors.right.isDown = true;
    walk(400);
    const resting = { x: player.x, y: player.y };
    walk(200);
    expect(body.right).toBeLessThanOrEqual(400);
    expect(body.right).toBeGreaterThan(399.99);
    expect({ x: player.x, y: player.y }).toEqual(resting);
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
    movement.collisionRects = [...movement.collisionRects, { x: tx * TILE, y: ty0 * TILE, w: TILE, h: (ty1 - ty0 + 1) * TILE }];
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

  it('the goal is validated on the whole body: a click whose body would overlap a blocked tile does nothing', async () => {
    const arena = await movementArena();
    const { movement } = arena;
    // Row 0 is blocked: the body top must stay at or below y = 32, wherever the position and the body center are.
    const edge = TILE + physicalBodyRect({ x: 0, y: 0 }).height / 2 - BODY_CENTER_OFFSET.y;
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
    expect(movement.autoWalk?.goal).toEqual(positionForBodyTile({ tx: peerTx - 1, ty: peerTy }));
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

describe('auto-walk around walls and desks (#219, #221)', () => {
  type Arena = Awaited<ReturnType<typeof movementArena>>;

  /** Steps real frames until the walk ends (arrival, stall cancel) or the budget runs out. */
  function walkUntilDone(arena: Arena, maxFrames = 1500) {
    for (let i = 0; i < maxFrames && arena.movement.autoWalk !== undefined; i++) arena.frame();
  }

  /** What `buildTerrainGrid` does with them: every tile a rectangle touches is blocked for the tile helpers. */
  function blockTouchedTiles(movement: Arena['movement'], rects: readonly { x: number; y: number; w: number; h: number }[]) {
    const covered = coveredTiles(rects, 3200, 100);
    movement.grid.solid = movement.grid.terrainSolid.map((row, ty) => row.map((blocked, tx) => blocked || covered[ty * 3200 + tx]!));
  }

  function overlaps(body: { x: number; y: number; width: number; height: number }, rect: { x: number; y: number; w: number; h: number }) {
    return rect.x < body.x + body.width && body.x < rect.x + rect.w && rect.y < body.y + body.height && body.y < rect.y + rect.h;
  }

  /**
   * A room whose walls run on the grid lines from vertex (20,3) to (26,9),
   * its bottom wall missing the post at (23,9): a one-post door. The walls go
   * in as the scene builds them: Arcade bodies, and the tiles they touch
   * blocked in `grid.solid`.
   */
  function walledRoom(arena: Arena) {
    const { movement } = arena;
    const width = 3200;
    const walls: (string | null)[] = Array(width * 100).fill(null);
    for (let i = 3; i <= 9; i++) walls[i * width + 20] = walls[i * width + 26] = 'wall-brick';
    for (let i = 20; i <= 26; i++) walls[3 * width + i] = walls[9 * width + i] = 'wall-brick';
    walls[9 * width + 23] = null;
    movement.grid.wallRects = wallColliderRects({ width, height: 100, walls });
    blockTouchedTiles(movement, movement.grid.wallRects);
    movement.buildTerrainColliders(movement.grid);
  }

  it('a double click walks from the corridor into a walled room through its door, and back out (#221)', async () => {
    const arena = await movementArena();
    const { player, movement, body } = arena;
    walledRoom(arena);
    const outside = positionForBodyTile({ tx: 23, ty: 12 });
    const inside = positionForBodyTile({ tx: 24, ty: 4 });
    body.reset(outside.x, outside.y);

    for (const goal of [inside, outside]) {
      arena.doubleClick(goal.x, goal.y);
      expect(movement.autoWalk, `a walk toward ${JSON.stringify(goal)}`).toBeDefined();
      walkUntilDone(arena);
      expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
    }
  });

  it('a double click reaches the floor along the inside of a wall (#221)', async () => {
    const arena = await movementArena();
    const { player, movement, body } = arena;
    walledRoom(arena);
    const start = positionForBodyTile({ tx: 23, ty: 6 });
    body.reset(start.x, start.y);
    // Tile (22,3) touches the top wall: blocked for the tile helpers, but the body fits on it.
    const goal = positionForBodyTile({ tx: 22, ty: 3 });

    arena.doubleClick(goal.x, goal.y);
    expect(movement.autoWalk).toBeDefined();
    walkUntilDone(arena);
    expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
  });

  it('walkToPeer lands on the approach tile next to the peer\'s desk, its body clear of the desk (#219)', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const { player, movement, bridge, body } = arena;
    const peerTx = 30;
    const peerTy = 9;
    // The desk the peer works at runs under the peer and its approach tile.
    const desk = { x: (peerTx - 2) * TILE, y: (peerTy + 1) * TILE, w: 4 * TILE, h: TILE };
    movement.collisionRects = [desk];
    movement.buildPieceColliders();
    blockTouchedTiles(movement, [desk]);
    const start = positionForBodyTile({ tx: peerTx - 8, ty: peerTy });
    body.reset(start.x, start.y);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerTx * TILE + 16, y: peerTy * TILE + 16 }));

    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    const goal = movement.autoWalk?.goal;
    expect(goal).toBeDefined();
    walkUntilDone(arena);

    expect(Math.hypot(player.x - goal!.x, player.y - goal!.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
    expect(Math.floor(player.x / TILE)).toBe(peerTx - 1);
    expect(overlaps(physicalBodyRect(player), desk)).toBe(false);
  });

  /**
   * An own desk at tiles (20..22, 9..11), centered on (21, 10), with `chairs`
   * on it (tile coordinates) and a free chair off the desk nearer the walker.
   */
  function ownDesk(
    arena: Arena,
    connector: ReturnType<typeof fakeConnector>,
    chairs: readonly { tx: number; ty: number }[],
    mine = true,
    start = { tx: 8, ty: 10 },
  ) {
    const desk: OfficeDesk = {
      id: 'id-mi-mesa', label: 'Mesa 1', x: 20 * TILE, y: 9 * TILE, w: 3 * TILE, h: 3 * TILE,
      occupant: mine ? { id: 'id-yo', displayName: 'Yo' } : null, mine,
    };
    const decoyChair = 10 * BASE_LAYOUT.width + 12;
    arena.bridge.emitCommand('desks', { desks: [desk] });
    connector.handlers()!.onDecor?.([
      { index: decoyChair, piece: 'chair-wood', rotation: 0 },
      ...chairs.map(({ tx, ty }) => ({ index: ty * BASE_LAYOUT.width + tx, piece: 'chair-wood', rotation: 0 as const })),
    ]);
    arena.movement.collisionRects = [];
    arena.movement.buildPieceColliders();
    const at = positionForBodyTile(start);
    arena.body.reset(at.x, at.y);
    arena.frame();
  }

  const DESK_CENTER = { tx: 21, ty: 10 };

  it('walkToOwnDesk sits on the chair at the own desk center, not on a nearer free chair', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    ownDesk(arena, connector, [DESK_CENTER]);

    arena.bridge.emitCommand('walkToOwnDesk', undefined);
    expect(arena.movement.autoWalk).toBeDefined();
    walkUntilDone(arena);
    arena.frame();

    expect(connector.sits).toEqual([chairSeatId(DESK_CENTER.ty * BASE_LAYOUT.width + DESK_CENTER.tx)]);
  });

  it('walkToOwnDesk with several chairs on the desk sits on the center one, even with another nearer (#250)', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    // The west chair is the one nearest a walker coming from the west.
    ownDesk(arena, connector, [{ tx: 20, ty: 10 }, DESK_CENTER, { tx: 22, ty: 10 }]);

    arena.bridge.emitCommand('walkToOwnDesk', undefined);
    walkUntilDone(arena);
    arena.frame();

    expect(connector.sits).toEqual([chairSeatId(DESK_CENTER.ty * BASE_LAYOUT.width + DESK_CENTER.tx)]);
  });

  it.each([
    { side: 'west', start: { tx: 8, ty: 10 } },
    { side: 'south-east', start: { tx: 30, ty: 14 } },
  ])('walkToOwnDesk from the $side lands on the desk center tile when no chair stands there (#250)', async ({ start }) => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    ownDesk(arena, connector, [{ tx: 20, ty: 9 }, { tx: 22, ty: 11 }], true, start);

    arena.bridge.emitCommand('walkToOwnDesk', undefined);
    walkUntilDone(arena);
    arena.frame();

    const center = positionForBodyTile(DESK_CENTER);
    expect(Math.hypot(arena.player.x - center.x, arena.player.y - center.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
    expect(connector.sits).toEqual([]);
  });

  describe('locked spaces', () => {
    const SALA = { id: 'sala', name: 'Sala 1', x: 20 * TILE, y: 6 * TILE, w: 4 * TILE, h: 4 * TILE };

    it('undoes the step into a locked space from outside, ends the walk and says so once per attempt', async () => {
      const connector = fakeConnector('mi-sesion');
      const arena = await movementArena(connector);
      const told: unknown[] = [];
      arena.bridge.on('spacelocked', (payload) => told.push(payload));
      arena.bridge.emitCommand('spacesconfig', { spaces: [SALA], version: 'v1' });
      connector.handlers()!.onLockedSpaces?.(new Map([['sala', 'otra-sesion']]));
      const start = positionForBodyTile({ tx: 17, ty: 7 });
      arena.body.reset(start.x, start.y);

      arena.doubleClick(SALA.x + 2 * TILE, start.y);
      walkUntilDone(arena);
      expect(arena.movement.autoWalk).toBeUndefined();
      expect(told).toEqual([{ spaceId: 'sala' }]);

      // A second attempt, pushed for many frames, says it once more.
      arena.frame();
      arena.movement.cursors.right.isDown = true;
      arena.walk(400);
      arena.movement.cursors.right.isDown = false;

      expect(arena.player.x).toBeLessThan(SALA.x);
      expect(told).toEqual([{ spaceId: 'sala' }, { spaceId: 'sala' }]);
    });

    it('says a space is locked to whoever pushes at its door from outside, even held back by the post beside it', async () => {
      const connector = fakeConnector('mi-sesion');
      const arena = await movementArena(connector);
      const told: unknown[] = [];
      arena.bridge.on('spacelocked', (payload) => told.push(payload));
      arena.bridge.emitCommand('spacesconfig', { spaces: [SALA], version: 'v1' });
      // The room's door on its bottom line (y = 10 * TILE), over tiles 21..22, and the post at the east end of its span.
      connector.handlers()!.onDecor?.([{ index: 10 * BASE_LAYOUT.width + 21, piece: 'door-wood', rotation: 0 }]);
      arena.movement.collisionRects = [{ x: 23 * TILE - 8, y: 10 * TILE - 8, w: 16, h: 16 }];
      arena.movement.buildPieceColliders();
      connector.handlers()!.onLockedSpaces?.(new Map([['sala', 'otra-sesion']]));
      // Lined up with the door against its east end, right under the post.
      arena.body.reset(23 * TILE - 4, 10 * TILE + 20);
      arena.frame();

      arena.movement.cursors.up.isDown = true;
      arena.walk(400);
      arena.movement.cursors.up.isDown = false;

      expect(arena.player.y).toBeGreaterThanOrEqual(SALA.y + SALA.h);
      expect(told).toEqual([{ spaceId: 'sala' }]);
    });

    it('lets whoever is inside a locked space walk out of it', async () => {
      const connector = fakeConnector('mi-sesion');
      const arena = await movementArena(connector);
      arena.bridge.emitCommand('spacesconfig', { spaces: [SALA], version: 'v1' });
      const start = positionForBodyTile({ tx: 21, ty: 7 });
      arena.body.reset(start.x, start.y);
      arena.frame();
      connector.handlers()!.onLockedSpaces?.(new Map([['sala', 'otra-sesion']]));

      arena.movement.cursors.left.isDown = true;
      arena.walk(800);
      arena.movement.cursors.left.isDown = false;

      expect(arena.player.x).toBeLessThan(SALA.x);
    });

    it('tells whether the own space is locked and by whom, and asks the room to lock and unlock it', async () => {
      const connector = fakeConnector('mi-sesion');
      const arena = await movementArena(connector);
      const states: unknown[] = [];
      arena.bridge.on('roomlock', (payload) => states.push(payload));
      arena.bridge.emitCommand('spacesconfig', { spaces: [SALA], version: 'v1' });
      const start = positionForBodyTile({ tx: 21, ty: 7 });
      arena.body.reset(start.x, start.y);
      // Standing still long enough for a proximity tick to place the player in the space.
      arena.walk(300);

      arena.bridge.emitCommand('lockRoom', undefined);
      expect(connector.locks()).toBe(1);
      connector.handlers()!.onLockedSpaces?.(new Map([['sala', 'mi-sesion']]));
      arena.bridge.emitCommand('unlockRoom', undefined);
      expect(connector.unlocks()).toBe(1);
      connector.handlers()!.onLockedSpaces?.(new Map());
      connector.handlers()!.onLockedSpaces?.(new Map([['sala', 'otra-sesion']]));

      expect(states).toEqual([{ locked: true, mine: true }, { locked: false, mine: false }, { locked: true, mine: false }]);
    });
  });

  it('walkToOwnDesk does nothing without an own desk', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    ownDesk(arena, connector, [DESK_CENTER], false);

    arena.bridge.emitCommand('walkToOwnDesk', undefined);

    expect(arena.movement.autoWalk).toBeUndefined();
    expect(connector.sits).toEqual([]);
  });

  it('walkToPeer from a body pressed against a desk walks around it instead of into it (#219)', async () => {
    const connector = fakeConnector('mi-sesion');
    const arena = await movementArena(connector);
    const { player, movement, bridge, body } = arena;
    // A desk thinner than a tile, the walker touching its bottom edge and the peer beyond it.
    const desk = { x: 20 * TILE, y: 10 * TILE + 8, w: 4 * TILE, h: 16 };
    movement.collisionRects = [desk];
    movement.buildPieceColliders();
    blockTouchedTiles(movement, [desk]);
    const bodyBox = physicalBodyRect({ x: 0, y: 0 });
    body.reset(22 * TILE, desk.y + desk.h - bodyBox.y);
    expect(physicalBodyRect(player).y).toBe(desk.y + desk.h);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 22 * TILE + 16, y: 5 * TILE + 16 }));

    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    const goal = movement.autoWalk?.goal;
    expect(goal).toBeDefined();
    walkUntilDone(arena);

    expect(Math.hypot(player.x - goal!.x, player.y - goal!.y)).toBeLessThanOrEqual(ARRIVE_EPSILON_PX);
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

  it('a middle button click clears the pair (R2)', async () => {
    const arena = await movementArena();

    expectNoPair(arena, () => {
      const pointer = { button: 1, camera: arena.scene.cameras.main, x: 10, y: 10,
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

  it('a held layout editor never walks and clears the pair (R2)', async () => {
    const arena = await movementArena();

    arena.click(goal.x, goal.y);
    arena.bridge.emitCommand('layoutedit', { pickable: [], selectedId: 'desk-1', placing: null });
    arena.doubleClick(goal.x, goal.y);
    expect(arena.movement.autoWalk).toBeUndefined();

    arena.bridge.emitCommand('layoutedit', null);
    arena.click(goal.x, goal.y);
    expect(arena.movement.autoWalk, 'the click made while editing was not a first click').toBeUndefined();
  });

  it('an open layout editor with nothing selected still walks on a double click', async () => {
    const arena = await movementArena();

    arena.bridge.emitCommand('layoutedit', { pickable: [], selectedId: null, placing: null });
    arena.doubleClick(goal.x, goal.y);

    expect(arena.movement.autoWalk?.goal).toEqual(goal);
    arena.bridge.emitCommand('layoutedit', null);
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
