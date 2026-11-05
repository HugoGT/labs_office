/**
 * The wall tool of "Decoración" (#224): what it asks the map to show through
 * `terrainedit`, how a picked wall turns map clicks into wall paints, and
 * what it tells the admin.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, MAX_WALL_EDITS, withWalls, type TerrainColors, type WallEdit } from '../game/officeLayout';
import { WALL_UNDER_PLACEMENT_MESSAGE, useWallEditor } from './useWallEditor';

const NO_COLORS: TerrainColors = new Map();
const TILE_A = 22 * BASE_LAYOUT.width + 67;
const TILE_B = TILE_A + 1;
const TILE_C = TILE_A + 2;
const DOOR = TILE_A + 10;

function port(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return {
    setBlock: vi.fn(async () => undefined),
    setBlocks: vi.fn(async () => undefined),
    setWalls: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** A deferred `setWalls`, resolved or rejected by the test. */
function deferredWalls() {
  const calls: { edits: readonly WallEdit[]; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const terrain = port({
    setWalls: vi.fn((edits: readonly WallEdit[]) => new Promise<void>((resolve, reject) => calls.push({ edits: [...edits], resolve, reject }))),
  });
  return { terrain, calls };
}

function setup(terrain: TerrainAdminPort | null = port()) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const view = renderHook(() => useWallEditor({ bridge, terrain }));
  return { bridge, terrain, commands, ...view };
}

