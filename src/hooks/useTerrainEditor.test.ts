/**
 * The terrain editor's lifecycle (#123 phase 2, floor palette): what it asks
 * the map to show through `terrainedit`, how a picked floor turns map clicks
 * into block paints, and what it tells the admin.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import { BASE_LAYOUT, MAX_WALL_EDITS, withBlock, withTerrainColors, withWalls, type LayoutMaterial, type TerrainColors, type WallEdit } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { WALL_UNDER_PLACEMENT_MESSAGE, useTerrainEditor } from './useTerrainEditor';

const floor = (material: LayoutMaterial): TerrainBrush => ({ kind: 'floor', material });

const LAWN = 35;
const NO_COLORS: TerrainColors = new Map();
const OTHER = 36;

function port(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return {
    setBlock: vi.fn(async () => undefined),
    setBlocks: vi.fn(async () => undefined),
    setWalls: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setup(terrain: TerrainAdminPort = port()) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const view = renderHook(() => useTerrainEditor({ bridge, terrain }));
  return { bridge, terrain, commands, ...view };
}

/** A deferred `setBlock`, resolved or rejected by the test. */
function deferredPort() {
  const calls: { index: number; material: string; color?: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const terrain = port({
    setBlock: vi.fn(
      (index, material, color?: string) =>
        new Promise<void>((resolve, reject) => calls.push({ index, material, ...(color === undefined ? {} : { color }), resolve, reject })),
    ),
  });
  return { terrain, calls };
}

describe('useTerrainEditor', () => {
  it('starts closed and says nothing to the map', () => {
    const { result, commands } = setup();

    expect(result.current.active).toBe(false);
    expect(commands).toEqual([]);
  });

  it('opens with no floor picked, takes the live blocks the scene answers with, and closes the map overlay on exit', () => {
    const { bridge, result, commands } = setup();
    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    bridge.onCommand('terrainedit', (command) => {
      if (command !== null) bridge.emit('terrain', { blocks: watered, walls: BASE_LAYOUT.walls, colors: NO_COLORS });
    });

    act(() => result.current.enter());

    expect(result.current.active).toBe(true);
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null });
    expect(result.current.blocks[LAWN]).toBe('water');

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('picks a floor, unpicks it on a second pick or on demand, and tells the map', () => {
    const { result, commands } = setup();
    act(() => result.current.enter());

    act(() => result.current.pick('grass'));
    expect(result.current.brush).toEqual(floor('grass'));
    expect(commands.at(-1)).toEqual({ brush: floor('grass') });

    act(() => result.current.pick('sand'));
    expect(result.current.brush).toEqual(floor('sand'));
    act(() => result.current.pick('sand'));
    expect(result.current.brush).toBeNull();

    act(() => result.current.pick('void'));
    act(() => result.current.unpick());
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null });
  });

  it('drops the picked floor on Escape', () => {
    const { result } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.brush).toBeNull();
  });

  it('closes on Escape with nothing picked, so the admin can walk again, and says so through onExit', () => {
    const bridge = createOfficeBridge();
    const commands: OfficeCommandMap['terrainedit'][] = [];
    bridge.onCommand('terrainedit', (command) => commands.push(command));
    const onExit = vi.fn();
    const { result } = renderHook(() => useTerrainEditor({ bridge, terrain: port(), onExit }));
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    const first = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(first);
    });
    expect(result.current.active).toBe(true);
    expect(onExit).not.toHaveBeenCalled();

    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(second);
    });

    expect(result.current.active).toBe(false);
    expect(commands.at(-1)).toBeNull();
    expect(onExit).toHaveBeenCalledTimes(1);
    // Both presses are the editor's: the sidebar must not also close its panel on them.
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
  });

  it('leaves an Escape another control already handled alone', () => {
    const onExit = vi.fn();
    const { result } = renderHook(() => useTerrainEditor({ bridge: createOfficeBridge(), terrain: port(), onExit }));
    act(() => result.current.enter());
    const handled = (event: KeyboardEvent): void => event.preventDefault();
    window.addEventListener('keydown', handled, { capture: true });

    try {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      });
    } finally {
      window.removeEventListener('keydown', handled, { capture: true });
    }

    expect(result.current.active).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('ignores map clicks while closed or with no floor picked', () => {
    const { bridge, result, terrain } = setup();

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));

    expect(terrain.setBlock).not.toHaveBeenCalled();
  });

  it('paints each clicked block with the picked floor, keeping it picked to paint many in a row', async () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'grass'], [OTHER, 'grass']]);
    expect(result.current.brush).toEqual(floor('grass'));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('sends one paint at a time, in click order, and draws the pending ones until the room shows them', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('wood'));

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    expect(calls.map((call) => call.index)).toEqual([LAWN]);
    expect(result.current.pending).toBe(true);
    expect(commands.at(-1)).toEqual({ brush: floor('wood'), previewBlocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood') });

    await act(async () => calls[0]!.resolve());
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    await act(async () => calls[1]!.resolve());
    await waitFor(() => expect(result.current.pending).toBe(false));
    // Saved but not shown yet by the room: still drawn.
    expect(commands.at(-1)?.previewBlocks).toBeDefined();

    act(() => bridge.emit('terrain', { blocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood'), walls: BASE_LAYOUT.walls, colors: NO_COLORS }));
    expect(commands.at(-1)).toEqual({ brush: floor('wood') });
  });

  it('skips a click on a block that already has, or is about to have, the picked floor', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick(BASE_LAYOUT.blocks[LAWN]!));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(calls).toEqual([]);

    act(() => result.current.pick('sand'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(calls).toHaveLength(1);
  });

  it('keeps the central entrance block wood, saying why, without asking the server', () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('void'));

    act(() => bridge.emit('terrainpick', { index: SPAWN_BLOCK_INDEX }));

    expect(terrain.setBlock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/entrada.*madera/);
  });

  it('shows why the server refused a paint, drops only that paint and goes on with the rest', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('water'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));

    expect(result.current.error).toMatch(/otro bloque/);
    expect(result.current.brush).toEqual(floor('water'));
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    expect(commands.at(-1)).toEqual({ brush: floor('water'), previewBlocks: withBlock(BASE_LAYOUT.blocks, OTHER, 'water') });
    await act(async () => calls[1]!.resolve());
  });

  it('stops painting for good once authorization or configuration disappears', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await act(async () => calls[0]!.reject(new AdminError('forbidden')));
    act(() => bridge.emit('terrainpick', { index: 40 }));

    expect(result.current.blocked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(commands.at(-1)).toEqual({ brush: floor('grass') });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('closes the overlay when unmounted while open', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.enter());

    unmount();

    expect(commands.at(-1)).toBeNull();
  });

  describe('walls', () => {
    const TILE_A = 22 * BASE_LAYOUT.width + 67;
    const TILE_B = TILE_A + 1;
    const TILE_C = TILE_A + 2;

    /** A deferred `setWalls`, resolved or rejected by the test. */
    function deferredWalls() {
      const calls: { edits: readonly WallEdit[]; resolve: () => void; reject: (error: unknown) => void }[] = [];
      const terrain = port({
        setWalls: vi.fn((edits: readonly WallEdit[]) => new Promise<void>((resolve, reject) => calls.push({ edits: [...edits], resolve, reject }))),
      });
      return { terrain, calls };
    }

    it('picks a wall or the wall eraser, one entry at a time across floors and walls, and tells the map', () => {
      const { result, commands } = setup();
      act(() => result.current.enter());

      act(() => result.current.pickWall('wall-brick'));
      expect(result.current.brush).toEqual({ kind: 'wall', piece: 'wall-brick' });
      expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });

      act(() => result.current.pick('grass'));
      expect(result.current.brush).toEqual(floor('grass'));
      act(() => result.current.pickWall(null));
      expect(result.current.brush).toEqual({ kind: 'wall', piece: null });
      act(() => result.current.pickWall(null));
      expect(result.current.brush).toBeNull();

      act(() => result.current.pickWall('wall-glass'));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.brush).toBeNull();
    });

    it('turns tile clicks into wall paints only with a wall brush, and block clicks into block paints only with a floor', async () => {
      const { bridge, result, terrain } = setup();
      act(() => result.current.enter());
      act(() => bridge.emit('wallpick', { index: TILE_A }));
      act(() => result.current.pick('grass'));
      act(() => bridge.emit('wallpick', { index: TILE_A }));
      act(() => result.current.pickWall('wall-stone'));
      act(() => bridge.emit('terrainpick', { index: LAWN }));
      act(() => bridge.emit('wallpick', { index: TILE_A }));

      await waitFor(() => expect(terrain.setWalls).toHaveBeenCalledTimes(1));
      expect(terrain.setWalls).toHaveBeenCalledWith([{ index: TILE_A, piece: 'wall-stone' }]);
      expect(terrain.setBlock).not.toHaveBeenCalled();
    });

    it('sends the wall paints queued meanwhile as one request, and draws them until the room shows them', async () => {
      const { terrain, calls } = deferredWalls();
      const { bridge, result, commands } = setup(terrain);
      act(() => result.current.enter());
      act(() => result.current.pickWall('wall-brick'));

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

    it('keeps block and wall paints in click order, and never sends one tile twice in a request', async () => {
      const { terrain, calls } = deferredWalls();
      const blocks = deferredPort();
      terrain.setBlock = blocks.terrain.setBlock;
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      act(() => result.current.pickWall('wall-brick'));
      act(() => bridge.emit('wallpick', { index: TILE_A }));
      act(() => result.current.pick('sand'));
      act(() => bridge.emit('terrainpick', { index: LAWN }));
      act(() => result.current.pickWall('wall-brick'));
      act(() => bridge.emit('wallpick', { index: TILE_B }));
      act(() => result.current.pickWall('wall-glass'));
      act(() => bridge.emit('wallpick', { index: TILE_B }));

      await act(async () => calls[0]!.resolve());
      expect(blocks.calls.map((call) => call.index)).toEqual([LAWN]);
      expect(calls).toHaveLength(1);
      await act(async () => blocks.calls[0]!.resolve());
      expect(calls[1]!.edits).toEqual([{ index: TILE_B, piece: 'wall-brick' }]);
      await act(async () => calls[1]!.resolve());
      expect(calls[2]!.edits).toEqual([{ index: TILE_B, piece: 'wall-glass' }]);
      await act(async () => calls[2]!.resolve());
    });

    it('caps one request at MAX_WALL_EDITS tiles', async () => {
      const { terrain, calls } = deferredWalls();
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      act(() => result.current.pickWall('wall-plaster'));
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
      act(() => result.current.enter());
      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: TILE_A, piece: 'wall-stone' }]), colors: NO_COLORS }));
      act(() => result.current.pickWall('wall-stone'));
      act(() => bridge.emit('wallpick', { index: TILE_A }));
      act(() => result.current.pickWall(null));
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
      act(() => result.current.enter());
      act(() => result.current.pickWall('wall-brick'));
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
  });

  describe('carpet color (#222)', () => {
    const RED = '#c0392b';
    const BLUE = '#3c6ac8';
    const carpet = (color?: string): TerrainBrush => ({ kind: 'floor', material: 'carpet', ...(color === undefined ? {} : { color }) });

    it('picks carpet in the color chosen so far, the default art until one is, and recolors the picked brush', () => {
      const { result, commands } = setup();
      act(() => result.current.enter());

      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toEqual(carpet());

      act(() => result.current.setColor('carpet', RED));
      expect(result.current.colors).toEqual({ carpet: RED });
      expect(result.current.brush).toEqual(carpet(RED));
      expect(commands.at(-1)).toEqual({ brush: carpet(RED) });

      act(() => result.current.pick('grass'));
      act(() => result.current.setColor('carpet', BLUE));
      expect(result.current.brush).toEqual(floor('grass'));
      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toEqual(carpet(BLUE));
      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toBeNull();
    });

    it('sends the color with each carpet paint, skipping a block already that carpet but not one in another color', async () => {
      const { terrain, calls } = deferredPort();
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      const carpeted = withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet'), OTHER, 'carpet');
      act(() => bridge.emit('terrain', { blocks: carpeted, walls: BASE_LAYOUT.walls, colors: new Map([[LAWN, RED], [OTHER, BLUE]]) }));
      act(() => result.current.pick('carpet'));
      act(() => result.current.setColor('carpet', RED));

      act(() => bridge.emit('terrainpick', { index: LAWN }));
      act(() => bridge.emit('terrainpick', { index: OTHER }));
      act(() => bridge.emit('terrainpick', { index: OTHER }));

      expect(calls.map(({ index, material, color }) => ({ index, material, color }))).toEqual([{ index: OTHER, material: 'carpet', color: RED }]);
      await act(async () => calls[0]!.resolve());
    });

    it('repaints a colored carpet block in the default art, without a color', async () => {
      const { bridge, result, terrain } = setup();
      act(() => result.current.enter());
      act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet'), walls: BASE_LAYOUT.walls, colors: new Map([[LAWN, RED]]) }));
      act(() => result.current.pick('carpet'));

      act(() => bridge.emit('terrainpick', { index: LAWN }));

      await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
      expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'carpet']]);
    });

    it('draws the pending colors over the live ones, and another floor or the eraser clears a block color', async () => {
      const { terrain, calls } = deferredPort();
      const { bridge, result, commands } = setup(terrain);
      act(() => result.current.enter());
      const live = new Map([[OTHER, BLUE], [40, BLUE]]);
      const blocks = withBlock(withBlock(BASE_LAYOUT.blocks, OTHER, 'carpet'), 40, 'carpet');
      act(() => bridge.emit('terrain', { blocks, walls: BASE_LAYOUT.walls, colors: live }));
      act(() => result.current.pick('carpet'));
      act(() => result.current.setColor('carpet', RED));

      act(() => bridge.emit('terrainpick', { index: LAWN }));
      expect(commands.at(-1)).toEqual({ brush: carpet(RED), previewBlocks: withBlock(blocks, LAWN, 'carpet'), previewColors: new Map([...live, [LAWN, RED]]) });

      act(() => result.current.pick('grass'));
      act(() => bridge.emit('terrainpick', { index: OTHER }));
      act(() => result.current.pick('void'));
      act(() => bridge.emit('terrainpick', { index: 40 }));

      const painted = withBlock(withBlock(withBlock(blocks, LAWN, 'carpet'), OTHER, 'grass'), 40, 'void');
      expect(commands.at(-1)).toEqual({ brush: floor('void'), previewBlocks: painted, previewColors: new Map([[LAWN, RED]]) });
      expect(commands.at(-1)?.previewColors).toEqual(withTerrainColors(live, [{ index: LAWN, material: 'carpet', color: RED }, { index: OTHER, material: 'grass' }, { index: 40, material: 'void' }]));

      await act(async () => calls[0]!.resolve());
      await act(async () => calls[1]!.resolve());
      await act(async () => calls[2]!.resolve());
      expect(calls.map(({ index, material, color }) => ({ index, material, color }))).toEqual([
        { index: LAWN, material: 'carpet', color: RED },
        { index: OTHER, material: 'grass', color: undefined },
        { index: 40, material: 'void', color: undefined },
      ]);
    });

    it('leaves the other floors uncolored: a color choice never reaches their brush, paint or preview', async () => {
      const { bridge, result, terrain, commands } = setup();
      act(() => result.current.enter());
      act(() => result.current.setColor('carpet', RED));
      act(() => result.current.pick('tile'));

      act(() => bridge.emit('terrainpick', { index: LAWN }));

      await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
      expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'tile']]);
      expect(result.current.brush).toEqual(floor('tile'));
      expect(commands.at(-1)).toEqual({ brush: floor('tile'), previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'tile') });
    });
  });
});
