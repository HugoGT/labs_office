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
import { BASE_LAYOUT, MAX_WALL_EDITS, withBlock, withWalls, type LayoutMaterial, type WallEdit } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { MAX_CHAIR_EDITS, type ChairEdit } from '../game/seating';
import { CHAIR_UNDER_PLACEMENT_MESSAGE, WALL_UNDER_PLACEMENT_MESSAGE, useTerrainEditor } from './useTerrainEditor';

const floor = (material: LayoutMaterial): TerrainBrush => ({ kind: 'floor', material });

const LAWN = 35;
const OTHER = 36;

function port(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return {
    setBlock: vi.fn(async () => undefined),
    setBlocks: vi.fn(async () => undefined),
    setWalls: vi.fn(async () => undefined),
    setChairs: vi.fn(async () => undefined),
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
  const calls: { index: number; material: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const terrain = port({
    setBlock: vi.fn((index, material) => new Promise<void>((resolve, reject) => calls.push({ index, material, resolve, reject }))),
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
      if (command !== null) bridge.emit('terrain', { blocks: watered, walls: BASE_LAYOUT.walls });
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

    act(() => bridge.emit('terrain', { blocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood'), walls: BASE_LAYOUT.walls }));
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
      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: shown }));
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
      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: TILE_A, piece: 'wall-stone' }]) }));
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

  describe('chairs', () => {
    const TILE_A = 22 * BASE_LAYOUT.width + 67;
    const TILE_B = TILE_A + 1;

    /** A deferred `setChairs`, resolved or rejected by the test. */
    function deferredChairs() {
      const calls: { edits: readonly ChairEdit[]; resolve: () => void; reject: (error: unknown) => void }[] = [];
      const terrain = port({
        setChairs: vi.fn((edits: readonly ChairEdit[]) => new Promise<void>((resolve, reject) => calls.push({ edits: [...edits], resolve, reject }))),
      });
      return { terrain, calls };
    }

    it('picks a chair or the chair eraser facing down, turns the brush with rotate, and unpicks on a second pick or Escape', () => {
      const { result, commands } = setup();
      act(() => result.current.enter());

      act(() => result.current.pickChair('chair-gamer'));
      expect(result.current.brush).toEqual({ kind: 'chair', piece: 'chair-gamer', facing: 'down' });
      expect(commands.at(-1)).toEqual({ brush: { kind: 'chair', piece: 'chair-gamer', facing: 'down' } });

      act(() => result.current.rotateChair());
      expect(result.current.chairFacing).toBe('left');
      expect(result.current.brush).toEqual({ kind: 'chair', piece: 'chair-gamer', facing: 'left' });
      act(() => result.current.rotateChair());
      act(() => result.current.rotateChair());
      act(() => result.current.rotateChair());
      expect(result.current.chairFacing).toBe('down');

      act(() => result.current.pickChair('chair-gamer'));
      expect(result.current.brush).toBeNull();
      // The facing outlives the brush: the next chair picked faces the same way.
      act(() => result.current.rotateChair());
      act(() => result.current.pickChair('chair-wood'));
      expect(result.current.brush).toEqual({ kind: 'chair', piece: 'chair-wood', facing: 'left' });
      act(() => result.current.pickChair(null));
      expect(result.current.brush).toEqual({ kind: 'chair', piece: null, facing: 'left' });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.brush).toBeNull();
    });

    it('turns tile clicks into chair paints only with a chair brush, sending the ones queued meanwhile as one request', async () => {
      const { terrain, calls } = deferredChairs();
      const { bridge, result, commands } = setup(terrain);
      act(() => result.current.enter());
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      act(() => result.current.pickWall('wall-brick'));
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      expect(calls).toEqual([]);

      act(() => result.current.pickChair('chair-metal'));
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      act(() => bridge.emit('chairpick', { index: TILE_B }));

      expect(calls.map((call) => call.edits)).toEqual([[{ index: TILE_A, chair: { piece: 'chair-metal', facing: 'down' } }]]);
      expect(commands.at(-1)?.previewChairs).toEqual([
        { index: TILE_A, chair: { piece: 'chair-metal', facing: 'down' } },
        { index: TILE_B, chair: { piece: 'chair-metal', facing: 'down' } },
      ]);
      await act(async () => calls[0]!.resolve());
      expect(calls[1]!.edits).toEqual([{ index: TILE_B, chair: { piece: 'chair-metal', facing: 'down' } }]);
      await act(async () => calls[1]!.resolve());

      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: BASE_LAYOUT.walls, chairs: [
        { index: TILE_A, piece: 'chair-metal', facing: 'down' },
        { index: TILE_B, piece: 'chair-metal', facing: 'down' },
      ] }));
      expect(commands.at(-1)).toEqual({ brush: { kind: 'chair', piece: 'chair-metal', facing: 'down' } });
      expect(result.current.chairs).toHaveLength(2);
      expect(terrain.setWalls).not.toHaveBeenCalled();
    });

    it('skips a tile that already holds that exact chair, or erasing where there is none, but turns a chair in place', async () => {
      const { terrain, calls } = deferredChairs();
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: BASE_LAYOUT.walls, chairs: [{ index: TILE_A, piece: 'chair-wood', facing: 'down' }] }));
      act(() => result.current.pickChair('chair-wood'));
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      act(() => result.current.pickChair(null));
      act(() => bridge.emit('chairpick', { index: TILE_B }));
      expect(calls).toEqual([]);

      act(() => result.current.pickChair('chair-wood'));
      act(() => result.current.rotateChair());
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      act(() => bridge.emit('chairpick', { index: TILE_A }));
      expect(calls.map((call) => call.edits)).toEqual([[{ index: TILE_A, chair: { piece: 'chair-wood', facing: 'left' } }]]);
      await act(async () => calls[0]!.resolve());
    });

    it('never sends one tile twice in a request, and caps one request at MAX_CHAIR_EDITS tiles', async () => {
      const { terrain, calls } = deferredChairs();
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      act(() => result.current.pickChair('chair-leather'));
      act(() => {
        for (let index = 0; index <= MAX_CHAIR_EDITS + 1; index += 1) bridge.emit('chairpick', { index });
      });
      act(() => result.current.rotateChair());
      act(() => bridge.emit('chairpick', { index: 5 }));

      await act(async () => calls[0]!.resolve());
      expect(calls[1]!.edits).toHaveLength(MAX_CHAIR_EDITS);
      await act(async () => calls[1]!.resolve());
      expect(calls[2]!.edits).toEqual([{ index: MAX_CHAIR_EDITS + 1, chair: { piece: 'chair-leather', facing: 'down' } }, { index: 5, chair: { piece: 'chair-leather', facing: 'left' } }]);
      await act(async () => calls[2]!.resolve());
    });

    it('drops a refused chair request and says why in chair terms', async () => {
      const { terrain, calls } = deferredChairs();
      const { bridge, result, commands } = setup(terrain);
      act(() => result.current.enter());
      act(() => result.current.pickChair('chair-wood'));
      act(() => bridge.emit('chairpick', { index: TILE_A }));

      await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));

      expect(result.current.error).toBe(CHAIR_UNDER_PLACEMENT_MESSAGE);
      expect(commands.at(-1)?.previewChairs).toBeUndefined();
    });
  });
});