describe('useWallEditor', () => {
  it('says nothing to the map until a wall is picked, and closes the overlay once nothing is left to show', () => {
    const { result, commands } = setup();
    expect(commands).toEqual([]);

    act(() => result.current.pick('wall-brick'));
    expect(result.current.brush).toEqual({ kind: 'wall', piece: 'wall-brick' });
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });

    act(() => result.current.pick(null));
    expect(result.current.brush).toEqual({ kind: 'wall', piece: null });
    act(() => result.current.pick(null));
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toBeNull();
  });

  it('puts the picked wall down on Escape, and leaves an Escape with nothing picked to the menu', () => {
    const { result } = setup();
    act(() => result.current.pick('wall-plaster'));

    const first = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(first);
    });
    expect(result.current.brush).toBeNull();
    expect(first.defaultPrevented).toBe(true);

    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
  });

  it('turns map clicks into wall paints only with a wall picked, until the menu resets it', async () => {
    const terrain = port();
    const { bridge, result } = setup(terrain);
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    expect(terrain.setWalls).not.toHaveBeenCalled();

    act(() => result.current.pick('wall-stone'));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    await waitFor(() => expect(terrain.setWalls).toHaveBeenCalledWith([{ index: TILE_A, piece: 'wall-stone' }]));

    act(() => result.current.reset());
    expect(result.current.brush).toBeNull();
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    expect(terrain.setWalls).toHaveBeenCalledTimes(1);
  });

  it('picks nothing without a terrain port', () => {
    const { result, commands } = setup(null);
    act(() => result.current.pick('wall-brick'));
    expect(result.current.brush).toBeNull();
    expect(commands).toEqual([]);
  });

  it('sends the wall paints queued meanwhile as one request, and draws them until the room shows them', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.pick('wall-brick'));

    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    act(() => bridge.emit('wallpick', { index: TILE_C }));

    expect(calls.map((call) => call.edits)).toEqual([[{ index: TILE_A, piece: 'wall-brick' }]]);
    expect(commands.at(-1)).toEqual({
      brush: { kind: 'wall', piece: 'wall-brick' },
      previewWalls: [TILE_A, TILE_B, TILE_C].map((index) => ({ index, piece: 'wall-brick' })),
    });

    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toEqual([{ index: TILE_B, piece: 'wall-brick' }, { index: TILE_C, piece: 'wall-brick' }]);
    await act(async () => calls[1]!.resolve());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(commands.at(-1)?.previewWalls).toHaveLength(3);

    const shown = withWalls(BASE_LAYOUT.walls, [TILE_A, TILE_B, TILE_C].map((index) => ({ index, piece: 'wall-brick' as const })));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: shown, colors: NO_COLORS }));
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });
    expect(result.current.walls[TILE_B]).toBe('wall-brick');
  });

  it('keeps the overlay drawing paints still on their way after the wall is put down', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.pick('wall-brick'));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => result.current.unpick());

    expect(commands.at(-1)).toEqual({ brush: null, previewWalls: [{ index: TILE_A, piece: 'wall-brick' }] });
    await act(async () => calls[0]!.resolve());
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: TILE_A, piece: 'wall-brick' }]), colors: NO_COLORS }));
    expect(commands.at(-1)).toBeNull();
  });

  it('never sends one tile twice in a request', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result } = setup(terrain);
    act(() => result.current.pick('wall-brick'));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    act(() => result.current.pick('wall-plaster'));
    act(() => bridge.emit('wallpick', { index: TILE_B }));

    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toEqual([{ index: TILE_B, piece: 'wall-brick' }]);
    await act(async () => calls[1]!.resolve());
    expect(calls[2]!.edits).toEqual([{ index: TILE_B, piece: 'wall-plaster' }]);
    await act(async () => calls[2]!.resolve());
  });

  it('caps one request at MAX_WALL_EDITS tiles', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result } = setup(terrain);
    act(() => result.current.pick('wall-plaster'));
    act(() => {
      for (let index = 0; index <= MAX_WALL_EDITS + 1; index += 1) bridge.emit('wallpick', { index });
    });

    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toHaveLength(MAX_WALL_EDITS);
    await act(async () => calls[1]!.resolve());
    expect(calls[2]!.edits).toEqual([{ index: MAX_WALL_EDITS + 1, piece: 'wall-plaster' }]);
    await act(async () => calls[2]!.resolve());
  });

  it('skips a tile that already has, or is about to have, the picked wall, and erasing where there is none', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result } = setup(terrain);
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: TILE_A, piece: 'wall-stone' }]), colors: NO_COLORS }));
    act(() => result.current.pick('wall-stone'));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => result.current.pick(null));
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    expect(calls).toEqual([]);

    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: TILE_A, piece: null }]]);
    await act(async () => calls[0]!.resolve());
  });

  it('drops a refused wall request, says why in wall terms, and goes on with the rest', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.pick('wall-brick'));
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => bridge.emit('wallpick', { index: TILE_B }));

    await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));

    expect(result.current.error).toBe(WALL_UNDER_PLACEMENT_MESSAGE);
    expect(calls[1]!.edits).toEqual([{ index: TILE_B, piece: 'wall-brick' }]);
    expect(commands.at(-1)?.previewWalls).toEqual([{ index: TILE_B, piece: 'wall-brick' }]);
    await act(async () => calls[1]!.reject(new AdminError('forbidden')));
    expect(result.current.blocked).toBe(true);
    expect(result.current.error).toMatch(/permiso/i);
  });

  it('erases the posts around a protected one: a batch refused as a whole is sent again post by post (#223)', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result } = setup(terrain);
    const standing = [TILE_A, TILE_B, TILE_C, TILE_C + 1].map((index) => ({ index, piece: 'wall-stone' as const }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, standing), colors: NO_COLORS }));
    act(() => result.current.pick(null));
    // A drag faster than the server: the first post is in flight while the next three queue up, one of them a door's.
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    act(() => bridge.emit('wallpick', { index: TILE_C }));
    act(() => bridge.emit('wallpick', { index: TILE_C + 1 }));
    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits.map(({ index }) => index)).toEqual([TILE_B, TILE_C, TILE_C + 1]);

    await act(async () => calls[1]!.reject(new AdminError('terrain-under-placement')));
    expect(calls[2]!.edits).toEqual([{ index: TILE_B, piece: null }]);
    await act(async () => calls[2]!.reject(new AdminError('terrain-under-placement')));
    expect(calls[3]!.edits).toEqual([{ index: TILE_C, piece: null }]);
    await act(async () => calls[3]!.resolve());
    expect(calls[4]!.edits).toEqual([{ index: TILE_C + 1, piece: null }]);
    await act(async () => calls[4]!.resolve());

    expect(calls).toHaveLength(5);
    expect(result.current.error).toBe(WALL_UNDER_PLACEMENT_MESSAGE);
  });

  it('closes the overlay when it unmounts', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.pick('wall-brick'));
    unmount();
    expect(commands.at(-1)).toBeNull();
  });
});

describe('WALL_UNDER_PLACEMENT_MESSAGE (#223)', () => {
  it('names the doors among what a wall may not cover, and promises no post stays: the eraser takes its door along', () => {
    expect(WALL_UNDER_PLACEMENT_MESSAGE).toMatch(/puerta/);
    expect(WALL_UNDER_PLACEMENT_MESSAGE).not.toMatch(/cambia|poste/);
  });
});

describe('useWallEditor: what the eraser would take (#241)', () => {
  it('tells the map, only with the eraser picked, every wall standing once pending paints land, and every door, window and decor piece', async () => {
    const bridge = createOfficeBridge();
    const commands: OfficeCommandMap['terrainedit'][] = [];
    bridge.onCommand('terrainedit', (command) => commands.push(command));
    const { terrain, calls } = deferredWalls();
    const empty = BASE_LAYOUT.walls.map(() => null);
    const { result } = renderHook(() => useWallEditor({ bridge, terrain, eraseDecor: () => false }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(empty, [{ index: TILE_A, piece: 'wall-stone' }, { index: TILE_B, piece: 'wall-brick' }]), colors: NO_COLORS }));
    // A door or a chair is taken by a tile under it, not by the walls it needs.
    act(() => bridge.emit('decor', { items: [{ index: DOOR, piece: 'door-wood', rotation: 0 }, { index: TILE_C, piece: 'chair-office', rotation: 0 }] }));

    act(() => result.current.pick('wall-brick'));
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });

    act(() => result.current.pick(null));
    expect(commands.at(-1)?.erasable).toEqual([TILE_A, TILE_B]);
    // The door is outlined whole, its span by the wall's three rows, like the chair by its tile.
    expect(commands.at(-1)?.erasableDecor).toEqual([{ x0: 77, y0: 21, x1: 78, y1: 23 }, { x0: 69, y0: 22, x1: 69, y1: 22 }]);

    // An erase on its way already leaves its wall with nothing to take.
    act(() => bridge.emit('wallpick', { index: TILE_A }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(commands.at(-1)?.erasable).toEqual([TILE_B]);
  });

  it('erases a wall from any of its three tiles, and nothing from a tile no wall covers', async () => {
    const bridge = createOfficeBridge();
    const { terrain, calls } = deferredWalls();
    const empty = BASE_LAYOUT.walls.map(() => null);
    const W = BASE_LAYOUT.width;
    const { result } = renderHook(() => useWallEditor({ bridge, terrain, eraseDecor: () => false }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(empty, [{ index: TILE_A, piece: 'wall-stone' }, { index: TILE_C, piece: 'wall-brick' }]), colors: NO_COLORS }));
    act(() => result.current.pick(null));

    // Two tiles above the wall: nothing covers it, nothing is sent.
    act(() => bridge.emit('wallpick', { index: TILE_A - 2 * W }));
    // The tile above the wall on TILE_A takes that wall.
    act(() => bridge.emit('wallpick', { index: TILE_A - W }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.edits).toEqual([{ index: TILE_A, piece: null }]);
    await act(async () => calls[0]!.resolve());

    // The tile below the wall on TILE_C takes that one.
    act(() => bridge.emit('wallpick', { index: TILE_C + W }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.edits).toEqual([{ index: TILE_C, piece: null }]);
  });

  it('paints a picked wall on the tile under the pointer: that tile is its middle', async () => {
    const bridge = createOfficeBridge();
    const { terrain, calls } = deferredWalls();
    const { result } = renderHook(() => useWallEditor({ bridge, terrain, eraseDecor: () => false }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: BASE_LAYOUT.walls.map(() => null), colors: NO_COLORS }));
    act(() => result.current.pick('wall-plaster'));

    act(() => bridge.emit('wallpick', { index: TILE_B }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.edits).toEqual([{ index: TILE_B, piece: 'wall-plaster' }]);
  });
});

describe('useWallEditor: erasing a wall a door or window needs', () => {
  const RUN = [DOOR - 1, DOOR, DOOR + 1, DOOR + 2, DOOR + 3];

  function onRun(eraseDoors: (anchors: readonly number[]) => Promise<boolean>) {
    const bridge = createOfficeBridge();
    const { terrain, calls } = deferredWalls();
    const walls = withWalls(BASE_LAYOUT.walls.map(() => null), RUN.map((index) => ({ index, piece: 'wall-brick' as const })));
    const { result } = renderHook(() => useWallEditor({ bridge, terrain, eraseDecor: () => false, eraseDoors }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls, colors: NO_COLORS }));
    act(() => bridge.emit('decor', { items: [{ index: DOOR, piece: 'door-wood', rotation: 0 }] }));
    act(() => result.current.pick(null));
    return { bridge, calls };
  }

  it('sends the door first, then in one request the wall and the two tiles the door stood on', async () => {
    let doorsGone: (gone: boolean) => void = () => {};
    const eraseDoors = vi.fn(() => new Promise<boolean>((resolve) => (doorsGone = resolve)));
    const { bridge, calls } = onRun(eraseDoors);

    act(() => bridge.emit('wallpick', { index: DOOR - 1, tile: DOOR - 1 }));
    expect(eraseDoors).toHaveBeenCalledWith([DOOR]);
    await act(async () => undefined);
    // The room refuses a wall while its door stands: nothing leaves until the door has.
    expect(calls).toHaveLength(0);

    await act(async () => doorsGone(true));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.edits).toEqual([
      { index: DOOR - 1, piece: null },
      { index: DOOR, piece: null },
      { index: DOOR + 1, piece: null },
    ]);
  });

  it('leaves the walls standing when the door could not go', async () => {
    const { bridge, calls } = onRun(async () => false);
    act(() => bridge.emit('wallpick', { index: DOOR + 2, tile: DOOR + 2 }));
    await act(async () => undefined);
    expect(calls).toHaveLength(0);
  });

  it('asks nothing of the doors for a wall none of them needs', async () => {
    const eraseDoors = vi.fn(async () => true);
    const { bridge, calls } = onRun(eraseDoors);
    act(() => bridge.emit('wallpick', { index: DOOR + 3, tile: DOOR + 3 }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.edits).toEqual([{ index: DOOR + 3, piece: null }]);
    expect(eraseDoors).not.toHaveBeenCalled();
  });
});

describe('useWallEditor: the eraser over decor', () => {
  it('asks the decor first with the post and the tile under the pointer, and leaves the post alone when the decor took something', () => {
    const terrain = port();
    const bridge = createOfficeBridge();
    const eraseDecor = vi.fn((_post: number, tile: number | null) => tile === TILE_C);
    const { result } = renderHook(() => useWallEditor({ bridge, terrain, eraseDecor }));
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls.map(() => null), [{ index: TILE_A, piece: 'wall-stone' }]), colors: NO_COLORS }));
    act(() => result.current.pick(null));

    act(() => bridge.emit('wallpick', { index: TILE_A, tile: TILE_C }));
    expect(eraseDecor).toHaveBeenLastCalledWith(TILE_A, TILE_C);
    expect(terrain.setWalls).not.toHaveBeenCalled();

    act(() => bridge.emit('wallpick', { index: TILE_A, tile: TILE_B }));
    expect(eraseDecor).toHaveBeenLastCalledWith(TILE_A, TILE_B);
    expect(terrain.setWalls).toHaveBeenCalledWith([{ index: TILE_A, piece: null }]);
  });

  it('never asks the decor while a wall is painted', () => {
    const bridge = createOfficeBridge();
    const eraseDecor = vi.fn(() => true);
    const { result } = renderHook(() => useWallEditor({ bridge, terrain: port(), eraseDecor }));
    act(() => result.current.pick('wall-brick'));
    act(() => bridge.emit('wallpick', { index: TILE_A, tile: TILE_C }));
    expect(eraseDecor).not.toHaveBeenCalled();
  });
});

describe('useWallEditor: space outlines (#216)', () => {
  it('keeps the outlines of "Decoración" on the map while a wall is picked, and takes them with it', () => {
    const bridge = createOfficeBridge();
    const commands: OfficeCommandMap['terrainedit'][] = [];
    bridge.onCommand('terrainedit', (command) => commands.push(command));
    const outlines = [{ x0: 2, y0: 3, x1: 5, y1: 6 }];
    const { result } = renderHook(() => useWallEditor({ bridge, terrain: port(), outlines }));

    act(() => result.current.pick('wall-brick'));
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' }, outlines });

    act(() => result.current.reset());
    expect(commands.at(-1)).toBeNull();
  });
});

describe('useWallEditor colors', () => {
  afterEach(() => window.localStorage.clear());

  it('picks plaster in the color settled on its tile, remembers it, and paints and previews walls in it', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result, commands } = setup(terrain);

    act(() => result.current.setColor('wall-plaster', '#123456'));
    expect(result.current.brush).toEqual({ kind: 'wall', piece: 'wall-plaster', color: '#123456' });
    expect(result.current.colors).toEqual({ 'wall-plaster': '#123456' });
    expect(JSON.parse(window.localStorage.getItem('office:wall-colors') ?? '{}')).toEqual({ 'wall-plaster': '#123456' });

    act(() => bridge.emit('wallpick', { index: TILE_A }));
    expect(calls[0]!.edits).toEqual([{ index: TILE_A, piece: 'wall-plaster', color: '#123456' }]);
    expect(commands.at(-1)).toMatchObject({ previewWalls: [{ index: TILE_A, piece: 'wall-plaster', color: '#123456' }] });
    await act(async () => calls[0]!.resolve());

    // Put down and picked again, plaster comes back in its remembered color.
    act(() => result.current.unpick());
    act(() => result.current.pick('wall-plaster'));
    expect(result.current.brush).toEqual({ kind: 'wall', piece: 'wall-plaster', color: '#123456' });
  });

  it('repaints a plaster wall the room shows in another color, and skips one already in the brush color', async () => {
    const { terrain, calls } = deferredWalls();
    const { bridge, result } = setup(terrain);
    const walls = withWalls(BASE_LAYOUT.walls, [{ index: TILE_A, piece: 'wall-plaster' }, { index: TILE_B, piece: 'wall-plaster' }]);
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls, colors: NO_COLORS, wallColors: new Map([[TILE_A, '#aa0000'], [TILE_B, '#123456']]) }));

    act(() => result.current.setColor('wall-plaster', '#123456'));
    act(() => bridge.emit('wallpick', { index: TILE_B }));
    act(() => bridge.emit('wallpick', { index: TILE_A }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.edits).toEqual([{ index: TILE_A, piece: 'wall-plaster', color: '#123456' }]);
    await act(async () => calls[0]!.resolve());
  });

  it('never gives a color to a wall that takes none', () => {
    const { result } = setup();
    act(() => result.current.setColor('wall-brick', '#123456'));
    expect(result.current.brush).toBeNull();
    act(() => result.current.pick('wall-brick'));
    expect(result.current.brush).toEqual({ kind: 'wall', piece: 'wall-brick' });
  });

  it('holds the rail while the picker of its tile is open', () => {
    const { result, commands } = setup();
    act(() => result.current.pick('wall-plaster'));
    act(() => result.current.setPickingColor(true));
    expect(commands.at(-1)).toMatchObject({ pickingColor: true });
    act(() => result.current.setPickingColor(false));
    expect(commands.at(-1)).not.toHaveProperty('pickingColor');
  });
});
